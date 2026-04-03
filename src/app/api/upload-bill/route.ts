import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { UtilityBillUtilityType } from "@/generated/prisma/client";
import { AppError } from "@/server/lib/errors";
import {
  TenantAccessError,
  requireOperatorTenantContextFromSession,
} from "@/server/lib/tenant-access";
import { createLogger } from "@/server/lib/logger";
import { createUtilityBillUpload } from "@/server/utility-bills/service";
import {
  applyRateLimit,
  createRateLimitExceededResponse,
  getRateLimitClientKey,
  withRateLimitHeaders,
} from "@/server/lib/rate-limit";

const BILL_UTILITY_TYPES = new Set(["ELECTRIC", "GAS", "WATER"]);

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const logger = createLogger({
    requestId,
    procedure: "upload.bill",
  });
  const rateLimit = await applyRateLimit({
    scope: "upload-bill",
    key: getRateLimitClientKey(req),
    limit: 8,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return createRateLimitExceededResponse({
      message: "Too many bill uploads. Please wait and try again.",
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
    const file = formData.get("file");
    const buildingId = formData.get("buildingId");
    const utilityType = formData.get("utilityType");

    if (!(file instanceof File)) {
      return withRateLimitHeaders(
        NextResponse.json({ error: "No bill file provided." }, { status: 400 }),
        rateLimit,
      );
    }

    if (typeof buildingId !== "string" || buildingId.length === 0) {
      return withRateLimitHeaders(
        NextResponse.json({ error: "buildingId is required." }, { status: 400 }),
        rateLimit,
      );
    }

    if (
      utilityType != null &&
      (typeof utilityType !== "string" || !BILL_UTILITY_TYPES.has(utilityType))
    ) {
      return withRateLimitHeaders(
        NextResponse.json(
          { error: "utilityType must be ELECTRIC, GAS, or WATER." },
          { status: 400 },
        ),
        rateLimit,
      );
    }

    const fileBytes = Buffer.from(await file.arrayBuffer());
    const expectedUtilityType =
      typeof utilityType === "string" ? (utilityType as UtilityBillUtilityType) : undefined;
    const upload = await createUtilityBillUpload({
      organizationId: tenant.organizationId,
      buildingId,
      actorId: tenant.authUserId ?? null,
      requestId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileBytes,
      expectedUtilityType,
    });

    return withRateLimitHeaders(
      NextResponse.json(
        {
          success: true,
          billUploadId: upload.id,
          status: upload.status,
        },
        { status: 200 },
      ),
      rateLimit,
    );
  } catch (error) {
    logger.error("Bill upload failed", { error });

    if (error instanceof AppError) {
      return withRateLimitHeaders(
        NextResponse.json(
          {
            error: error.message,
            code: error.code,
          },
          { status: error.httpStatus },
        ),
        rateLimit,
      );
    }

    return withRateLimitHeaders(
      NextResponse.json(
        {
          error:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Bill upload failed.",
        },
        { status: 500 },
      ),
      rateLimit,
    );
  }
}
