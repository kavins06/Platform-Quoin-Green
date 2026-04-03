export interface ESPMPropertyMetrics {
  propertyMetrics: {
    "@_propertyId": number;
    "@_month": number;
    "@_year": number;
    "@_measurementSystem": string;
    metric: ESPMMetric[];
  };
}

export interface ESPMMetric {
  "@_name": string;
  "@_uom"?: string;
  "@_dataType": string;
  value: number | string | null;
}

export interface PropertyMetrics {
  propertyId: number;
  year: number;
  month: number;
  score: number | null;
  siteTotal: number | null;
  sourceTotal: number | null;
  siteIntensity: number | null;
  sourceIntensity: number | null;
  weatherNormalizedSiteIntensity: number | null;
  weatherNormalizedSourceIntensity: number | null;
  directGHGEmissions: number | null;
  medianScore: number | null;
}

export interface ESPMProperty {
  property: {
    "@_id"?: number;
    name: string;
    primaryFunction: string;
    grossFloorArea: {
      value: number;
      "@_units"?: string;
      "@_temporary"?: boolean;
    };
    yearBuilt: number;
    address: {
      "@_address1": string;
      "@_city": string;
      "@_state": string;
      "@_postalCode": string;
    };
    numberOfBuildings?: number;
  };
}

export interface ESPMCreateResponse {
  response?: {
    id?: number | string;
    link?: Array<{
      "@_linkDescription"?: string;
      "@_link"?: string;
      "@_httpMethod"?: string;
    }>;
  };
}

export interface ESPMAccountProfile {
  account?: {
    "@_id"?: number | string;
    id?: number | string;
    accountInfo?: {
      username?: string;
      accountName?: string;
      organization?: string;
      webserviceUser?: boolean;
    };
  };
}

export interface ESPMCustomerAccount {
  customer?: {
    "@_id"?: number;
    accountInfo?: {
      organization?: string;
      username?: string;
      webserviceUser?: boolean;
    };
  };
}

export interface ESPMPropertyListResponse {
  response?: {
    link?:
      | Array<{
          "@_id"?: number | string;
          "@_link"?: string;
          "@_linkDescription"?: string;
          "@_httpMethod"?: string;
        }>
      | {
          "@_id"?: number | string;
          "@_link"?: string;
          "@_linkDescription"?: string;
          "@_httpMethod"?: string;
        };
  };
}

export interface ESPMMeter {
  meter: {
    "@_id"?: number;
    type: string;
    name: string;
    unitOfMeasure: string;
    metered: boolean;
    firstBillDate?: string;
    inUse: boolean;
  };
}

export interface ConsumptionDataEntry {
  startDate: string;
  endDate: string;
  usage: number;
  cost?: number;
  estimatedValue?: boolean;
}

export interface ESPMErrorResponse {
  errors: {
    error: {
      errorNumber: string;
      errorDescription: string;
    }[];
  };
}

export interface ESPMReasonsForNoScore {
  reasons: {
    reason: string[];
  };
}
