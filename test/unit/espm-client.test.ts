import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import fs from "fs";
import path from "path";
import { ESPMClient } from "@/server/integrations/espm/client";
import { MetricsService } from "@/server/integrations/espm/metrics";
import { ConsumptionService } from "@/server/integrations/espm/consumption";
import { espmBuilder } from "@/server/integrations/espm/xml-config";
import {
  ESPMAccessError,
  ESPMAuthError,
  ESPMNotFoundError,
  ESPMValidationError,
  ESPMError,
} from "@/server/integrations/espm/errors";

const BASE_URL = "https://espm-test.example.com/ws";

function loadFixture(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, "../fixtures/espm", name),
    "utf-8",
  );
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createClient(overrides?: Partial<{ maxRetries: number; timeoutMs: number }>): ESPMClient {
  return new ESPMClient({
    baseUrl: BASE_URL,
    username: "testuser",
    password: "testpass",
    maxRetries: 0,
    ...overrides,
  });
}

describe("ESPM Client", () => {
  // ─── Metrics Parsing ──────────────────────────────────────────────────

  it("parses compliant property metrics (score 78)", async () => {
    const xml = loadFixture("property-metrics-compliant.xml");
    server.use(
      http.get(`${BASE_URL}/property/12345/metrics`, () => {
        return new HttpResponse(xml, {
          headers: { "Content-Type": "application/xml" },
        });
      }),
    );

    const client = createClient();
    const metricsService = new MetricsService(client);
    const result = await metricsService.getPropertyMetrics(12345, 2025, 12);

    expect(result.propertyId).toBe(12345);
    expect(result.year).toBe(2025);
    expect(result.month).toBe(12);
    expect(result.score).toBe(78);
    expect(result.siteTotal).toBe(11526000);
    expect(result.sourceTotal).toBe(26983200);
    expect(result.siteIntensity).toBe(62.3);
    expect(result.sourceIntensity).toBe(145.8);
    expect(result.directGHGEmissions).toBe(285.4);
    expect(result.medianScore).toBe(50);
  });

  it("parses non-compliant property metrics (score 45)", async () => {
    const xml = loadFixture("property-metrics-non-compliant.xml");
    server.use(
      http.get(`${BASE_URL}/property/67890/metrics`, () => {
        return new HttpResponse(xml, {
          headers: { "Content-Type": "application/xml" },
        });
      }),
    );

    const client = createClient();
    const metricsService = new MetricsService(client);
    const result = await metricsService.getPropertyMetrics(67890, 2025, 12);

    expect(result.propertyId).toBe(67890);
    expect(result.score).toBe(45);
    expect(result.siteIntensity).toBe(120.0);
    expect(result.sourceIntensity).toBe(280.8);
  });

  it("parses metrics with xsi:nil score as null", async () => {
    const xml = loadFixture("property-metrics-no-score.xml");
    server.use(
      http.get(`${BASE_URL}/property/11111/metrics`, () => {
        return new HttpResponse(xml, {
          headers: { "Content-Type": "application/xml" },
        });
      }),
    );

    const client = createClient();
    const metricsService = new MetricsService(client);
    const result = await metricsService.getPropertyMetrics(11111, 2025, 12);

    expect(result.propertyId).toBe(11111);
    expect(result.score).toBeNull();
    expect(result.siteTotal).toBe(9500000);
    expect(result.siteIntensity).toBe(95.0);
    expect(result.sourceTotal).toBeNull();
    expect(result.sourceIntensity).toBeNull();
    expect(result.medianScore).toBeNull();
  });

  it("handles empty metrics array gracefully", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <propertyMetrics propertyId="99999" month="6" year="2025" measurementSystem="EPA">
      </propertyMetrics>`;
    server.use(
      http.get(`${BASE_URL}/property/99999/metrics`, () => {
        return new HttpResponse(xml, {
          headers: { "Content-Type": "application/xml" },
        });
      }),
    );

    const client = createClient();
    const metricsService = new MetricsService(client);
    const result = await metricsService.getPropertyMetrics(99999, 2025, 6);

    expect(result.propertyId).toBe(99999);
    expect(result.score).toBeNull();
    expect(result.siteTotal).toBeNull();
  });

  it("falls back to the latest available month when December metrics are empty", async () => {
    const decemberXml = `<?xml version="1.0" encoding="UTF-8"?>
      <propertyMetrics propertyId="19879255" month="12" year="2025" measurementSystem="EPA">
        <metric name="medianScore" dataType="numeric"><value>50</value></metric>
      </propertyMetrics>`;
    const novemberXml = `<?xml version="1.0" encoding="UTF-8"?>
      <propertyMetrics propertyId="19879255" month="11" year="2025" measurementSystem="EPA">
        <metric name="score" dataType="numeric"><value>19</value></metric>
        <metric name="siteTotal" uom="kBtu" dataType="numeric"><value>10943640.4</value></metric>
        <metric name="sourceTotal" uom="kBtu" dataType="numeric"><value>26380943.6</value></metric>
        <metric name="siteIntensity" uom="kBtu/ft²" dataType="numeric"><value>120.3</value></metric>
        <metric name="sourceIntensity" uom="kBtu/ft²" dataType="numeric"><value>289.9</value></metric>
        <metric name="directGHGEmissions" dataType="numeric"><value>129.33</value></metric>
        <metric name="medianScore" dataType="numeric"><value>50</value></metric>
      </propertyMetrics>`;

    server.use(
      http.get(`${BASE_URL}/property/19879255/metrics`, ({ request }) => {
        const url = new URL(request.url);
        const month = url.searchParams.get("month");
        return new HttpResponse(month === "12" ? decemberXml : novemberXml, {
          headers: { "Content-Type": "application/xml" },
        });
      }),
    );

    const client = createClient();
    const metricsService = new MetricsService(client);
    const result = await metricsService.getLatestAvailablePropertyMetrics(19879255, 2025, 12);

    expect(result.month).toBe(11);
    expect(result.score).toBe(19);
    expect(result.siteIntensity).toBe(120.3);
    expect(result.sourceIntensity).toBe(289.9);
  });

  it("requests only ESPM-supported property metrics in the PM-Metrics header", async () => {
    server.use(
      http.get(`${BASE_URL}/property/12345/metrics`, ({ request }) => {
        const metricsHeader = request.headers.get("PM-Metrics") ?? "";
        expect(metricsHeader).toContain("score");
        expect(metricsHeader).toContain("siteIntensity");
        expect(metricsHeader).toContain("sourceIntensity");
        expect(metricsHeader).not.toContain("weatherNormalizedSiteIntensity");
        expect(metricsHeader).not.toContain("weatherNormalizedSourceIntensity");

        return new HttpResponse(loadFixture("property-metrics-compliant.xml"), {
          headers: { "Content-Type": "application/xml" },
        });
      }),
    );

    const client = createClient();
    const metricsService = new MetricsService(client);
    await metricsService.getPropertyMetrics(12345, 2025, 12);
  });

  // ─── Error Mapping ────────────────────────────────────────────────────

  it("maps 401 to ESPMAuthError", async () => {
    server.use(
      http.get(`${BASE_URL}/property/1/metrics`, () => {
        return new HttpResponse("Unauthorized", { status: 401 });
      }),
    );

    const client = createClient();
    await expect(
      client.get("/property/1/metrics"),
    ).rejects.toThrow(ESPMAuthError);
  });

  it("maps 403 to ESPMAccessError", async () => {
    server.use(
      http.get(`${BASE_URL}/property/1`, () => {
        return new HttpResponse("Access Denied", { status: 403 });
      }),
    );

    const client = createClient();
    await expect(client.get("/property/1")).rejects.toThrow(ESPMAccessError);
  });

  it("maps 404 to ESPMNotFoundError", async () => {
    server.use(
      http.get(`${BASE_URL}/property/999/metrics`, () => {
        return new HttpResponse("Not Found", { status: 404 });
      }),
    );

    const client = createClient();
    await expect(
      client.get("/property/999/metrics"),
    ).rejects.toThrow(ESPMNotFoundError);
  });

  it("maps 400 to ESPMValidationError with extracted message", async () => {
    const errorXml = `<?xml version="1.0" encoding="UTF-8"?>
      <errors>
        <error>
          <errorNumber>1001</errorNumber>
          <errorDescription>Property ID is required</errorDescription>
        </error>
      </errors>`;
    server.use(
      http.post(`${BASE_URL}/property/0/meter`, () => {
        return new HttpResponse(errorXml, { status: 400 });
      }),
    );

    const client = createClient();
    try {
      await client.post("/property/0/meter", "<meter/>");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ESPMValidationError);
      expect((err as ESPMValidationError).message).toBe(
        "Property ID is required",
      );
    }
  });

  // ─── Retries ──────────────────────────────────────────────────────────

  it("retries on 500 and succeeds", async () => {
    let callCount = 0;
    const xml = loadFixture("property-metrics-compliant.xml");
    server.use(
      http.get(`${BASE_URL}/property/12345/metrics`, () => {
        callCount++;
        if (callCount === 1) {
          return new HttpResponse("Internal Server Error", { status: 500 });
        }
        return new HttpResponse(xml, {
          headers: { "Content-Type": "application/xml" },
        });
      }),
    );

    const client = createClient({ maxRetries: 2 });
    const metricsService = new MetricsService(client);
    const result = await metricsService.getPropertyMetrics(12345, 2025, 12);

    expect(result.score).toBe(78);
    expect(callCount).toBe(2);
  });

  it("throws after exhausting retries on 500", async () => {
    server.use(
      http.get(`${BASE_URL}/property/12345/metrics`, () => {
        return new HttpResponse("Internal Server Error", { status: 500 });
      }),
    );

    const client = createClient({ maxRetries: 1 });
    await expect(
      client.get("/property/12345/metrics"),
    ).rejects.toThrow(ESPMError);
  });

  // ─── XML Building ─────────────────────────────────────────────────────

  it("builds valid consumption data XML", () => {
    const xml = espmBuilder.build({
      meterConsumption: [
        {
          startDate: "2025-01-01",
          endDate: "2025-01-31",
          usage: 45000,
          cost: 5400,
        },
        {
          startDate: "2025-02-01",
          endDate: "2025-02-28",
          usage: 42000,
        },
      ],
    }) as string;

    expect(xml).toContain("<startDate>2025-01-01</startDate>");
    expect(xml).toContain("<endDate>2025-01-31</endDate>");
    expect(xml).toContain("<usage>45000</usage>");
    expect(xml).toContain("<cost>5400</cost>");
    expect(xml).toContain("<startDate>2025-02-01</startDate>");
    expect(xml).toContain("<usage>42000</usage>");
  });

  // ─── Consumption Service Validation ───────────────────────────────────

  it("rejects empty consumption data", async () => {
    const client = createClient();
    const consumption = new ConsumptionService(client);

    await expect(
      consumption.pushConsumptionData(1, []),
    ).rejects.toThrow("No consumption data entries to push");
  });

  it("rejects more than 120 consumption entries", async () => {
    const client = createClient();
    const consumption = new ConsumptionService(client);
    const entries = Array.from({ length: 121 }, (_, i) => ({
      startDate: `2025-01-${String(i + 1).padStart(2, "0")}`,
      endDate: `2025-01-${String(i + 1).padStart(2, "0")}`,
      usage: 100,
    }));

    await expect(
      consumption.pushConsumptionData(1, entries),
    ).rejects.toThrow("Max 120 consumption entries per POST");
  });
});
