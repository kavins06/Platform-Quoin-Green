import { ESPMClient } from "./client";
import { espmBuilder } from "./xml-config";

export class SharingService {
  constructor(private readonly client: ESPMClient) {}

  async listPendingConnections(): Promise<unknown> {
    return this.client.get("/connect/account/pending/list");
  }

  async acceptConnection(accountId: number, note = "Accepted by Quoin."): Promise<unknown> {
    const xml = espmBuilder.build({
      sharingResponse: {
        action: "Accept",
        note,
      },
    }) as string;

    return this.client.post(`/connect/account/${accountId}`, xml);
  }

  async listPendingPropertyShares(): Promise<unknown> {
    return this.client.get("/share/property/pending/list");
  }

  async acceptPropertyShare(
    propertyId: number,
    note = "Accepted by Quoin.",
  ): Promise<unknown> {
    const xml = espmBuilder.build({
      sharingResponse: {
        action: "Accept",
        note,
      },
    }) as string;

    return this.client.post(`/share/property/${propertyId}`, xml);
  }

  async listPendingMeterShares(): Promise<unknown> {
    return this.client.get("/share/meter/pending/list");
  }

  async acceptMeterShare(meterId: number, note = "Accepted by Quoin."): Promise<unknown> {
    const xml = espmBuilder.build({
      sharingResponse: {
        action: "Accept",
        note,
      },
    }) as string;

    return this.client.post(`/share/meter/${meterId}`, xml);
  }
}
