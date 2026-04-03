import { ESPMClient } from "./client";
import type { ESPMClientConfig } from "./client";
import { PropertyService } from "./property";
import { AccountService } from "./account";
import { MeterService } from "./meter";
import { MetricsService } from "./metrics";
import { ConsumptionService } from "./consumption";
import { SharingService } from "./sharing";
import { env, getEspmClientConfig } from "@/server/lib/config";

export class ESPM {
  public readonly account: AccountService;
  public readonly property: PropertyService;
  public readonly meter: MeterService;
  public readonly metrics: MetricsService;
  public readonly consumption: ConsumptionService;
  public readonly sharing: SharingService;

  constructor(config: ESPMClientConfig) {
    const client = new ESPMClient(config);
    this.account = new AccountService(client);
    this.property = new PropertyService(client);
    this.meter = new MeterService(client);
    this.metrics = new MetricsService(client);
    this.consumption = new ConsumptionService(client);
    this.sharing = new SharingService(client);
  }
}

/** Factory for creating ESPM client from env vars */
export function createESPMClient(): ESPM {
  return new ESPM(getEspmClientConfig());
}

export function createESPMClientFromCredentials(input: {
  username: string;
  password: string;
}) {
  return new ESPM({
    baseUrl: env.ESPM_BASE_URL,
    username: input.username,
    password: input.password,
  });
}

export { ESPMClient } from "./client";
export type { ESPMClientConfig } from "./client";
export * from "./types";
export * from "./errors";
