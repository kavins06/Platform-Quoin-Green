/** OAuth tokens returned after authorization code exchange or refresh. */
export interface GreenButtonTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  resourceUri: string;
  authorizationUri: string;
  subscriptionId: string;
}

/** Configuration for the Green Button OAuth + API integration. */
export interface GreenButtonConfig {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scope: string;
}

/** Raw ESPI IntervalReading after XML parse. */
export interface ESPIIntervalReading {
  start: Date;
  duration: number;
  value: number;
  qualityOfReading?: number;
}

/** ESPI ReadingType — describes what the interval data measures. */
export interface ESPIReadingType {
  commodity: number;
  uom: number;
  powerOfTenMultiplier: number;
  flowDirection: number;
  accumulationBehaviour: number;
}

/** Normalized output ready for the ingestion pipeline. */
export interface GreenButtonReading {
  periodStart: Date;
  periodEnd: Date;
  consumptionKWh: number;
  consumptionKBtu: number;
  cost: number | null;
  fuelType: "ELECTRIC" | "GAS";
  source: "GREEN_BUTTON";
  isEstimated: boolean;
  intervalSeconds: number;
}

/** Push notification payload from the utility. */
export interface GreenButtonNotification {
  notificationUri: string;
  subscriptionId: string;
  resourceUri: string;
}
