import { espmParser } from "./xml-config";
import type { PropertyMetrics, ESPMMetric } from "./types";

/**
 * Parsed ESPM metrics subset needed for BEPS compliance tracking.
 */
export interface ESPMMetricsSummary {
  propertyId: number;
  score: number | null;
  siteEui: number | null;
  weatherNormalizedSiteEui: number | null;
  sourceEui: number | null;
  siteTotal: number | null;
  sourceTotal: number | null;
}

interface ParsedPropertyMetrics {
  propertyMetrics: {
    "@_propertyId": number;
    "@_month": number;
    "@_year": number;
    "@_measurementSystem": string;
    metric: Array<{
      "@_name": string;
      "@_uom"?: string;
      "@_dataType": string;
      value: unknown;
    }>;
  };
}

/**
 * Parse ESPM property metrics XML into a typed summary.
 *
 * Uses fast-xml-parser with ignoreAttributes: false per CLAUDE.md rules.
 * Extracts the three critical BEPS metrics: score, siteEui, weatherNormalizedSiteEui.
 */
export function parsePropertyMetricsXml(xml: string): ESPMMetricsSummary {
  if (!xml || !xml.trim()) {
    throw new Error("ESPM XML response is empty");
  }

  const parsed = espmParser.parse(xml) as ParsedPropertyMetrics;

  if (!parsed.propertyMetrics) {
    throw new Error("Invalid ESPM XML: missing propertyMetrics element");
  }

  const pm = parsed.propertyMetrics;
  const metrics = pm.metric ?? [];

  return {
    propertyId: pm["@_propertyId"],
    score: extractNumericMetric(metrics, "score"),
    siteEui: extractNumericMetric(metrics, "siteIntensity"),
    weatherNormalizedSiteEui: extractNumericMetric(metrics, "weatherNormalizedSiteIntensity"),
    sourceEui: extractNumericMetric(metrics, "sourceIntensity"),
    siteTotal: extractNumericMetric(metrics, "siteTotal"),
    sourceTotal: extractNumericMetric(metrics, "sourceTotal"),
  };
}

/**
 * Convert a full PropertyMetrics object to the BEPS summary format.
 */
export function toMetricsSummary(metrics: PropertyMetrics): ESPMMetricsSummary {
  return {
    propertyId: metrics.propertyId,
    score: metrics.score,
    siteEui: metrics.siteIntensity,
    weatherNormalizedSiteEui: metrics.weatherNormalizedSiteIntensity,
    sourceEui: metrics.sourceIntensity,
    siteTotal: metrics.siteTotal,
    sourceTotal: metrics.sourceTotal,
  };
}

/**
 * Build mock ESPM property metrics XML from structured data.
 * Used for testing and local development without a live ESPM connection.
 */
export function buildMockMetricsXml(params: {
  propertyId: number;
  year: number;
  month: number;
  score: number | null;
  siteEui: number;
  weatherNormalizedSiteEui: number;
  sourceEui?: number;
  siteTotal?: number;
  sourceTotal?: number;
}): string {
  const scoreValue = params.score !== null
    ? `<value>${params.score}</value>`
    : `<value xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/>`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<propertyMetrics propertyId="${params.propertyId}" month="${params.month}" year="${params.year}" measurementSystem="EPA">`,
    `  <metric name="score" dataType="numeric">`,
    `    ${scoreValue}`,
    `  </metric>`,
    `  <metric name="siteTotal" uom="kBtu" dataType="numeric">`,
    `    <value>${params.siteTotal ?? Math.round(params.siteEui * 185000)}</value>`,
    `  </metric>`,
    `  <metric name="sourceTotal" uom="kBtu" dataType="numeric">`,
    `    <value>${params.sourceTotal ?? Math.round((params.sourceEui ?? params.siteEui * 2.34) * 185000)}</value>`,
    `  </metric>`,
    `  <metric name="siteIntensity" uom="kBtu/ft²" dataType="numeric">`,
    `    <value>${params.siteEui}</value>`,
    `  </metric>`,
    `  <metric name="sourceIntensity" uom="kBtu/ft²" dataType="numeric">`,
    `    <value>${params.sourceEui ?? (params.siteEui * 2.34).toFixed(1)}</value>`,
    `  </metric>`,
    `  <metric name="weatherNormalizedSiteIntensity" uom="kBtu/ft²" dataType="numeric">`,
    `    <value>${params.weatherNormalizedSiteEui}</value>`,
    `  </metric>`,
    `  <metric name="directGHGEmissions" dataType="numeric">`,
    `    <value>0</value>`,
    `  </metric>`,
    `  <metric name="medianScore" dataType="numeric">`,
    `    <value>50</value>`,
    `  </metric>`,
    `</propertyMetrics>`,
  ].join("\n");
}

/**
 * Extract a numeric value from a metric array by name.
 * Handles xsi:nil="true" (null score) and missing metrics.
 */
function extractNumericMetric(
  metrics: Array<{ "@_name": string; value: unknown }>,
  name: string,
): number | null {
  const metric = metrics.find((m) => m["@_name"] === name);
  if (!metric) return null;

  const val = metric.value;
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "object") return null;

  const num = Number(val);
  return isNaN(num) ? null : num;
}
