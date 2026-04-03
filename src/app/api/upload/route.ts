import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processCSVUpload } from "@/server/pipelines/data-ingestion/logic";
import type { MeterType } from "@/server/pipelines/data-ingestion/types";
import {
  TenantAccessError,
  requireOperatorTenantContextFromSession,
} from "@/server/lib/tenant-access";
import { createLogger } from "@/server/lib/logger";
import { refreshBuildingIssuesAfterDataChange } from "@/server/compliance/data-issues";
import {
  applyRateLimit,
  createRateLimitExceededResponse,
  getRateLimitClientKey,
  withRateLimitHeaders,
} from "@/server/lib/rate-limit";

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const logger = createLogger({
    requestId,
    procedure: "upload.csv",
  });
  const rateLimit = await applyRateLimit({
    scope: "upload-csv",
    key: getRateLimitClientKey(req),
    limit: 12,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return createRateLimitExceededResponse({
      message: "Too many CSV uploads. Please wait and try again.",
      result: rateLimit,
    });
  }
  let tenant;
  try {
    tenant = await requireOperatorTenantContextFromSession();
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return withRateLimitHeaders(
        NextResponse.json({ error: error.message }, { status: error.status }),
        rateLimit,
      );
    }

    throw error;
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const buildingId = formData.get("buildingId") as string | null;
    const meterTypeHint = formData.get("meterType") as string | null;
    const unitHint = formData.get("unit") as string | null;

    if (!file) {
      return withRateLimitHeaders(
        NextResponse.json(
          { error: "No file provided" },
          { status: 400 },
        ),
        rateLimit,
      );
    }
    if (!buildingId) {
      return withRateLimitHeaders(
        NextResponse.json(
          { error: "buildingId is required" },
          { status: 400 },
        ),
        rateLimit,
      );
    }

    if (
      !file.name.endsWith(".csv") &&
      !file.name.endsWith(".tsv") &&
      !file.name.endsWith(".txt")
    ) {
      return withRateLimitHeaders(
        NextResponse.json(
          { error: "File must be .csv, .tsv, or .txt" },
          { status: 400 },
        ),
        rateLimit,
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return withRateLimitHeaders(
        NextResponse.json(
          { error: "File too large (max 10MB)" },
          { status: 400 },
        ),
        rateLimit,
      );
    }

    const building = await tenant.tenantDb.building.findUnique({
      where: { id: buildingId },
    });
    if (!building) {
      return withRateLimitHeaders(
        NextResponse.json(
          { error: "Building not found" },
          { status: 404 },
        ),
        rateLimit,
      );
    }

    const csvContent = await file.text();

    const result = await processCSVUpload({
      csvContent,
      buildingId,
      organizationId: tenant.organizationId,
      buildingGSF: building.grossSquareFeet,
      meterTypeHint: (meterTypeHint as MeterType) || undefined,
      unitHint: unitHint || undefined,
      tenantDb: tenant.tenantDb,
    });

    // Run pipeline inline to create local derived artifacts.
    try {
      const { runIngestionPipeline } = await import("@/server/pipelines/data-ingestion/logic");
      const pipelineResult = await runIngestionPipeline({
        buildingId,
        organizationId: tenant.organizationId,
        uploadBatchId: result.uploadBatchId,
        triggerType: "CSV_UPLOAD",
        tenantDb: tenant.tenantDb,
      });
      logger.info("Upload pipeline completed", {
        summary: pipelineResult.summary,
        organizationId: tenant.organizationId,
        buildingId,
      });
      if (pipelineResult.errors.length > 0) {
        result.warnings.push(...pipelineResult.errors.map(e => `Pipeline: ${e}`));
      }
    } catch (pipelineErr) {
      logger.error("Upload pipeline failed", {
        error: pipelineErr,
        organizationId: tenant.organizationId,
        buildingId,
      });
      result.warnings.push(
        "Data saved but compliance snapshot could not be generated. Try refreshing.",
      );
    }

    try {
      await refreshBuildingIssuesAfterDataChange({
        organizationId: tenant.organizationId,
        buildingId,
        actorType: "SYSTEM",
        actorId: null,
        requestId,
      });
    } catch (issueRefreshError) {
      logger.warn("Upload issue refresh failed", {
        error: issueRefreshError,
        organizationId: tenant.organizationId,
        buildingId,
      });
    }

    return withRateLimitHeaders(
      NextResponse.json(result, { status: result.success ? 200 : 422 }),
      rateLimit,
    );
  } catch (error) {
    logger.error("Upload processing failed", {
      error,
    });
    return withRateLimitHeaders(
      NextResponse.json(
        { error: "Upload processing failed" },
        { status: 500 },
      ),
      rateLimit,
    );
  }
}
