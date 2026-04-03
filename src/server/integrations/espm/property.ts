import { ESPMClient } from "./client";
import { espmBuilder } from "./xml-config";
import type {
  ESPMCreateResponse,
  ESPMProperty,
  ESPMPropertyListResponse,
} from "./types";
import {
  getAllPropertyUseFields,
  getPropertyUseDefinition,
  type BuildingPropertyUseKey,
  type PropertyUseFieldDefinition,
} from "@/lib/buildings/property-use-registry";

export class PropertyService {
  constructor(private readonly client: ESPMClient) {}

  private buildPropertyPayload(property: {
    name: string;
    primaryFunction: string;
    grossFloorArea: number;
    yearBuilt: number;
    address: {
      address1: string;
      city: string;
      state: string;
      postalCode: string;
    };
    numberOfBuildings?: number;
    occupancyPercentage?: number;
    irrigatedAreaSquareFeet?: number;
    constructionStatus?: "Existing" | "New";
    isFederalProperty?: boolean;
    isInstitutionalProperty?: boolean;
  }) {
    return {
      property: {
        name: property.name,
        primaryFunction: property.primaryFunction,
        grossFloorArea: {
          value: property.grossFloorArea,
          "@_units": "Square Feet",
          "@_temporary": false,
        },
        yearBuilt: property.yearBuilt,
        address: {
          "@_address1": property.address.address1,
          "@_city": property.address.city,
          "@_state": property.address.state,
          "@_postalCode": property.address.postalCode,
        },
        numberOfBuildings: property.numberOfBuildings ?? 1,
        occupancyPercentage: property.occupancyPercentage ?? 100,
        irrigatedArea:
          property.irrigatedAreaSquareFeet != null
            ? {
                value: property.irrigatedAreaSquareFeet,
                "@_units": "Square Feet",
                "@_temporary": false,
              }
            : undefined,
        constructionStatus: property.constructionStatus ?? "Existing",
        isFederalProperty: property.isFederalProperty ?? false,
        isInstitutionalProperty: property.isInstitutionalProperty ?? false,
      },
    };
  }

  private buildUseDetailNode(
    field: PropertyUseFieldDefinition,
    rawValue: unknown,
    currentAsOf: string,
  ) {
    const baseAttributes = {
      "@_temporary": false,
      "@_currentAsOf": currentAsOf,
    };

    switch (field.pmValueKind) {
      case "integer": {
        const value = Number(rawValue);
        return Number.isFinite(value)
          ? {
              value,
              ...baseAttributes,
            }
          : null;
      }
      case "decimal": {
        const value = Number(rawValue);
        return Number.isFinite(value)
          ? {
              value,
              ...baseAttributes,
            }
          : null;
      }
      case "area": {
        const value = Number(rawValue);
        return Number.isFinite(value)
          ? {
              value,
              "@_units": "Square Feet",
              ...baseAttributes,
            }
          : null;
      }
      case "lengthFeet": {
        const value = Number(rawValue);
        return Number.isFinite(value)
          ? {
              value,
              "@_units": "Feet",
              ...baseAttributes,
            }
          : null;
      }
      case "yesNo": {
        if (typeof rawValue === "boolean") {
          return {
            value: rawValue ? "Yes" : "No",
            ...baseAttributes,
          };
        }

        const value =
          typeof rawValue === "string" && rawValue.trim().length > 0
            ? rawValue.trim()
            : null;
        return value
          ? {
              value,
              ...baseAttributes,
            }
          : null;
      }
      case "enum":
      case "percentTens":
      case "text": {
        const value =
          typeof rawValue === "string"
            ? rawValue.trim()
            : rawValue != null
              ? String(rawValue)
              : null;
        return value && value.length > 0
          ? {
              value,
              ...baseAttributes,
            }
          : null;
      }
      default:
        return null;
    }
  }

  private buildUseDetailsEntries(input: {
    useKey: BuildingPropertyUseKey;
    grossSquareFeet?: number | null;
    details?: Record<string, unknown>;
  }) {
    const currentAsOf = new Date().toISOString().slice(0, 10);
    const entries: Array<{ key: string; node: Record<string, unknown> }> = [];

    if (input.grossSquareFeet != null) {
      entries.push({
        key: "totalGrossFloorArea",
        node: {
          value: input.grossSquareFeet,
          "@_units": "Square Feet",
          "@_temporary": false,
          "@_currentAsOf": currentAsOf,
        },
      });
    }

    for (const field of getAllPropertyUseFields(input.useKey)) {
      const node = this.buildUseDetailNode(
        field,
        input.details?.[field.key],
        currentAsOf,
      );
      if (!node) {
        continue;
      }

      entries.push({
        key: field.pmElement,
        node,
      });
    }

    return entries;
  }

  /** Get property details by ID */
  async getProperty(propertyId: number): Promise<ESPMProperty> {
    return this.client.get<ESPMProperty>(`/property/${propertyId}`);
  }

  /** List properties for a connected customer */
  async listProperties(customerId: number): Promise<ESPMPropertyListResponse> {
    return this.client.get<ESPMPropertyListResponse>(
      `/account/${customerId}/property/list`,
    );
  }

  /** Search properties (for linking flow) */
  async searchProperties(params: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  }): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.name) query.set("name", params.name);
    if (params.address) query.set("address", params.address);
    if (params.city) query.set("city", params.city);
    if (params.state) query.set("state", params.state || "DC");
    if (params.postalCode) query.set("postalCode", params.postalCode);
    return this.client.get(`/property/search?${query.toString()}`);
  }

  /** Create a property for a connected customer */
  async createProperty(
    customerId: number,
    property: {
      name: string;
      primaryFunction: string;
      grossFloorArea: number;
      yearBuilt: number;
      address: {
        address1: string;
        city: string;
        state: string;
        postalCode: string;
      };
      numberOfBuildings?: number;
      occupancyPercentage?: number;
      irrigatedAreaSquareFeet?: number;
      constructionStatus?: "Existing" | "New";
      isFederalProperty?: boolean;
      isInstitutionalProperty?: boolean;
    },
  ): Promise<ESPMCreateResponse> {
    const xml = espmBuilder.build(this.buildPropertyPayload(property)) as string;

    return this.client.post<ESPMCreateResponse>(
      `/account/${customerId}/property`,
      xml,
    );
  }

  async updateProperty(
    propertyId: number,
    property: {
      name: string;
      primaryFunction: string;
      grossFloorArea: number;
      yearBuilt: number;
      address: {
        address1: string;
        city: string;
        state: string;
        postalCode: string;
      };
      numberOfBuildings?: number;
      occupancyPercentage?: number;
      irrigatedAreaSquareFeet?: number;
      constructionStatus?: "Existing" | "New";
      isFederalProperty?: boolean;
      isInstitutionalProperty?: boolean;
    },
  ) {
    const xml = espmBuilder.build(this.buildPropertyPayload(property)) as string;
    return this.client.put(`/property/${propertyId}`, xml);
  }

  async deleteProperty(propertyId: number) {
    return this.client.delete(`/property/${propertyId}`);
  }

  async unshareProperty(propertyId: number) {
    return this.client.post(`/unshare/property/${propertyId}`, "");
  }

  async listPropertyUses(propertyId: number): Promise<unknown> {
    return this.client.get(`/property/${propertyId}/propertyUse/list`);
  }

  async getPropertyUse(propertyUseId: number): Promise<unknown> {
    return this.client.get(`/propertyUse/${propertyUseId}`);
  }

  async createPropertyUse(
    propertyId: number,
    input: {
      name: string;
      useKey: BuildingPropertyUseKey;
      grossFloorArea: number;
      details?: Record<string, unknown>;
    },
  ): Promise<ESPMCreateResponse> {
    const useDetails = Object.fromEntries(
      this.buildUseDetailsEntries({
        useKey: input.useKey,
        grossSquareFeet: input.grossFloorArea,
        details: input.details,
      }).map((entry) => [entry.key, entry.node]),
    );

    const rootTag = getPropertyUseDefinition(input.useKey).pmRootTag;
    const xml = espmBuilder.build({
      [rootTag]: {
        name: input.name,
        useDetails,
      },
    }) as string;

    return this.client.post<ESPMCreateResponse>(
      `/property/${propertyId}/propertyUse`,
      xml,
    );
  }

  async createUseDetails(
    propertyUseId: number,
    input: {
      useKey: BuildingPropertyUseKey;
      grossSquareFeet?: number | null;
      details?: Record<string, unknown>;
    },
  ): Promise<ESPMCreateResponse> {
    const entries = this.buildUseDetailsEntries(input);
    let latestResponse: ESPMCreateResponse = {};

    for (const entry of entries) {
      const xml = espmBuilder.build({
        [entry.key]: entry.node,
      }) as string;

      latestResponse = await this.client.post<ESPMCreateResponse>(
        `/propertyUse/${propertyUseId}/useDetails`,
        xml,
      );
    }

    return latestResponse;
  }

  async updateUseDetails(
    useDetailsId: number,
    input: {
      useKey: BuildingPropertyUseKey;
      grossSquareFeet?: number | null;
      details?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    let latestResponse: unknown = null;

    for (const entry of this.buildUseDetailsEntries(input)) {
      const xml = espmBuilder.build({
        [entry.key]: entry.node,
      }) as string;

      latestResponse = await this.client.put(`/useDetails/${useDetailsId}`, xml);
    }

    return latestResponse;
  }
}
