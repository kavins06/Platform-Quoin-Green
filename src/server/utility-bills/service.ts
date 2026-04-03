import { randomUUID, createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma";
import type {
  EnergyUnit,
  MeterType,
  UtilityBillCandidate,
  UtilityBillUpload,
  UtilityBillUtilityType,
} from "@/generated/prisma/client";
import { prisma, getTenantClient } from "@/server/lib/db";
import { createLogger } from "@/server/lib/logger";
import { QUEUES, withQueue } from "@/server/lib/queue";
import {
  NotFoundError,
  ValidationError,
  WorkflowStateError,
} from "@/server/lib/errors";
import {
  createSignedStorageUrl,
  downloadPrivateStorageObject,
  ensurePrivateStorageBucket,
  uploadPrivateStorageObject,
} from "@/server/lib/supabase-admin";
import { createAuditLog } from "@/server/lib/audit-log";
import {
  extractUtilityBillCandidates,
  UTILITY_BILL_BUCKET,
} from "@/server/utility-bills/extract";
import { normalizeReading } from "@/server/pipelines/data-ingestion/normalizer";
import { validateReading } from "@/server/pipelines/data-ingestion/validator";
import { runIngestionPipeline } from "@/server/pipelines/data-ingestion/logic";
import { refreshBuildingIssuesAfterDataChange } from "@/server/compliance/data-issues";

const BILL_FILE_TYPES = new Map<string, string[]>([
  ["application/pdf", [".pdf"]],
  ["image/png", [".png"]],
  ["image/jpeg", [".jpg", ".jpeg"]],
]);

const REVIEWABLE_UPLOAD_STATUSES = new Set(["READY_FOR_REVIEW", "CONFIRMED", "FAILED"]);

type UtilityBillUploadRecord = Pick<
  UtilityBillUpload,
  | "id"
  | "organizationId"
  | "buildingId"
  | "status"
  | "extractionMethod"
  | "originalFileName"
  | "mimeType"
  | "fileSizeBytes"
  | "storageBucket"
  | "storagePath"
  | "latestErrorCode"
  | "latestErrorMessage"
  | "attemptCount"
  | "processedAt"
  | "confirmedAt"
  | "createdAt"
  | "updatedAt"
  | "sourceArtifactId"
  | "rawHeuristicJson"
>;

type UtilityBillCandidateRecord = Pick<
  UtilityBillCandidate,
  | "id"
  | "utilityType"
  | "unit"
  | "periodStart"
  | "periodEnd"
  | "consumption"
  | "confidence"
  | "extractionMethod"
  | "sourcePage"
  | "sourceSnippet"
  | "status"
  | "confirmedReadingId"
>;

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function ensureSupportedBillFile(fileName: string, mimeType: string, fileSize: number) {
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const supportedExtensions = BILL_FILE_TYPES.get(mimeType);

  if (!supportedExtensions || !supportedExtensions.includes(extension)) {
    throw new ValidationError("Bill upload must be a PDF, PNG, JPG, or JPEG file.");
  }

  if (fileSize > 20 * 1024 * 1024) {
    throw new ValidationError("Bill upload is too large. The maximum size is 20MB.");
  }
}

function utilityTypeToMeterType(utilityType: UtilityBillUtilityType): MeterType {
  switch (utilityType) {
    case "ELECTRIC":
      return "ELECTRIC";
    case "GAS":
      return "GAS";
    case "WATER":
      return "WATER_INDOOR";
  }
}

function utilityTypeLabel(utilityType: UtilityBillUtilityType) {
  switch (utilityType) {
    case "ELECTRIC":
      return "Electricity";
    case "GAS":
      return "Gas";
    case "WATER":
      return "Water";
  }
}

function defaultUnitForUtilityType(utilityType: UtilityBillUtilityType): EnergyUnit {
  switch (utilityType) {
    case "ELECTRIC":
      return "KWH";
    case "GAS":
      return "THERMS";
    case "WATER":
      return "KGAL";
  }
}

function allowedUnitsForUtilityType(utilityType: UtilityBillUtilityType): EnergyUnit[] {
  switch (utilityType) {
    case "ELECTRIC":
      return ["KWH", "KBTU", "MMBTU"];
    case "GAS":
      return ["THERMS", "CCF", "KBTU", "MMBTU"];
    case "WATER":
      return ["GAL", "KGAL", "CCF"];
  }
}

function getExpectedUtilityType(rawHeuristicJson: unknown): UtilityBillUtilityType | null {
  if (!rawHeuristicJson || typeof rawHeuristicJson !== "object" || Array.isArray(rawHeuristicJson)) {
    return null;
  }

  const uploadContext = (rawHeuristicJson as Record<string, unknown>).uploadContext;
  if (!uploadContext || typeof uploadContext !== "object" || Array.isArray(uploadContext)) {
    return null;
  }

  const expectedUtilityType = (uploadContext as Record<string, unknown>).expectedUtilityType;
  if (
    expectedUtilityType === "ELECTRIC" ||
    expectedUtilityType === "GAS" ||
    expectedUtilityType === "WATER"
  ) {
    return expectedUtilityType;
  }

  return null;
}

function resolveUploadUtilityType(input: {
  rawHeuristicJson: unknown;
  candidates: Array<Pick<UtilityBillCandidate, "utilityType">>;
}): UtilityBillUtilityType | null {
  const expectedUtilityType = getExpectedUtilityType(input.rawHeuristicJson);
  if (expectedUtilityType) {
    return expectedUtilityType;
  }

  const candidateUtilityType = input.candidates[0]?.utilityType;
  return candidateUtilityType ?? null;
}

function withUploadContext(
  rawHeuristic: Record<string, unknown>,
  expectedUtilityType: UtilityBillUtilityType | null,
) {
  if (!expectedUtilityType) {
    return rawHeuristic;
  }

  return {
    ...rawHeuristic,
    uploadContext: {
      expectedUtilityType,
    },
  };
}

function constrainCandidatesToUtility(
  candidates: Awaited<ReturnType<typeof extractUtilityBillCandidates>>["candidates"],
  expectedUtilityType: UtilityBillUtilityType | null,
) {
  if (!expectedUtilityType) {
    return candidates;
  }

  const allowedUnits = new Set(allowedUnitsForUtilityType(expectedUtilityType));
  const defaultUnit = defaultUnitForUtilityType(expectedUtilityType);

  return candidates.map((candidate) => ({
    ...candidate,
    utilityType: expectedUtilityType,
    unit: allowedUnits.has(candidate.unit) ? candidate.unit : defaultUnit,
  }));
}

function buildBillMeterName(utilityType: UtilityBillUtilityType) {
  return `Bill Upload ${utilityTypeLabel(utilityType)}`;
}

async function resolveBillUploadMeter(input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  buildingId: string;
  utilityType: UtilityBillUtilityType;
  unit: EnergyUnit;
}) {
  const familyMeterTypes: MeterType[] =
    input.utilityType === "WATER"
      ? ["WATER_INDOOR", "WATER_OUTDOOR", "WATER_RECYCLED"]
      : [utilityTypeToMeterType(input.utilityType)];

  const activeMeters = await input.tx.meter.findMany({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      isActive: true,
      meterType: {
        in: familyMeterTypes,
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  if (activeMeters.length === 1) {
    return activeMeters[0];
  }

  const canonicalMeterType = utilityTypeToMeterType(input.utilityType);
  const canonicalMeterName = buildBillMeterName(input.utilityType);
  const existingCanonical = activeMeters.find(
    (meter) => meter.meterType === canonicalMeterType && meter.name === canonicalMeterName,
  );

  if (existingCanonical) {
    return existingCanonical;
  }

  return input.tx.meter.create({
    data: {
      buildingId: input.buildingId,
      organizationId: input.organizationId,
      meterType: canonicalMeterType,
      name: canonicalMeterName,
      unit: input.unit,
      isActive: true,
    },
  });
}

async function requireBuilding(input: {
  organizationId: string;
  buildingId: string;
}) {
  const building = await prisma.building.findFirst({
    where: {
      id: input.buildingId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      organizationId: true,
      grossSquareFeet: true,
    },
  });

  if (!building) {
    throw new NotFoundError("Building not found");
  }

  return building;
}

async function loadUploadForBuilding(input: {
  organizationId: string;
  buildingId: string;
  uploadId: string;
}) {
  const upload = await prisma.utilityBillUpload.findFirst({
    where: {
      id: input.uploadId,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
    },
  });

  if (!upload) {
    throw new NotFoundError("Utility bill upload not found");
  }

  return upload;
}

function createSourceHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function enqueueUtilityBillExtraction(input: {
  uploadId: string;
  organizationId: string;
  buildingId: string;
  requestId?: string | null;
}) {
  await withQueue(QUEUES.UTILITY_BILL_EXTRACTION, async (utilityBillQueue) => {
    await utilityBillQueue.add(
      "utility-bill-extraction",
      {
        uploadId: input.uploadId,
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        requestId: input.requestId ?? null,
      },
      {
        jobId: `utility-bill-${input.uploadId}`,
      },
    );
  });
}

export async function createUtilityBillUpload(input: {
  organizationId: string;
  buildingId: string;
  actorId?: string | null;
  requestId?: string | null;
  fileName: string;
  mimeType: string;
  fileBytes: Buffer;
  expectedUtilityType?: UtilityBillUtilityType;
}) {
  const logger = createLogger({
    requestId: input.requestId ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    procedure: "utilityBills.createUpload",
  });
  await requireBuilding({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
  });
  ensureSupportedBillFile(input.fileName, input.mimeType, input.fileBytes.byteLength);
  await ensurePrivateStorageBucket(UTILITY_BILL_BUCKET);

  const storageObjectId = randomUUID();
  const sanitizedFileName = sanitizeFileName(input.fileName);
  const storagePath = [
    "organizations",
    input.organizationId,
    "buildings",
    input.buildingId,
    "utility-bills",
    storageObjectId,
    sanitizedFileName,
  ].join("/");

  await uploadPrivateStorageObject({
    bucketName: UTILITY_BILL_BUCKET,
    storagePath,
    file: input.fileBytes,
    contentType: input.mimeType,
  });

  const sourceArtifact = await prisma.sourceArtifact.create({
    data: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      artifactType: "UTILITY_FILE",
      name: input.fileName,
      storageUri: `supabase://${UTILITY_BILL_BUCKET}/${storagePath}`,
      sourceHash: createSourceHash(input.fileBytes),
      metadata: {
        bucketName: UTILITY_BILL_BUCKET,
        storagePath,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileBytes.byteLength,
      },
      createdByType: "USER",
      createdById: input.actorId ?? null,
    },
  });

  const upload = await prisma.utilityBillUpload.create({
    data: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      sourceArtifactId: sourceArtifact.id,
      status: "QUEUED",
      originalFileName: input.fileName,
      mimeType: input.mimeType,
        fileSizeBytes: input.fileBytes.byteLength,
        storageBucket: UTILITY_BILL_BUCKET,
        storagePath,
        rawHeuristicJson: toJson(withUploadContext({}, input.expectedUtilityType ?? null)),
        createdByType: "USER",
        createdById: input.actorId ?? null,
      },
  });

  try {
    await enqueueUtilityBillExtraction({
      uploadId: upload.id,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      requestId: input.requestId ?? null,
    });
    } catch (error) {
      logger.error("Failed to enqueue bill extraction", { error, uploadId: upload.id });
      const enqueueMessage =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Quoin could not enqueue OCR extraction for this upload.";
      await prisma.utilityBillUpload.update({
        where: { id: upload.id },
        data: {
          status: "FAILED",
          latestErrorCode: "UTILITY_BILL_QUEUE_FAILED",
          latestErrorMessage: enqueueMessage,
        },
      });
    }

  await createAuditLog({
    actorType: "USER",
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    action: "UTILITY_BILL_UPLOAD_CREATED",
    inputSnapshot: {
      uploadId: upload.id,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileBytes.byteLength,
    },
    outputSnapshot: {
      status: upload.status,
      sourceArtifactId: sourceArtifact.id,
    },
    requestId: input.requestId ?? null,
  }).catch(() => null);

  return {
    id: upload.id,
    status: upload.status,
  };
}

export async function processUtilityBillUpload(input: {
  uploadId: string;
  requestId?: string | null;
}) {
  const upload = await prisma.utilityBillUpload.findUnique({
    where: { id: input.uploadId },
  });

  if (!upload) {
    throw new NotFoundError("Utility bill upload not found");
  }

  const logger = createLogger({
    requestId: input.requestId ?? null,
    organizationId: upload.organizationId,
    buildingId: upload.buildingId,
    procedure: "utilityBills.processUpload",
  });

  await prisma.utilityBillUpload.update({
    where: { id: upload.id },
    data: {
      status: "PROCESSING",
      latestErrorCode: null,
      latestErrorMessage: null,
      attemptCount: { increment: 1 },
    },
  });

  try {
    const expectedUtilityType = getExpectedUtilityType(upload.rawHeuristicJson);
    const fileBlob = await downloadPrivateStorageObject({
      bucketName: upload.storageBucket,
      storagePath: upload.storagePath,
    });
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const extraction = await extractUtilityBillCandidates({
      fileBuffer: buffer,
      fileName: upload.originalFileName,
      mimeType: upload.mimeType,
      bucketName: upload.storageBucket,
      storagePath: upload.storagePath,
      requestId: input.requestId ?? null,
    });
    const constrainedCandidates = constrainCandidatesToUtility(
      extraction.candidates,
      expectedUtilityType,
    );
    const heuristicPayload = withUploadContext(extraction.rawHeuristic, expectedUtilityType);

    await prisma.$transaction(async (tx) => {
      await tx.utilityBillCandidate.deleteMany({
        where: { uploadId: upload.id },
      });

      if (constrainedCandidates.length === 0) {
        await tx.utilityBillUpload.update({
          where: { id: upload.id },
          data: {
            status: "FAILED",
            extractionMethod: extraction.textSourceMethod,
            rawText: extraction.rawText,
            rawOcrJson: toJson(extraction.rawOcr),
            rawHeuristicJson: toJson(heuristicPayload),
            rawGeminiJson: toJson(extraction.rawGemini),
            latestErrorCode: "UTILITY_BILL_NO_CANDIDATES",
            latestErrorMessage:
              "Quoin could not find a current billed-period reading in this bill. Review the file and retry.",
            processedAt: new Date(),
          },
        });
        return;
      }

      await tx.utilityBillUpload.update({
        where: { id: upload.id },
        data: {
            status: "READY_FOR_REVIEW",
            extractionMethod: extraction.textSourceMethod,
            rawText: extraction.rawText,
            rawOcrJson: toJson(extraction.rawOcr),
            rawHeuristicJson: toJson(heuristicPayload),
            rawGeminiJson: toJson(extraction.rawGemini),
          latestErrorCode: null,
          latestErrorMessage: null,
          processedAt: new Date(),
        },
      });

      await tx.utilityBillCandidate.createMany({
          data: constrainedCandidates.map((candidate) => ({
            uploadId: upload.id,
          organizationId: upload.organizationId,
          buildingId: upload.buildingId,
          utilityType: candidate.utilityType,
          unit: candidate.unit,
          periodStart: candidate.periodStart,
          periodEnd: candidate.periodEnd,
          consumption: candidate.consumption,
          confidence: candidate.confidence,
          extractionMethod: candidate.extractionMethod,
          sourcePage: candidate.sourcePage,
          sourceSnippet: candidate.sourceSnippet,
          rawResultJson: toJson(candidate.rawResult),
          status: "PENDING_REVIEW",
        })),
      });
    });
  } catch (error) {
    logger.error("Utility bill extraction failed", { error, uploadId: upload.id });
    await prisma.utilityBillUpload.update({
      where: { id: upload.id },
      data: {
        status: "FAILED",
        latestErrorCode: "UTILITY_BILL_EXTRACTION_FAILED",
        latestErrorMessage:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Utility bill extraction failed.",
        processedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function getUtilityBillUploadReview(input: {
  organizationId: string;
  buildingId: string;
  uploadId: string;
}) {
  const upload = await prisma.utilityBillUpload.findFirst({
    where: {
      id: input.uploadId,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
    },
    include: {
      candidates: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
      sourceArtifact: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!upload) {
    throw new NotFoundError("Utility bill upload not found");
  }

  const fileUrl = REVIEWABLE_UPLOAD_STATUSES.has(upload.status)
    ? await createSignedStorageUrl({
        bucketName: upload.storageBucket,
        storagePath: upload.storagePath,
        expiresInSeconds: 10 * 60,
      })
    : null;

  return {
    id: upload.id,
    status: upload.status,
    extractionMethod: upload.extractionMethod,
    originalFileName: upload.originalFileName,
    mimeType: upload.mimeType,
    latestErrorMessage: upload.latestErrorMessage,
    processedAt: upload.processedAt,
    confirmedAt: upload.confirmedAt,
    attemptCount: upload.attemptCount,
    fileUrl,
    sourceArtifactId: upload.sourceArtifactId,
    expectedUtilityType: getExpectedUtilityType(upload.rawHeuristicJson),
    candidates: upload.candidates.map((candidate) => ({
      id: candidate.id,
      utilityType: candidate.utilityType,
      unit: candidate.unit,
      periodStart: candidate.periodStart,
      periodEnd: candidate.periodEnd,
      consumption: candidate.consumption,
      confidence: candidate.confidence,
      extractionMethod: candidate.extractionMethod,
      sourcePage: candidate.sourcePage,
      sourceSnippet: candidate.sourceSnippet,
      status: candidate.status,
      confirmedReadingId: candidate.confirmedReadingId,
    })),
  };
}

export async function listUtilityBillUploadsForBuilding(input: {
  organizationId: string;
  buildingId: string;
}) {
  const uploads = await prisma.utilityBillUpload.findMany({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      candidates: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          utilityType: true,
          unit: true,
          periodStart: true,
          periodEnd: true,
          consumption: true,
          status: true,
          confirmedReadingId: true,
        },
      },
    },
  });

  const uploadsWithUrls = await Promise.all(
    uploads.map(async (upload) => {
      const fileUrl = await createSignedStorageUrl({
        bucketName: upload.storageBucket,
        storagePath: upload.storagePath,
        expiresInSeconds: 10 * 60,
      });

      const utilityType = resolveUploadUtilityType({
        rawHeuristicJson: upload.rawHeuristicJson,
        candidates: upload.candidates,
      });

      const primaryCandidate =
        upload.candidates.find((candidate) => candidate.status === "CONFIRMED") ??
        upload.candidates[0] ??
        null;

      return {
        id: upload.id,
        status: upload.status,
        utilityType,
        originalFileName: upload.originalFileName,
        createdAt: upload.createdAt,
        confirmedAt: upload.confirmedAt,
        fileUrl,
        latestErrorMessage: upload.latestErrorMessage,
        periodStart: primaryCandidate?.periodStart ?? null,
        periodEnd: primaryCandidate?.periodEnd ?? null,
        unit: primaryCandidate?.unit ?? null,
        consumption: primaryCandidate?.consumption ?? null,
      };
    }),
  );

  return uploadsWithUrls;
}

export async function retryUtilityBillUpload(input: {
  organizationId: string;
  buildingId: string;
  uploadId: string;
  requestId?: string | null;
}) {
  const upload = await loadUploadForBuilding(input);

  await prisma.utilityBillUpload.update({
    where: { id: upload.id },
    data: {
      status: "QUEUED",
      latestErrorCode: null,
      latestErrorMessage: null,
    },
  });

  try {
    await enqueueUtilityBillExtraction({
      uploadId: upload.id,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      requestId: input.requestId ?? null,
    });
  } catch (error) {
    const enqueueMessage =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Quoin could not enqueue OCR extraction for this upload.";
    await prisma.utilityBillUpload.update({
      where: { id: upload.id },
      data: {
        status: "FAILED",
        latestErrorCode: "UTILITY_BILL_QUEUE_FAILED",
        latestErrorMessage: enqueueMessage,
      },
    });
    throw error;
  }

  return { success: true };
}

export async function confirmUtilityBillCandidates(input: {
  organizationId: string;
  buildingId: string;
  uploadId: string;
  actorId?: string | null;
  requestId?: string | null;
  candidates: Array<{
    candidateId: string;
    utilityType: UtilityBillUtilityType;
    unit: EnergyUnit;
    periodStart: Date;
    periodEnd: Date;
    consumption: number;
  }>;
}) {
  if (input.candidates.length === 0) {
    throw new ValidationError("At least one extracted reading is required.");
  }

  const [building, upload] = await Promise.all([
    requireBuilding({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
    }),
    loadUploadForBuilding({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      uploadId: input.uploadId,
    }),
  ]);

  if (upload.status !== "READY_FOR_REVIEW") {
    throw new WorkflowStateError("This bill upload is not ready for confirmation.");
  }

  const uploadBatchId = `bill_${upload.id}`;
  const expectedUtilityType = getExpectedUtilityType(upload.rawHeuristicJson);
  const pendingCandidates = await prisma.utilityBillCandidate.findMany({
    where: {
      uploadId: upload.id,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      status: "PENDING_REVIEW",
      id: {
        in: input.candidates.map((candidate) => candidate.candidateId),
      },
    },
  });

  if (pendingCandidates.length !== input.candidates.length) {
    throw new ValidationError("One or more bill reading candidates are no longer available.");
  }

  const pendingById = new Map(pendingCandidates.map((candidate) => [candidate.id, candidate]));
  const createdReadingIds = await prisma.$transaction(async (tx) => {
    const readingIds: string[] = [];

    for (const candidateInput of input.candidates) {
      if (expectedUtilityType && candidateInput.utilityType !== expectedUtilityType) {
        throw new ValidationError(
          `This upload is locked to ${utilityTypeLabel(expectedUtilityType)}.`,
        );
      }

      const original = pendingById.get(candidateInput.candidateId);
      if (!original) {
        throw new ValidationError("Bill candidate could not be found for confirmation.");
      }

      const meterType = utilityTypeToMeterType(candidateInput.utilityType);
      const normalized = normalizeReading(
        {
          rowIndex: 1,
          startDate: candidateInput.periodStart,
          endDate: candidateInput.periodEnd,
          consumption: candidateInput.consumption,
          cost: null,
          unit: candidateInput.unit,
          raw: {},
        },
        candidateInput.unit,
        meterType,
      );

      if (!normalized) {
        throw new ValidationError("The confirmed bill reading could not be normalized.");
      }

      const validation = validateReading(normalized, building.grossSquareFeet);
      if (!validation.valid) {
        throw new ValidationError(validation.errors[0] ?? "Bill reading validation failed.");
      }

      const meter = await resolveBillUploadMeter({
        tx,
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        utilityType: candidateInput.utilityType,
        unit: normalized.unit,
      });

      const created = await tx.energyReading.create({
        data: {
          buildingId: input.buildingId,
          organizationId: input.organizationId,
          source: "BILL_UPLOAD",
          meterId: meter.id,
          meterType: meter.meterType,
          periodStart: normalized.periodStart,
          periodEnd: normalized.periodEnd,
          consumption: normalized.consumption,
          unit: normalized.unit,
          consumptionKbtu: normalized.consumptionKbtu,
          cost: null,
          isVerified: true,
          uploadBatchId,
          rawPayload: toJson({
            sourceArtifactId: upload.sourceArtifactId,
            billUploadId: upload.id,
            candidateId: original.id,
            extractionMethod: original.extractionMethod,
            sourcePage: original.sourcePage,
            sourceSnippet: original.sourceSnippet,
          }),
        },
      });

      await tx.utilityBillCandidate.update({
        where: { id: original.id },
        data: {
          utilityType: candidateInput.utilityType,
          unit: normalized.unit,
          periodStart: normalized.periodStart,
          periodEnd: normalized.periodEnd,
          consumption: normalized.consumption,
          status: "CONFIRMED",
          confirmedReadingId: created.id,
        },
      });

      readingIds.push(created.id);
    }

    await tx.utilityBillUpload.update({
      where: { id: upload.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });

    return readingIds;
  });

  const tenantDb = getTenantClient(input.organizationId);
  try {
    await runIngestionPipeline({
      buildingId: input.buildingId,
      organizationId: input.organizationId,
      uploadBatchId,
      triggerType: "MANUAL",
      tenantDb,
    });
  } catch (error) {
    createLogger({
      requestId: input.requestId ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      procedure: "utilityBills.confirm",
    }).warn("Bill upload ingestion pipeline failed after confirmation", {
      error,
      uploadId: upload.id,
    });
  }

  await refreshBuildingIssuesAfterDataChange({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    actorType: "USER",
    actorId: input.actorId ?? null,
    requestId: input.requestId ?? null,
  });

  await createAuditLog({
    actorType: "USER",
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    action: "UTILITY_BILL_UPLOAD_CONFIRMED",
    inputSnapshot: {
      uploadId: upload.id,
      candidateCount: input.candidates.length,
      uploadBatchId,
    },
    outputSnapshot: {
      readingIds: createdReadingIds,
    },
    requestId: input.requestId ?? null,
  }).catch(() => null);

  return {
    success: true,
    readingIds: createdReadingIds,
    uploadBatchId,
  };
}
