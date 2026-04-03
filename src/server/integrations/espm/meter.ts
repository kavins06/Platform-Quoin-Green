import { ESPMClient } from "./client";
import { espmBuilder } from "./xml-config";
import type { ESPMMeter } from "./types";

export class MeterService {
  constructor(private readonly client: ESPMClient) {}

  /** List meters for a property */
  async listMeters(propertyId: number): Promise<unknown> {
    return this.client.get(`/property/${propertyId}/meter/list`);
  }

  /** Get meter details */
  async getMeter(meterId: number): Promise<ESPMMeter> {
    return this.client.get<ESPMMeter>(`/meter/${meterId}`);
  }

  /** Create a meter for a property */
  async createMeter(
    propertyId: number,
    meter: {
      type: string;
      name: string;
      unitOfMeasure: string;
      metered: boolean;
      firstBillDate: string;
      inUse: boolean;
    },
  ): Promise<unknown> {
    const xml = espmBuilder.build({
      meter: {
        type: meter.type,
        name: meter.name,
        unitOfMeasure: meter.unitOfMeasure,
        metered: meter.metered,
        firstBillDate: meter.firstBillDate,
        inUse: meter.inUse,
      },
    }) as string;
    return this.client.post(`/property/${propertyId}/meter`, xml);
  }

  /** List property-to-meter associations for a property */
  async listPropertyMeterAssociations(propertyId: number): Promise<unknown> {
    return this.client.get(`/association/property/${propertyId}/meter`);
  }

  /** Associate one meter to a property */
  async associateMeterToProperty(propertyId: number, meterId: number): Promise<unknown> {
    return this.client.post(`/association/property/${propertyId}/meter/${meterId}`, "");
  }
}
