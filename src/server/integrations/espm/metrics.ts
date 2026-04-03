import { ESPMClient } from "./client";
import type {
  ESPMPropertyMetrics,
  PropertyMetrics,
  ESPMMetric,
  ESPMReasonsForNoScore,
} from "./types";
import { ESPMNotFoundError, ESPMValidationError } from "./errors";

export class MetricsService {
  constructor(private readonly client: ESPMClient) { }

  /**
   * Get property metrics (score, EUI, etc.).
   * Primary call for BEPS compliance tracking.
   * Score requires 12 full calendar months of energy data.
   */
  async getPropertyMetrics(
    propertyId: number,
    year: number,
    month: number,
  ): Promise<PropertyMetrics> {
    const metricsHeader = [
      "score",
      "siteTotal",
      "sourceTotal",
      "siteIntensity",
      "sourceIntensity",
      "directGHGEmissions",
      "medianScore",
    ].join(", ");

    const raw = await this.client.get<ESPMPropertyMetrics>(
      `/property/${propertyId}/metrics?year=${year}&month=${month}&measurementSystem=EPA`,
      { "PM-Metrics": metricsHeader },
    );

    return this.parseMetrics(raw);
  }

  async getLatestAvailablePropertyMetrics(
    propertyId: number,
    year: number,
    endMonth = 12,
  ): Promise<PropertyMetrics> {
    let fallback: PropertyMetrics | null = null;

    for (let month = endMonth; month >= 1; month -= 1) {
      let metrics: PropertyMetrics;
      try {
        metrics = await this.getPropertyMetrics(propertyId, year, month);
      } catch (error) {
        if (
          error instanceof ESPMValidationError ||
          error instanceof ESPMNotFoundError
        ) {
          continue;
        }

        throw error;
      }

      fallback ??= metrics;

      if (this.hasUsableMetrics(metrics)) {
        return metrics;
      }
    }

    return fallback ?? this.emptyMetrics(propertyId, year, endMonth);
  }

  /**
   * Get reasons why a property has no ENERGY STAR score.
   * Common: insufficient data, property type not eligible, etc.
   */
  async getReasonsForNoScore(propertyId: number): Promise<string[]> {
    try {
      const raw = await this.client.get<ESPMReasonsForNoScore>(
        `/property/${propertyId}/reasonsForNoScore`,
      );
      return raw?.reasons?.reason ?? [];
    } catch (error) {
      if (
        error instanceof ESPMValidationError ||
        error instanceof ESPMNotFoundError
      ) {
        return [];
      }

      throw error;
    }
  }

  private parseMetrics(raw: ESPMPropertyMetrics): PropertyMetrics {
    const pm = raw.propertyMetrics;
    const metrics = pm.metric ?? [];

    const getNumericValue = (name: string): number | null => {
      const metric = metrics.find((m: ESPMMetric) => m["@_name"] === name);
      if (!metric) return null;
      const val = metric.value;
      if (val === null || val === undefined || val === "") return null;
      if (typeof val === "object") return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    };

    return {
      propertyId: pm["@_propertyId"],
      year: pm["@_year"],
      month: pm["@_month"],
      score: getNumericValue("score"),
      siteTotal: getNumericValue("siteTotal"),
      sourceTotal: getNumericValue("sourceTotal"),
      siteIntensity: getNumericValue("siteIntensity"),
      sourceIntensity: getNumericValue("sourceIntensity"),
      weatherNormalizedSiteIntensity: getNumericValue("weatherNormalizedSiteIntensity"),
      weatherNormalizedSourceIntensity: getNumericValue(
        "weatherNormalizedSourceIntensity",
      ),
      directGHGEmissions: getNumericValue("directGHGEmissions"),
      medianScore: getNumericValue("medianScore"),
    };
  }

  private hasUsableMetrics(metrics: PropertyMetrics): boolean {
    return [
      metrics.score,
      metrics.siteTotal,
      metrics.sourceTotal,
      metrics.siteIntensity,
      metrics.sourceIntensity,
      metrics.weatherNormalizedSiteIntensity,
      metrics.weatherNormalizedSourceIntensity,
    ].some((value) => value != null);
  }

  private emptyMetrics(propertyId: number, year: number, month: number): PropertyMetrics {
    return {
      propertyId,
      year,
      month,
      score: null,
      siteTotal: null,
      sourceTotal: null,
      siteIntensity: null,
      sourceIntensity: null,
      weatherNormalizedSiteIntensity: null,
      weatherNormalizedSourceIntensity: null,
      directGHGEmissions: null,
      medianScore: null,
    };
  }
}
