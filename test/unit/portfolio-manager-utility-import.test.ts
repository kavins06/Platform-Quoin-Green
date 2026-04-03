import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  convertLocalUsageToRemoteUsage,
  convertRemoteUsageToLocalUsage,
  getPortfolioManagerRemoteMeterDefinition,
  mapRawEspmMeterType,
} from "@/server/portfolio-manager/unit-catalog";
import {
  parsePortfolioManagerConsumptionReadings,
  parsePortfolioManagerMeterIds,
} from "@/server/compliance/portfolio-manager-support";
import { MetricsService } from "@/server/integrations/espm/metrics";
import { ESPMValidationError } from "@/server/integrations/espm/errors";
import { calculateEUI, type EUIReading } from "@/server/pipelines/data-ingestion/snapshot";
import { formatPeriodDate } from "@/lib/period-date";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("portfolio manager utility import", () => {
  it("classifies water meters and converts imported water usage without kBtu math", () => {
    expect(mapRawEspmMeterType("Potable Indoor Meter")).toBe("WATER_INDOOR");
    expect(mapRawEspmMeterType("Potable Outdoor Meter")).toBe("WATER_OUTDOOR");
    expect(mapRawEspmMeterType("Municipally Supplied Potable Water - Indoor")).toBe(
      "WATER_INDOOR",
    );

    const remote = getPortfolioManagerRemoteMeterDefinition({
      rawType: "Municipally Supplied Potable Water - Indoor",
      rawUnitOfMeasure: "Gallons (US)",
    });

    expect(remote?.meterType).toBe("WATER_INDOOR");
    expect(remote?.preferredLocalUnit).toBe("GAL");

    const converted = convertRemoteUsageToLocalUsage({
      localMeterType: "WATER_OUTDOOR",
      localUnit: "KGAL",
      rawRemoteType: "Potable Outdoor Meter",
      rawRemoteUnitOfMeasure: "Gallons (US)",
      remoteUsage: 2500,
    });

    expect(converted.ok).toBe(true);
    if (!converted.ok) {
      throw new Error("Expected water usage conversion to succeed");
    }

    expect(converted.localConsumption).toBeCloseTo(2.5, 5);
    expect(converted.consumptionKbtu).toBe(0);
  });

  it("supports water for PM push when the remote meter type and unit are compatible", () => {
    const pushed = convertLocalUsageToRemoteUsage({
      localMeterType: "WATER_INDOOR",
      localUnit: "GAL",
      rawRemoteType: "Potable Indoor Meter",
      rawRemoteUnitOfMeasure: "Gallons (US)",
      localUsage: 1200,
    });

    expect(pushed.ok).toBe(true);
    if (!pushed.ok) {
      throw new Error("Expected water push conversion to succeed");
    }

    expect(pushed.remoteUsage).toBeCloseTo(1200, 5);
  });

  it("accepts ESPM natural-gas therms as a supported import unit", () => {
    const remote = getPortfolioManagerRemoteMeterDefinition({
      rawType: "Natural Gas",
      rawUnitOfMeasure: "therms",
    });

    expect(remote?.meterType).toBe("GAS");
    expect(remote?.preferredLocalUnit).toBe("THERMS");

    const converted = convertRemoteUsageToLocalUsage({
      localMeterType: "GAS",
      localUnit: "THERMS",
      rawRemoteType: "Natural Gas",
      rawRemoteUnitOfMeasure: "therms",
      remoteUsage: 14.5,
    });

    expect(converted.ok).toBe(true);
    if (!converted.ok) {
      throw new Error("Expected therms import conversion to succeed");
    }

    expect(converted.localConsumption).toBeCloseTo(14.5, 5);
  });

  it("parses property-to-meter association payloads that use meterId arrays", () => {
    const meterIds = parsePortfolioManagerMeterIds({
      meterPropertyAssociationList: {
        energyMeterAssociation: {
          meters: {
            meterId: [324847608, 324847609],
          },
        },
        waterMeterAssociation: {
          meters: {
            meterId: 324847610,
          },
        },
      },
    });

    expect(meterIds).toEqual([324847608, 324847609, 324847610]);
  });

  it("parses PM consumption period dates without local timezone drift", () => {
    const parsed = parsePortfolioManagerConsumptionReadings({
      consumptionData: {
        meterConsumption: [
          {
            startDate: "2025-12-14",
            endDate: "2026-01-13",
            usage: 464913,
          },
          {
            startDate: "2025-08-14",
            endDate: "2025-09-12",
            usage: 464913,
          },
        ],
      },
    });

    expect(parsed.malformedRowCount).toBe(0);
    expect(parsed.readings).toHaveLength(2);
    expect(parsed.readings[0]?.periodStart.toISOString()).toBe("2025-12-14T00:00:00.000Z");
    expect(parsed.readings[0]?.periodEnd.toISOString()).toBe("2026-01-13T00:00:00.000Z");
    expect(formatPeriodDate(parsed.readings[0]?.periodStart ?? null)).toBe("Dec 14, 2025");
    expect(formatPeriodDate(parsed.readings[0]?.periodEnd ?? null)).toBe("Jan 13, 2026");
    expect(formatPeriodDate(parsed.readings[1]?.periodStart ?? null)).toBe("Aug 14, 2025");
    expect(formatPeriodDate(parsed.readings[1]?.periodEnd ?? null)).toBe("Sep 12, 2025");
  });

  it("treats PM no-score validation responses as no-data instead of a hard failure", async () => {
    const service = new MetricsService({
      get: async (path: string) => {
        if (path.includes("/reasonsForNoScore")) {
          throw new ESPMValidationError("ESPM validation error");
        }

        throw new Error(`Unexpected path ${path}`);
      },
    } as never);

    await expect(service.getReasonsForNoScore(89514924)).resolves.toEqual([]);
  });

  it("keeps benchmark EUI energy-only even when water readings exist locally", () => {
    const readings: EUIReading[] = [
      {
        meterType: "ELECTRIC",
        consumptionKbtu: 100_000,
        periodStart: new Date("2025-01-01T00:00:00Z"),
      },
      {
        meterType: "WATER_INDOOR",
        consumptionKbtu: 0,
        periodStart: new Date("2025-01-15T00:00:00Z"),
      },
    ];

    const eui = calculateEUI(readings, 100_000);

    expect(eui.totalSiteKBtu).toBe(100_000);
    expect(eui.totalSourceKBtu).toBe(280_000);
    expect(eui.siteEui).toBe(1);
    expect(eui.sourceEui).toBeCloseTo(2.8, 3);
    expect(eui.fuelBreakdown.WATER_INDOOR).toBeUndefined();
  });

  it("surfaces utility imports in the building experience without changing the energy chart path", () => {
    const overviewSource = readRepoFile("src/components/building/building-overview-tab.tsx");
    const syncPanelSource = readRepoFile(
      "src/components/building/portfolio-manager-sync-panel.tsx",
    );
    const buildingRouterSource = readRepoFile("src/server/trpc/routers/building.ts");
    const usageSource = readRepoFile("src/server/portfolio-manager/usage.ts");
    const remoteStateSource = readRepoFile("src/server/portfolio-manager/remote-meter-state.ts");

    expect(overviewSource).toContain("Utility imports");
    expect(syncPanelSource).toContain("including water");
    expect(syncPanelSource).toContain("Partial sync");
    expect(buildingRouterSource).toContain("utilityReadings");
    expect(buildingRouterSource).toContain('in: ["ELECTRIC", "GAS", "STEAM"]');
    expect(usageSource).toContain("skippedMeterCount");
    expect(usageSource).toContain("skippedMeters");
    expect(remoteStateSource).toContain("PROVIDER_UNSUPPORTED_METER_TYPE");
  });
});
