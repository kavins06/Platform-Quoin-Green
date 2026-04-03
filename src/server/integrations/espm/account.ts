import { ESPMClient } from "./client";
import { espmBuilder } from "./xml-config";
import type { ESPMAccountProfile, ESPMCreateResponse } from "./types";

export class AccountService {
  constructor(private readonly client: ESPMClient) {}

  async getAccount(): Promise<ESPMAccountProfile> {
    return this.client.get<ESPMAccountProfile>("/account");
  }

  async listCustomers(): Promise<unknown> {
    return this.client.get("/customer/list");
  }

  async getCustomer(customerId: number): Promise<unknown> {
    return this.client.get(`/customer/${customerId}`);
  }

  async createCustomer(input: {
    username: string;
    password: string;
    organization: string;
    contact: {
      firstName: string;
      lastName: string;
      email: string;
      address1: string;
      city: string;
      state: string;
      postalCode: string;
    };
  }): Promise<ESPMCreateResponse> {
    const xml = espmBuilder.build({
      customer: {
        accountInfo: {
          username: input.username,
          password: input.password,
          webserviceUser: true,
          searchable: true,
          securityAnswer: "managed-by-quoin",
          accountName: input.organization,
        },
        contact: {
          firstName: input.contact.firstName,
          lastName: input.contact.lastName,
          email: input.contact.email,
          address: {
            "@_address1": input.contact.address1,
            "@_city": input.contact.city,
            "@_state": input.contact.state,
            "@_postalCode": input.contact.postalCode,
          },
        },
        accountCustomFieldList: {},
      },
    }) as string;

    return this.client.post<ESPMCreateResponse>("/customer", xml);
  }
}
