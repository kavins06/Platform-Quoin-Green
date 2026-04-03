import { ESPMClient } from "./client";
import { espmBuilder } from "./xml-config";
import type { ConsumptionDataEntry } from "./types";

export class ConsumptionService {
  constructor(private readonly client: ESPMClient) { }

  /**
   * Push consumption data to a meter.
   * Max 120 entries per POST call.
   * Each entry = one billing period (typically monthly).
   */
  async pushConsumptionData(
    meterId: number,
    entries: ConsumptionDataEntry[],
  ): Promise<unknown> {
    if (entries.length === 0) {
      throw new Error("No consumption data entries to push");
    }
    if (entries.length > 120) {
      throw new Error("Max 120 consumption entries per POST (ESPM limit)");
    }

    const xml = espmBuilder.build({
      meterData: {
        meterConsumption: entries.map((entry) => ({
          startDate: entry.startDate,
          endDate: entry.endDate,
          usage: entry.usage,
          ...(entry.cost !== undefined ? { cost: entry.cost } : {}),
          ...(entry.estimatedValue !== undefined
            ? { estimatedValue: entry.estimatedValue }
            : {}),
        })),
      },
    }) as string;

    return this.client.post(`/meter/${meterId}/consumptionData`, xml);
  }

  /** Update one existing meter consumption record */
  async updateConsumptionData(
    consumptionDataId: number,
    entry: ConsumptionDataEntry,
  ): Promise<unknown> {
    const xml = espmBuilder.build({
      meterConsumption: {
        startDate: entry.startDate,
        endDate: entry.endDate,
        usage: entry.usage,
        ...(entry.cost !== undefined ? { cost: entry.cost } : {}),
        ...(entry.estimatedValue !== undefined
          ? { estimatedValue: entry.estimatedValue }
          : {}),
      },
    }) as string;

    return this.client.put(`/consumptionData/${consumptionDataId}`, xml);
  }

  /** Delete one existing meter consumption record */
  async deleteConsumptionData(consumptionDataId: number): Promise<unknown> {
    return this.client.delete(`/consumptionData/${consumptionDataId}`);
  }

  /** Get consumption data for a meter (paginated, 120 per page) */
  async getConsumptionData(
    meterId: number,
    params?: { page?: number; startDate?: string; endDate?: string },
  ): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.startDate) query.set("startDate", params.startDate);
    if (params?.endDate) query.set("endDate", params.endDate);
    const qs = query.toString();
    return this.client.get(
      `/meter/${meterId}/consumptionData${qs ? `?${qs}` : ""}`,
    );
  }
}
