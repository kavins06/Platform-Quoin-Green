import { describe, expect, it, vi } from "vitest";
import type { ESPM } from "@/server/integrations/espm";
import { syncWithESPM } from "@/server/pipelines/data-ingestion/espm-sync";

function createEspmMock(overrides?: Partial<ESPM>) {
  return {
    meter: {
      listMeters: vi.fn(),
      createMeter: vi.fn(),
    },
    consumption: {
      pushConsumptionData: vi.fn(),
    },
    metrics: {
      getLatestAvailablePropertyMetrics: vi.fn(),
    },
    property: {},
    ...overrides,
  } as unknown as ESPM;
}

describe("legacy ingestion ESPM sync hardening", () => {
  it("creates a natural gas meter when the reading unit is therms", async () => {
    const espmClient = createEspmMock();
    vi.mocked(espmClient.meter.listMeters).mockResolvedValue({
      response: { links: { link: [] } },
    });
    vi.mocked(espmClient.meter.createMeter).mockResolvedValue({
      response: {
        links: {
          link: {
            "@_href": "/ws/meter/25789685",
          },
        },
      },
    });
    vi.mocked(espmClient.consumption.pushConsumptionData).mockResolvedValue({});
    vi.mocked(espmClient.metrics.getLatestAvailablePropertyMetrics).mockResolvedValue(
      null as never,
    );

    const result = await syncWithESPM(espmClient, {
      espmPropertyId: 19879255,
      espmMeterId: null,
      readings: [
        {
          periodStart: new Date("2025-11-01T00:00:00.000Z"),
          periodEnd: new Date("2025-11-30T00:00:00.000Z"),
          consumptionNative: 2500,
          nativeUnit: "THERMS",
        },
      ],
    });

    expect(result.pushed).toBe(true);
    expect(espmClient.meter.createMeter).toHaveBeenCalledWith(
      19879255,
      expect.objectContaining({
        type: "Natural Gas",
        unitOfMeasure: "therms",
      }),
    );
    expect(espmClient.consumption.pushConsumptionData).toHaveBeenCalledWith(
      25789685,
      expect.any(Array),
    );
  });

  it("does not fall back to the property id when no meter id can be resolved", async () => {
    const espmClient = createEspmMock();
    vi.mocked(espmClient.meter.listMeters).mockResolvedValue({
      response: { links: { link: [] } },
    });
    vi.mocked(espmClient.meter.createMeter).mockResolvedValue({});
    vi.mocked(espmClient.metrics.getLatestAvailablePropertyMetrics).mockResolvedValue(
      null as never,
    );

    const result = await syncWithESPM(espmClient, {
      espmPropertyId: 19879255,
      espmMeterId: null,
      readings: [
        {
          periodStart: new Date("2025-11-01T00:00:00.000Z"),
          periodEnd: new Date("2025-11-30T00:00:00.000Z"),
          consumptionNative: 191640,
          nativeUnit: "KWH",
        },
      ],
    });

    expect(result.pushed).toBe(false);
    expect(result.pushError).toContain("valid meter ID");
    expect(espmClient.consumption.pushConsumptionData).not.toHaveBeenCalled();
  });
});
