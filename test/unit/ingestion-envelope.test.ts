import { describe, expect, it } from "vitest";
import { ContractValidationError } from "@/server/lib/errors";
import {
  INGESTION_JOB_TYPE,
  INGESTION_PAYLOAD_VERSION,
  buildGreenButtonNotificationEnvelope,
  parseIngestionEnvelope,
} from "@/server/pipelines/data-ingestion/envelope";

describe("ingestion envelope", () => {
  it("parses canonical payloads", () => {
    const envelope = buildGreenButtonNotificationEnvelope({
      requestId: "req_1",
      organizationId: "org_1",
      buildingId: "building_1",
      connectionId: "conn_1",
      notificationUri: "https://utility.example.com/Batch/Subscription/1234",
      subscriptionId: "1234",
      resourceUri: "https://utility.example.com/UsagePoint/1",
    });

    expect(parseIngestionEnvelope(envelope)).toEqual(envelope);
  });

  it("normalizes legacy csv ingestion payloads in one place", () => {
    const envelope = parseIngestionEnvelope({
      organizationId: "org_1",
      buildingId: "building_1",
      uploadBatchId: "batch_1",
      triggerType: "CSV_UPLOAD",
    });

    expect(envelope.payloadVersion).toBe(INGESTION_PAYLOAD_VERSION);
    expect(envelope.jobType).toBe(INGESTION_JOB_TYPE.CSV_UPLOAD_PIPELINE);
    expect(envelope.organizationId).toBe("org_1");
    expect(envelope.buildingId).toBe("building_1");
    if (envelope.jobType !== INGESTION_JOB_TYPE.CSV_UPLOAD_PIPELINE) {
      throw new Error("Expected CSV upload envelope");
    }
    expect(envelope.payload.uploadBatchId).toBe("batch_1");
  });

  it("rejects unsupported payload versions explicitly", () => {
    expect(() =>
      parseIngestionEnvelope({
        payloadVersion: 2,
        requestId: "req_1",
        organizationId: "org_1",
        buildingId: "building_1",
        jobType: INGESTION_JOB_TYPE.CSV_UPLOAD_PIPELINE,
        sourceSystem: "CSV_UPLOAD",
        triggeredAt: new Date().toISOString(),
        payload: {
          uploadBatchId: "batch_1",
          triggerType: "CSV_UPLOAD",
        },
      }),
    ).toThrowError(ContractValidationError);
  });

  it("rejects unsupported legacy payloads that lack tenant and building scope", () => {
    expect(() =>
      parseIngestionEnvelope({
        notificationUri: "https://utility.example.com/Batch/Subscription/1234",
        triggerType: "WEBHOOK",
        source: "GREEN_BUTTON",
      }),
    ).toThrowError(ContractValidationError);
  });
});
