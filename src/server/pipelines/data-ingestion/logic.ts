import { parseCSV, detectColumns, extractRows } from "./csv-parser";
import { normalizeReading } from "./normalizer";
import { validateReading, findDuplicatePeriods } from "./validator";
import {
  calculateEUI,
  buildSnapshotData,
  computeDataQualityScore,
} from "./snapshot";
import { syncWithESPM, type ESPMSyncResult } from "./espm-sync";
import type { ESPM } from "@/server/integrations/espm";
import type { UploadResult, NormalizedReading, MeterType } from "./types";
import { prisma } from "@/server/lib/db";
import { getLatestComplianceSnapshot } from "@/server/lib/compliance-snapshots";
import { NotFoundError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import {
  BOOTSTRAP_FACTOR_SET_KEY,
  BOOTSTRAP_RULE_PACKAGE_KEYS,
  getActiveFactorSetVersion,
  getActiveRuleVersion,
  recordComplianceEvaluation,
} from "@/server/compliance/provenance";
import { refreshDerivedBepsMetricInput } from "@/server/compliance/beps";

interface ProcessCSVParams {
  csvContent: string;
  buildingId: string;
  organizationId: string;
  buildingGSF: number;
  meterTypeHint?: MeterType;
  unitHint?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenantDb: any;
}

const EMPTY_MAPPING = {
  startDate: null,
  endDate: null,
  consumption: null,
  cost: null,
  unit: null,
  confidence: 0,
  detectedMeterType: "ELECTRIC" as MeterType,
  detectedUnit: "unknown",
};

/**
 * Process a CSV upload end-to-end.
 *
 * Flow: Parse -> Detect Columns -> Extract -> Normalize -> Validate -> Persist
 *
 * Readings with blocking errors are SKIPPED.
 * Readings with warnings are persisted but warnings are included in the result.
 */
export async function processCSVUpload(
  params: ProcessCSVParams,
): Promise<UploadResult> {
  const {
    csvContent,
    buildingId,
    organizationId,
    buildingGSF,
    meterTypeHint,
    unitHint,
    tenantDb,
  } = params;

  const uploadBatchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)} `;
  const allWarnings: string[] = [];
  const allErrors: string[] = [];

  // Step 1: Parse CSV
  const { headers, rows } = parseCSV(csvContent);
  if (rows.length === 0) {
    return {
      success: false,
      buildingId,
      uploadBatchId,
      readingsCreated: 0,
      readingsRejected: 0,
      warnings: [],
      errors: ["CSV has no data rows"],
      columnMapping: EMPTY_MAPPING,
      dateRange: null,
    };
  }

  // Step 2: Detect columns
  const mapping = detectColumns(headers);
  if (mapping.confidence < 0.3) {
    allWarnings.push(
      `Low confidence column detection(${(mapping.confidence * 100).toFixed(0)}%).Manual mapping may be needed.`,
    );
  }
  if (!mapping.consumption) {
    return {
      success: false,
      buildingId,
      uploadBatchId,
      readingsCreated: 0,
      readingsRejected: rows.length,
      warnings: allWarnings,
      errors: [
        "Could not detect a consumption column. Available columns: " +
        headers.join(", "),
      ],
      columnMapping: mapping,
      dateRange: null,
    };
  }

  const effectiveMeterType = meterTypeHint || mapping.detectedMeterType;
  const effectiveUnit = unitHint || mapping.detectedUnit;

  // Step 3: Extract rows
  const parsedRows = extractRows(headers, rows, mapping);

  // Step 4: Normalize + Step 5: Validate
  const normalized: NormalizedReading[] = [];
  let rejected = 0;

  for (const row of parsedRows) {
    const reading = normalizeReading(row, effectiveUnit, effectiveMeterType);
    if (!reading) {
      rejected++;
      allErrors.push(
        `Row ${row.rowIndex}: Could not normalize(missing date or consumption)`,
      );
      continue;
    }

    const validation = validateReading(reading, buildingGSF);
    allWarnings.push(
      ...validation.warnings.map((w) => `Row ${row.rowIndex}: ${w} `),
    );

    if (!validation.valid) {
      rejected++;
      allErrors.push(
        ...validation.errors.map((e) => `Row ${row.rowIndex}: ${e} `),
      );
      continue;
    }

    normalized.push(reading);
  }

  // Step 5b: Duplicate period check
  const duplicateIndices = findDuplicatePeriods(normalized);
  if (duplicateIndices.length > 0) {
    allWarnings.push(
      `Found ${duplicateIndices.length} overlapping billing periods.Later entries will be kept.`,
    );
    for (let i = duplicateIndices.length - 1; i >= 0; i--) {
      normalized.splice(duplicateIndices[i], 1);
      rejected++;
    }
  }

  if (normalized.length === 0) {
    return {
      success: false,
      buildingId,
      uploadBatchId,
      readingsCreated: 0,
      readingsRejected: rejected,
      warnings: allWarnings,
      errors:
        allErrors.length > 0
          ? allErrors
          : ["No valid readings found in CSV"],
      columnMapping: mapping,
      dateRange: null,
    };
  }

  // Step 6: Persist EnergyReadings (append-only)
  const created = await tenantDb.energyReading.createMany({
    data: normalized.map((r) => ({
      buildingId,
      organizationId,
      source: "CSV_UPLOAD",
      meterType: r.meterType,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      consumption: r.consumption,
      unit: r.unit,
      consumptionKbtu: r.consumptionKbtu,
      cost: r.cost,
      uploadBatchId,
    })),
  });

  const dates = normalized.map((r) => r.periodStart);
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

  return {
    success: true,
    buildingId,
    uploadBatchId,
    readingsCreated: created.count,
    readingsRejected: rejected,
    warnings: allWarnings,
    errors: allErrors,
    columnMapping: mapping,
    dateRange: { start: minDate, end: maxDate },
  };
}

// ── Full Ingestion Pipeline ─────────────────────────────────────────────────

export interface IngestionPipelineInput {
  buildingId: string;
  organizationId: string;
  uploadBatchId: string;
  triggerType: "CSV_UPLOAD" | "MANUAL" | "WEBHOOK" | "SCHEDULED";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenantDb: any;
  espmClient?: ESPM;
}

export interface IngestionPipelineResult {
  success: boolean;
  snapshotId: string | null;
  pipelineRunId: string | null;
  espmSync: ESPMSyncResult | null;
  errors: string[];
  summary: string;
}

/**
 * Full data ingestion pipeline — called by BullMQ worker after CSV upload.
 *
 * Steps:
 * 1. Load building + last 12 months of readings
 * 2. Calculate EUI
 * 3. (Optional) Sync with ESPM — push data, pull score
 * 4. Build and persist ComplianceSnapshot (append-only)
 * 5. Create PipelineRun audit record
 */
export async function runIngestionPipeline(
  input: IngestionPipelineInput,
): Promise<IngestionPipelineResult> {
  const startTime = Date.now();
  const logger = createLogger({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    procedure: "dataIngestion.pipeline",
  });
  const errors: string[] = [];
  let pipelineRunId: string | null = null;
  let espmSyncResult: ESPMSyncResult | null = null;

  try {
    // Step 1: Load building
    const building = await input.tenantDb.building.findUnique({
      where: { id: input.buildingId },
    });
    if (!building) {
      throw new NotFoundError(`Building ${input.buildingId} not found`);
    }

    // Load last 12 months of readings
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const readings = await input.tenantDb.energyReading.findMany({
      where: {
        buildingId: input.buildingId,
        periodStart: { gte: twelveMonthsAgo },
      },
      orderBy: { periodStart: "asc" },
    });

    if (readings.length === 0) {
      return {
        success: false,
        snapshotId: null,
        pipelineRunId: null,
        espmSync: null,
        errors: [
          "No energy readings found for this building in the last 12 months",
        ],
        summary: "Pipeline skipped: no readings",
      };
    }

    // Step 2: Calculate EUI
    const eui = calculateEUI(
      readings.map((r: { consumptionKbtu: number; meterType: MeterType; periodStart: Date }) => ({
        consumptionKbtu: r.consumptionKbtu,
        meterType: r.meterType,
        periodStart: r.periodStart,
      })),
      building.grossSquareFeet,
    );

    // Step 3: Optional ESPM sync
    let energyStarScore: number | null = null;
    let weatherNormalizedSiteEui: number | null = null;
    let weatherNormalizedSourceEui: number | null = null;
    const effectiveEspmId = building.espmPropertyId;

    if (input.espmClient && effectiveEspmId) {
      const newReadings = await input.tenantDb.energyReading.findMany({
        where: {
          buildingId: input.buildingId,
          uploadBatchId: input.uploadBatchId,
        },
      });

      espmSyncResult = await syncWithESPM(input.espmClient, {
        espmPropertyId: Number(effectiveEspmId),
        espmMeterId: null,
        readings: newReadings.map((r: { periodStart: Date; periodEnd: Date; consumption: number; unit: string }) => ({
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          consumptionNative: r.consumption,
          nativeUnit: r.unit,
        })),
      });

      if (espmSyncResult.metrics?.score != null) {
        energyStarScore = espmSyncResult.metrics.score;
      }
      if (espmSyncResult.metrics?.weatherNormalizedSiteIntensity != null) {
        weatherNormalizedSiteEui = espmSyncResult.metrics.weatherNormalizedSiteIntensity;
      }
      if (espmSyncResult.metrics?.weatherNormalizedSourceIntensity != null) {
        weatherNormalizedSourceEui =
          espmSyncResult.metrics.weatherNormalizedSourceIntensity;
      }
      if (espmSyncResult.pushError) {
        errors.push(`ESPM push failed: ${espmSyncResult.pushError} `);
      }
      if (espmSyncResult.metricsError) {
        errors.push(`ESPM metrics pull failed: ${espmSyncResult.metricsError} `);
      }
    } else if (input.espmClient && !effectiveEspmId) {
      errors.push(
        "ESPM sync skipped: building is not linked to a Portfolio Manager property.",
      );
    }

    // Compute data quality
    const uploadReadings = await input.tenantDb.energyReading.findMany({
      where: { uploadBatchId: input.uploadBatchId },
    });
    const dataQualityScore = computeDataQualityScore(
      uploadReadings.length,
      0,
      errors.length,
      eui.monthsCovered,
    );

    // Carry forward previous score if ESPM didn't return one
    if (energyStarScore == null) {
      const prevSnapshot = await getLatestComplianceSnapshot(prisma, {
        buildingId: input.buildingId,
        organizationId: input.organizationId,
        where: {
          energyStarScore: { not: null },
        },
      });
      if (prevSnapshot?.energyStarScore != null) {
        energyStarScore = prevSnapshot.energyStarScore;
        logger.info("Carried forward previous ENERGY STAR score", {
          snapshotId: prevSnapshot.id,
          energyStarScore,
        });
      }
    }

    // Step 4: Build snapshot payload and resolve provenance references
    const snapshotData = buildSnapshotData({
      buildingId: input.buildingId,
      organizationId: input.organizationId,
      grossSquareFeet: building.grossSquareFeet,
      bepsTargetScore: building.bepsTargetScore,
      energyStarScore,
      siteEui: eui.siteEui,
      sourceEui: eui.sourceEui,
      weatherNormalizedSiteEui,
      weatherNormalizedSourceEui,
      dataQualityScore,
    });

    const [ruleVersion, factorSetVersion] = await Promise.all([
      getActiveRuleVersion(BOOTSTRAP_RULE_PACKAGE_KEYS.bepsCycle1),
      getActiveFactorSetVersion(BOOTSTRAP_FACTOR_SET_KEY),
    ]);

    // Step 5: Create PipelineRun audit record
    const durationMs = Date.now() - startTime;
    const pipelineRun = await prisma.pipelineRun.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        pipelineType: "DATA_INGESTION",
        triggerType: input.triggerType,
        status: "COMPLETED",
        durationMs,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        inputSummary: {
          uploadBatchId: input.uploadBatchId,
          triggerType: input.triggerType,
          readingsLoaded: readings.length,
          newReadings: uploadReadings.length,
        },
        outputSummary: {
          energyStarScore,
          siteEui: eui.siteEui,
          sourceEui: eui.sourceEui,
          weatherNormalizedSiteEui,
          complianceStatus: snapshotData.complianceStatus,
          estimatedPenalty: snapshotData.estimatedPenalty,
          monthsCovered: eui.monthsCovered,
          espmSynced: espmSyncResult?.pushed ?? false,
        },
        errorMessage: errors.length > 0 ? errors.join("; ") : null,
      },
    });
    pipelineRunId = pipelineRun.id;

    const provenance = await recordComplianceEvaluation({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      ruleVersionId: ruleVersion.id,
      factorSetVersionId: factorSetVersion.id,
      pipelineRunId: pipelineRun.id,
      runType: "SNAPSHOT_REFRESH",
      status: "SUCCEEDED",
      inputSnapshotRef: `data_ingestion:${input.uploadBatchId}`,
      inputSnapshotPayload: {
        buildingId: input.buildingId,
        organizationId: input.organizationId,
        uploadBatchId: input.uploadBatchId,
        triggerType: input.triggerType,
        readingsLoaded: readings.length,
        newReadings: uploadReadings.length,
        energyStarScore,
        weatherNormalizedSiteEui,
        weatherNormalizedSourceEui,
        siteEui: eui.siteEui,
        sourceEui: eui.sourceEui,
        monthsCovered: eui.monthsCovered,
        fuelBreakdown: eui.fuelBreakdown,
        dataQualityScore,
      },
      resultPayload: {
        complianceStatus: snapshotData.complianceStatus,
        complianceGap: snapshotData.complianceGap,
        estimatedPenalty: snapshotData.estimatedPenalty,
        energyStarScore,
        siteEui: eui.siteEui,
        sourceEui: eui.sourceEui,
        weatherNormalizedSiteEui,
        monthsCovered: eui.monthsCovered,
        errors,
      },
      producedByType: "SYSTEM",
      producedById: "data-ingestion-pipeline",
      manifest: {
        implementationKey: "data-ingestion/snapshot-v1",
        payload: {
          readingCount: eui.readingCount,
          monthsCovered: eui.monthsCovered,
          fuelBreakdown: eui.fuelBreakdown,
          espmSynced: espmSyncResult?.pushed ?? false,
        },
      },
      snapshotData: {
        ...snapshotData,
        pipelineRunId: pipelineRun.id,
        penaltyInputsJson: {
          grossSquareFeet: building.grossSquareFeet,
          bepsTargetScore: building.bepsTargetScore,
          maxPenaltyExposure: building.maxPenaltyExposure,
          energyStarScore,
          dataQualityScore,
          monthsCovered: eui.monthsCovered,
        },
      },
      evidenceArtifacts: [
        {
          artifactType: "ENERGY_DATA",
          name: "Energy data upload batch",
          artifactRef: input.uploadBatchId,
          metadata: {
            triggerType: input.triggerType,
            readingsLoaded: readings.length,
            newReadings: uploadReadings.length,
          },
        },
      ],
    });

    await prisma.pipelineRun.update({
      where: { id: pipelineRun.id },
      data: {
        outputSummary: {
          snapshotId: provenance.complianceSnapshot?.id ?? null,
          complianceRunId: provenance.complianceRun.id,
          calculationManifestId: provenance.manifest.id,
          energyStarScore,
          siteEui: eui.siteEui,
          sourceEui: eui.sourceEui,
          weatherNormalizedSiteEui,
          weatherNormalizedSourceEui,
          complianceStatus: snapshotData.complianceStatus,
          estimatedPenalty: snapshotData.estimatedPenalty,
          monthsCovered: eui.monthsCovered,
          espmSynced: espmSyncResult?.pushed ?? false,
        },
      },
    });

    await refreshDerivedBepsMetricInput({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      cycle: building.complianceCycle,
    });

    return {
      success: true,
      snapshotId: provenance.complianceSnapshot?.id ?? null,
      pipelineRunId: pipelineRun.id,
      espmSync: espmSyncResult,
      errors,
      summary: `EUI: ${eui.siteEui.toFixed(1)} kBtu / ft² | Score: ${energyStarScore ?? "N/A"} | Status: ${snapshotData.complianceStatus} | Penalty: $${snapshotData.estimatedPenalty.toLocaleString()} `,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    // Record failed pipeline run
    try {
      const failedRun = await input.tenantDb.pipelineRun.create({
        data: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          pipelineType: "DATA_INGESTION",
          triggerType: input.triggerType,
          status: "FAILED",
          durationMs,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          inputSummary: {
            uploadBatchId: input.uploadBatchId,
            triggerType: input.triggerType,
          },
          outputSummary: null,
          errorMessage: message,
        },
      });
      pipelineRunId = failedRun.id;
    } catch {
      /* Don't let audit logging failure mask the real error */
    }

    return {
      success: false,
      snapshotId: null,
      pipelineRunId,
      espmSync: espmSyncResult,
      errors: [message],
      summary: `Pipeline failed: ${message} `,
    };
  }
}
