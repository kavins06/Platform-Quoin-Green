import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  processCSVUploadMock,
  runIngestionPipelineMock,
  requireOperatorTenantContextFromSessionMock,
  refreshBuildingIssuesAfterDataChangeMock,
  loggerMock,
} = vi.hoisted(() => ({
  processCSVUploadMock: vi.fn(),
  runIngestionPipelineMock: vi.fn(),
  requireOperatorTenantContextFromSessionMock: vi.fn(),
  refreshBuildingIssuesAfterDataChangeMock: vi.fn(),
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/server/pipelines/data-ingestion/logic", () => ({
  processCSVUpload: processCSVUploadMock,
  runIngestionPipeline: runIngestionPipelineMock,
}));

vi.mock("@/server/lib/tenant-access", () => ({
  TenantAccessError: class TenantAccessError extends Error {
    status = 403;
  },
  requireOperatorTenantContextFromSession: requireOperatorTenantContextFromSessionMock,
}));

vi.mock("@/server/compliance/data-issues", () => ({
  refreshBuildingIssuesAfterDataChange: refreshBuildingIssuesAfterDataChangeMock,
}));

vi.mock("@/server/lib/logger", () => ({
  createLogger: () => loggerMock,
}));

import { POST } from "@/app/api/upload/route";

describe("upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps upload ingestion local and refreshes reconciliation after local persistence", async () => {
    const tenantDb = {
      building: {
        findUnique: vi.fn().mockResolvedValue({
          id: "building-1",
          grossSquareFeet: 120000,
        }),
      },
    };
    requireOperatorTenantContextFromSessionMock.mockResolvedValue({
      organizationId: "org-1",
      tenantDb,
    });
    processCSVUploadMock.mockResolvedValue({
      success: true,
      uploadBatchId: "batch-1",
      readingsCreated: 12,
      readingsRejected: 0,
      warnings: [],
      errors: [],
      columnMapping: {
        startDate: "Start",
        endDate: "End",
        consumption: "Usage",
        cost: null,
        unit: "Unit",
        confidence: 1,
        detectedMeterType: "ELECTRIC",
        detectedUnit: "kWh",
      },
      dateRange: null,
    });
    runIngestionPipelineMock.mockResolvedValue({
      success: true,
      snapshotId: "snapshot-1",
      pipelineRunId: "pipeline-1",
      espmSync: null,
      errors: [],
      summary: "Pipeline completed",
    });

    const formData = new FormData();
    formData.append("buildingId", "building-1");
    formData.append(
      "file",
      new File(["start,end,usage\n2025-01-01,2025-01-31,100"], "usage.csv", {
        type: "text/csv",
      }),
    );
    const request = new NextRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(runIngestionPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buildingId: "building-1",
        organizationId: "org-1",
        uploadBatchId: "batch-1",
        triggerType: "CSV_UPLOAD",
        tenantDb,
      }),
    );
    expect(runIngestionPipelineMock.mock.calls[0]?.[0]?.espmClient).toBeUndefined();
    expect(refreshBuildingIssuesAfterDataChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        buildingId: "building-1",
      }),
    );
  });

  it("still refreshes reconciliation when the downstream pipeline fails", async () => {
    const tenantDb = {
      building: {
        findUnique: vi.fn().mockResolvedValue({
          id: "building-2",
          grossSquareFeet: 90000,
        }),
      },
    };
    requireOperatorTenantContextFromSessionMock.mockResolvedValue({
      organizationId: "org-2",
      tenantDb,
    });
    processCSVUploadMock.mockResolvedValue({
      success: true,
      uploadBatchId: "batch-2",
      readingsCreated: 4,
      readingsRejected: 0,
      warnings: [],
      errors: [],
      columnMapping: {
        startDate: "Start",
        endDate: "End",
        consumption: "Usage",
        cost: null,
        unit: "Unit",
        confidence: 1,
        detectedMeterType: "GAS",
        detectedUnit: "therms",
      },
      dateRange: null,
    });
    runIngestionPipelineMock.mockRejectedValueOnce(new Error("pipeline exploded"));

    const formData = new FormData();
    formData.append("buildingId", "building-2");
    formData.append(
      "file",
      new File(["start,end,usage\n2025-01-01,2025-01-31,100"], "usage.csv", {
        type: "text/csv",
      }),
    );
    const request = new NextRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.warnings).toContain(
      "Data saved but compliance snapshot could not be generated. Try refreshing.",
    );
    expect(refreshBuildingIssuesAfterDataChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-2",
        buildingId: "building-2",
      }),
    );
    expect(loggerMock.error).toHaveBeenCalledWith(
      "Upload pipeline failed",
      expect.objectContaining({
        organizationId: "org-2",
        buildingId: "building-2",
      }),
    );
  });
});
