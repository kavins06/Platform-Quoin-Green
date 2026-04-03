import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  parsePropertyMetricsXml,
  buildMockMetricsXml,
  toMetricsSummary,
} from "@/server/integrations/espm/xml-parser";
import type { PropertyMetrics } from "@/server/integrations/espm/types";

function loadFixture(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, "../fixtures/espm", name),
    "utf-8",
  );
}

describe("ESPM XML Parser", () => {
  // ─── Compliant Building ──────────────────────────────────────────

  it("parses compliant building metrics", () => {
    const xml = loadFixture("property-metrics-compliant.xml");
    const result = parsePropertyMetricsXml(xml);

    expect(result.propertyId).toBe(12345);
    expect(result.score).toBe(78);
    expect(result.siteEui).toBe(62.3);
    expect(result.weatherNormalizedSiteEui).toBe(59.8);
    expect(result.sourceEui).toBe(145.8);
    expect(result.siteTotal).toBe(11526000);
    expect(result.sourceTotal).toBe(26983200);
  });

  // ─── Non-Compliant Building ──────────────────────────────────────

  it("parses non-compliant building metrics", () => {
    const xml = loadFixture("property-metrics-non-compliant.xml");
    const result = parsePropertyMetricsXml(xml);

    expect(result.propertyId).toBe(67890);
    expect(result.score).toBe(45);
    expect(result.siteEui).toBe(120.0);
    expect(result.weatherNormalizedSiteEui).toBe(115.2);
    expect(result.sourceEui).toBe(280.8);
  });

  // ─── No Score (xsi:nil) ──────────────────────────────────────────

  it("handles null score (xsi:nil)", () => {
    const xml = loadFixture("property-metrics-no-score.xml");
    const result = parsePropertyMetricsXml(xml);

    expect(result.propertyId).toBe(11111);
    expect(result.score).toBeNull();
    expect(result.siteEui).toBe(95.0);
    expect(result.weatherNormalizedSiteEui).toBeNull();
    expect(result.siteTotal).toBe(9500000);
  });

  // ─── Mock XML Builder ────────────────────────────────────────────

  it("builds valid mock XML and round-trips through parser", () => {
    const xml = buildMockMetricsXml({
      propertyId: 99999,
      year: 2025,
      month: 6,
      score: 65,
      siteEui: 85.5,
      weatherNormalizedSiteEui: 82.1,
      sourceEui: 200.0,
    });

    const result = parsePropertyMetricsXml(xml);
    expect(result.propertyId).toBe(99999);
    expect(result.score).toBe(65);
    expect(result.siteEui).toBe(85.5);
    expect(result.weatherNormalizedSiteEui).toBe(82.1);
    expect(result.sourceEui).toBe(200.0);
  });

  it("builds mock XML with null score", () => {
    const xml = buildMockMetricsXml({
      propertyId: 88888,
      year: 2025,
      month: 3,
      score: null,
      siteEui: 100.0,
      weatherNormalizedSiteEui: 97.3,
    });

    const result = parsePropertyMetricsXml(xml);
    expect(result.score).toBeNull();
    expect(result.siteEui).toBe(100.0);
    expect(result.weatherNormalizedSiteEui).toBe(97.3);
  });

  // ─── toMetricsSummary ────────────────────────────────────────────

  it("converts PropertyMetrics to summary", () => {
    const metrics: PropertyMetrics = {
      propertyId: 12345,
      year: 2025,
      month: 12,
      score: 78,
      siteTotal: 11526000,
      sourceTotal: 26983200,
      siteIntensity: 62.3,
      sourceIntensity: 145.8,
      weatherNormalizedSiteIntensity: 59.8,
      weatherNormalizedSourceIntensity: null,
      directGHGEmissions: 285.4,
      medianScore: 50,
    };

    const summary = toMetricsSummary(metrics);
    expect(summary.score).toBe(78);
    expect(summary.siteEui).toBe(62.3);
    expect(summary.weatherNormalizedSiteEui).toBe(59.8);
    expect(summary.sourceEui).toBe(145.8);
  });

  // ─── Error Handling ──────────────────────────────────────────────

  it("throws on empty XML", () => {
    expect(() => parsePropertyMetricsXml("")).toThrow("empty");
  });

  it("throws on invalid XML structure", () => {
    expect(() =>
      parsePropertyMetricsXml("<root><notMetrics/></root>"),
    ).toThrow("missing propertyMetrics");
  });
});
