"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorState, Panel, formatDate } from "@/components/internal/admin-primitives";
import {
  StatusBadge,
  getPortfolioManagerCoverageStatusDisplay,
  getPortfolioManagerMetricsStatusDisplay,
  getPortfolioManagerSetupDisplay,
  getPortfolioManagerUsageStatusDisplay,
} from "@/components/internal/status-helpers";
import { PortfolioManagerPushReviewDialog } from "@/components/building/portfolio-manager-push-review-dialog";
import {
  BUILDING_PROPERTY_USE_KEYS,
  getAllPropertyUseFields,
  getPropertyUseDefinition,
  listPropertyUseDefinitions,
  type BuildingPropertyUseKey,
  type PropertyUseFieldDefinition,
} from "@/lib/buildings/property-use-registry";

type EditablePropertyUseInput = {
  id?: string | null;
  sortOrder: number;
  useKey: BuildingPropertyUseKey;
  displayName: string;
  grossSquareFeet: number;
  details: Record<string, string | number | boolean | null>;
};

type LocalMeterDraft = {
  meterId: string;
  strategy: "LINK_EXISTING_REMOTE" | "CREATE_REMOTE";
  selectedRemoteMeterId: string | null;
};

function toEditableRows(value: Array<Record<string, unknown>>) {
  return value.map((row, index) => ({
    id: typeof row.id === "string" ? row.id : null,
    sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : index,
    useKey: BUILDING_PROPERTY_USE_KEYS.includes(row.useKey as BuildingPropertyUseKey)
      ? (row.useKey as BuildingPropertyUseKey)
      : "OFFICE",
    displayName: typeof row.displayName === "string" ? row.displayName : "",
    grossSquareFeet:
      typeof row.grossSquareFeet === "number" ? row.grossSquareFeet : 0,
    details:
      row.details && typeof row.details === "object" && !Array.isArray(row.details)
        ? (row.details as Record<string, string | number | boolean | null>)
        : {},
  })) as EditablePropertyUseInput[];
}

function parseNullableNumber(value: string) {
  if (value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildDefaultDisplayName(buildingName: string, useKey: BuildingPropertyUseKey) {
  return `${buildingName} ${getPropertyUseDefinition(useKey).label}`;
}

function getPushReadinessDisplay(status: "READY" | "READY_WITH_WARNINGS" | "BLOCKED") {
  switch (status) {
    case "READY":
      return { label: "Ready to push", tone: "success" as const };
    case "READY_WITH_WARNINGS":
      return { label: "Ready with warnings", tone: "warning" as const };
    default:
      return { label: "Not ready to push", tone: "danger" as const };
  }
}

function NumericField({
  label,
  value,
  onChange,
  disabled = false,
  step = "1",
}: {
  label: string;
  value: number | null;
  onChange: (nextValue: number | null) => void;
  disabled?: boolean;
  step?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
        {label}
      </span>
      <input
        type="number"
        step={step}
        value={value ?? ""}
        onChange={(event) => onChange(parseNullableNumber(event.target.value))}
        disabled={disabled}
        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
      />
    </label>
  );
}

export function PortfolioManagerSetupPanel({
  buildingId,
  canManage,
}: {
  buildingId: string;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const setupQuery = trpc.portfolioManager.getBuildingSetup.useQuery(
    { buildingId },
    {
      refetchInterval: (query) =>
        query.state.data?.setupState.status === "APPLY_QUEUED" ||
        query.state.data?.setupState.status === "APPLY_RUNNING"
          ? 3000
          : false,
      },
  );
  const meterSetupQuery = trpc.portfolioManager.getBuildingMeterSetup.useQuery(
    { buildingId },
    {
      refetchInterval: (query) =>
        query.state.data?.setupState.status === "APPLY_QUEUED" ||
        query.state.data?.setupState.status === "APPLY_RUNNING"
          ? 3000
          : false,
    },
  );
  const usageQuery = trpc.portfolioManager.getBuildingUsageStatus.useQuery(
    { buildingId },
    {
      refetchInterval: (query) =>
        query.state.data?.usageState.overallStatus === "QUEUED" ||
        query.state.data?.usageState.overallStatus === "RUNNING"
          ? 3000
          : false,
    },
  );
  const saveSetup = trpc.portfolioManager.saveBuildingSetupInputs.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingMeterSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
        utils.building.get.invalidate({ id: buildingId }),
      ]);
    },
  });
  const applySetup = trpc.portfolioManager.applyBuildingSetup.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingMeterSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
        utils.building.get.invalidate({ id: buildingId }),
      ]);
    },
  });
  const saveMeterSetup = trpc.portfolioManager.saveBuildingMeterSetup.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.portfolioManager.getBuildingMeterSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
        utils.building.get.invalidate({ id: buildingId }),
      ]);
    },
  });
  const applyMeterSetup = trpc.portfolioManager.applyBuildingMeterSetup.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.portfolioManager.getBuildingMeterSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
        utils.building.get.invalidate({ id: buildingId }),
      ]);
    },
  });
  const applyMeterAssociations =
    trpc.portfolioManager.applyBuildingMeterAssociations.useMutation({
      onSuccess: async () => {
        await Promise.all([
          utils.portfolioManager.getBuildingMeterSetup.invalidate({ buildingId }),
          utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
          utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
          utils.building.get.invalidate({ id: buildingId }),
        ]);
      },
    });
  const pushUsage = trpc.portfolioManager.pushBuildingUsage.useMutation({
    onSuccess: async (result) => {
      setActionMessage(result.message);
      setIsPushReviewOpen(false);
      await Promise.all([
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.building.get.invalidate({ id: buildingId }),
        utils.organization.governanceOverview.invalidate(),
      ]);
    },
  });
  const importUsage = trpc.portfolioManager.importBuildingUsage.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.building.get.invalidate({ id: buildingId }),
      ]);
    },
  });

  const [rows, setRows] = useState<EditablePropertyUseInput[]>([]);
  const [localMeterDrafts, setLocalMeterDrafts] = useState<Record<string, LocalMeterDraft>>({});
  const [remoteImportSelections, setRemoteImportSelections] = useState<string[]>([]);
  const [isPushReviewOpen, setIsPushReviewOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (setupQuery.data?.propertyUses) {
      setRows(toEditableRows(setupQuery.data.propertyUses as Array<Record<string, unknown>>));
    }
  }, [setupQuery.data]);

  useEffect(() => {
    if (!meterSetupQuery.data) {
      return;
    }

    const nextDrafts = Object.fromEntries(
      meterSetupQuery.data.localMeters.map((meter) => [
        meter.id,
        {
          meterId: meter.id,
          strategy:
            meter.strategy === "CREATE_REMOTE" ? "CREATE_REMOTE" : "LINK_EXISTING_REMOTE",
          selectedRemoteMeterId:
            meter.selectedRemoteMeterId ?? meter.suggestedRemoteMeterId ?? null,
        },
      ]),
    ) as Record<string, LocalMeterDraft>;
    setLocalMeterDrafts(nextDrafts);
    setRemoteImportSelections(
      meterSetupQuery.data.remoteMeters
        .filter(
          (meter) =>
            !meter.alreadyLinkedLocally && meter.suggestedForLocalMeterId == null && meter.canImport,
        )
        .filter((meter) =>
          meterSetupQuery.data.localMeters.some(
            (localMeter) => localMeter.espmMeterId === meter.meterId,
          ),
        )
        .map((meter) => meter.meterId),
    );
  }, [meterSetupQuery.data]);

  if (setupQuery.isLoading || meterSetupQuery.isLoading || usageQuery.isLoading) {
    return null;
  }

  if (setupQuery.error) {
    return <ErrorState message="Portfolio Manager setup is unavailable." detail={setupQuery.error.message} />;
  }

  if (meterSetupQuery.error && !meterSetupQuery.data) {
    return (
      <ErrorState
        message="Portfolio Manager meter setup is unavailable."
        detail={meterSetupQuery.error.message}
      />
    );
  }

  if (usageQuery.error && !usageQuery.data) {
    return (
      <ErrorState
        message="Portfolio Manager usage status is unavailable."
        detail={usageQuery.error.message}
      />
    );
  }

  if (!setupQuery.data || !meterSetupQuery.data || !usageQuery.data) {
    return null;
  }

  const { building, setupState } = setupQuery.data;
  const meterSetupState = meterSetupQuery.data.setupState;
  const usageState = usageQuery.data.usageState;
  const pushReadiness = usageQuery.data.pushReadiness;
  const latestMetricsRecord =
    usageState.latestMetrics &&
    typeof usageState.latestMetrics.metrics === "object" &&
    usageState.latestMetrics.metrics !== null
      ? (usageState.latestMetrics.metrics as Record<string, unknown>)
      : null;
  if (!building.espmPropertyId || building.espmShareStatus !== "LINKED") {
    return null;
  }

  const setupDisplay = getPortfolioManagerSetupDisplay(setupState.summaryState);
  const usageStatusDisplay = getPortfolioManagerUsageStatusDisplay(
    usageState.usageStatus,
  );
  const coverageStatusDisplay = getPortfolioManagerCoverageStatusDisplay(
    usageState.coverageStatus,
  );
  const metricsStatusDisplay = getPortfolioManagerMetricsStatusDisplay(
    usageState.metricsStatus,
  );
  const pushReadinessDisplay = getPushReadinessDisplay(pushReadiness.status);
  const remoteMeterAccess = meterSetupQuery.data.remoteMeterAccess;
  const meterAccessWarning = remoteMeterAccess.warning;
  const visibleError =
    saveSetup.error?.message ??
    applySetup.error?.message ??
    saveMeterSetup.error?.message ??
    applyMeterSetup.error?.message ??
    applyMeterAssociations.error?.message ??
    pushUsage.error?.message ??
    importUsage.error?.message ??
    meterSetupQuery.error?.message ??
    (meterAccessWarning ? null : setupState.latestErrorMessage) ??
    null;
  const runtimeWarning =
    setupQuery.data.runtimeHealth?.warning ?? usageQuery.data.runtimeHealth?.warning ?? null;
  const usageBusy =
    usageState.overallStatus === "QUEUED" || usageState.overallStatus === "RUNNING";
  const propertyUseDefinitions = listPropertyUseDefinitions();

  const updateRow = (
    index: number,
    patch: Partial<EditablePropertyUseInput>,
  ) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const updateRowDetail = (
    index: number,
    fieldKey: string,
    value: string | number | boolean | null,
  ) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              details: {
                ...row.details,
                [fieldKey]: value,
              },
            }
          : row,
      ),
    );
  };

  const updateLocalMeterDraft = (
    meterId: string,
    patch: Partial<LocalMeterDraft>,
  ) => {
    setLocalMeterDrafts((current) => ({
      ...current,
      [meterId]: {
        meterId,
        strategy: current[meterId]?.strategy ?? "LINK_EXISTING_REMOTE",
        selectedRemoteMeterId: current[meterId]?.selectedRemoteMeterId ?? null,
        ...patch,
      },
    }));
  };

  const toggleRemoteImport = (meterId: string) => {
    setRemoteImportSelections((current) =>
      current.includes(meterId)
        ? current.filter((value) => value !== meterId)
        : [...current, meterId],
    );
  };

  const addPropertyUseRow = () => {
    setRows((current) => [
      ...current,
      {
        sortOrder: current.length,
        useKey: "OFFICE",
        displayName: buildDefaultDisplayName(building.name, "OFFICE"),
        grossSquareFeet: 0,
        details: {},
      },
    ]);
  };

  const removeRow = (index: number) => {
    setRows((current) =>
      current
        .filter((_, rowIndex) => rowIndex !== index)
        .map((row, rowIndex) => ({ ...row, sortOrder: rowIndex })),
    );
  };

  const serializedRows = rows.map((row, index) => ({
    id: row.id ?? null,
    sortOrder: index,
    useKey: row.useKey,
    displayName: row.displayName.trim(),
    grossSquareFeet: row.grossSquareFeet,
    details: row.details,
  }));
  const serializedLocalMeterStrategies = meterSetupQuery.data.localMeters
    .filter((meter) => meter.isActive && meter.espmMeterId == null)
    .map((meter) => ({
      meterId: meter.id,
      strategy: localMeterDrafts[meter.id]?.strategy ?? "LINK_EXISTING_REMOTE",
      selectedRemoteMeterId: localMeterDrafts[meter.id]?.selectedRemoteMeterId ?? null,
    }))
    .filter((draft) =>
      draft.strategy === "CREATE_REMOTE" ? true : Boolean(draft.selectedRemoteMeterId),
    );
  const canSaveMeterSetup =
    canManage &&
    remoteMeterAccess.canProceed &&
    (serializedLocalMeterStrategies.length > 0 || remoteImportSelections.length > 0);

  const renderPropertyUseField = (
    row: EditablePropertyUseInput,
    index: number,
    field: PropertyUseFieldDefinition,
  ) => {
    const value = row.details[field.key] ?? null;

    if (field.kind === "integer" || field.kind === "decimal") {
      return (
        <NumericField
          key={field.key}
          label={field.required ? `${field.label} *` : field.label}
          value={typeof value === "number" ? value : null}
          onChange={(nextValue) => updateRowDetail(index, field.key, nextValue)}
          disabled={!canManage}
          step={field.kind === "decimal" ? String(field.step ?? 0.1) : "1"}
        />
      );
    }

    if (field.kind === "boolean") {
      return (
        <label key={field.key} className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            {field.required ? `${field.label} *` : field.label}
          </span>
          <select
            value={typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "string" ? value : ""}
            onChange={(event) =>
              updateRowDetail(
                index,
                field.key,
                event.target.value === "" ? null : event.target.value === "Yes",
              )
            }
            disabled={!canManage}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
          >
            <option value="">Select</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </label>
      );
    }

    if (field.kind === "enum") {
      return (
        <label key={field.key} className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            {field.required ? `${field.label} *` : field.label}
          </span>
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              updateRowDetail(index, field.key, event.target.value || null)
            }
            disabled={!canManage}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
          >
            <option value="">Select</option>
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    return (
      <label key={field.key} className="space-y-1">
        <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
          {field.required ? `${field.label} *` : field.label}
        </span>
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => updateRowDetail(index, field.key, event.target.value || null)}
          disabled={!canManage}
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
        />
      </label>
    );
  };

  return (
    <Panel
      title="Portfolio Manager setup"
      subtitle="Set up PM property uses, meters, and usage readiness so the linked building is benchmark-ready."
      compact
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={setupDisplay.label} tone={setupDisplay.tone} />
          {setupState.lastAppliedAt ? (
            <span className="text-xs text-zinc-500">
              Applied {formatDate(setupState.lastAppliedAt)}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4 border-t border-zinc-200/80 pt-4">
        <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-4">
          <div className="text-sm text-zinc-700">{setupState.summaryLine}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
            <span>Property uses: {setupState.propertyUsesStatus.toLowerCase().replaceAll("_", " ")}</span>
            <span>Meters: {setupState.metersStatus.toLowerCase().replaceAll("_", " ")}</span>
            <span>Associations: {setupState.associationsStatus.toLowerCase().replaceAll("_", " ")}</span>
            <span>Coverage: {setupState.usageCoverageStatus.toLowerCase().replaceAll("_", " ")}</span>
          </div>
        </div>

        {visibleError ? (
          <ErrorState message="Portfolio Manager setup needs attention." detail={visibleError} />
        ) : null}

        {actionMessage ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {actionMessage}
          </div>
        ) : null}

        {runtimeWarning ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {runtimeWarning}
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="text-sm font-semibold tracking-tight text-zinc-900">
            Property uses
          </div>
          <div className="text-xs leading-5 text-zinc-500">
            Save the Quoin-authored property-use structure first, then apply it to the linked
            PM property.
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState message="No PM property-use inputs are available yet for this building." />
        ) : (
          <div className="space-y-4">
            {rows.map((row, index) => (
              <div
                key={row.id ?? `${row.useKey}-${index}`}
                className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4"
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                      Use type
                    </span>
                    <select
                      value={row.useKey}
                      onChange={(event) =>
                        updateRow(index, {
                          useKey: event.target.value as BuildingPropertyUseKey,
                          details: {},
                          displayName: buildDefaultDisplayName(
                            building.name,
                            event.target.value as BuildingPropertyUseKey,
                          ),
                        })
                      }
                      disabled={!canManage}
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
                    >
                      {propertyUseDefinitions.map((definition) => (
                        <option key={definition.key} value={definition.key}>
                          {definition.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                      Use name
                    </span>
                    <input
                      type="text"
                      value={row.displayName}
                      onChange={(event) =>
                        updateRow(index, { displayName: event.target.value })
                      }
                      disabled={!canManage}
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
                    />
                  </label>
                  <NumericField
                    label="Gross square feet"
                    value={row.grossSquareFeet}
                    onChange={(value) =>
                      updateRow(index, { grossSquareFeet: value ?? 0 })
                    }
                    disabled={!canManage}
                  />
                  {canManage ? (
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="btn-secondary px-3 py-2 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {getAllPropertyUseFields(row.useKey).map((field) =>
                    renderPropertyUseField(row, index, field),
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {canManage ? (
          <button
            type="button"
            onClick={addPropertyUseRow}
            className="btn-secondary px-3 py-2 text-sm"
          >
            Add use row
          </button>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <>
              <button
                type="button"
                onClick={() =>
                  saveSetup.mutate({
                    buildingId,
                    propertyUses: serializedRows,
                  })
                }
                disabled={saveSetup.isPending}
                className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
              >
                {saveSetup.isPending ? "Saving..." : "Save setup"}
              </button>
              <button
                type="button"
                onClick={() => applySetup.mutate({ buildingId })}
                disabled={
                  applySetup.isPending ||
                  !setupState.canApply ||
                  setupState.status === "APPLY_QUEUED" ||
                  setupState.status === "APPLY_RUNNING"
                }
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {setupState.status === "NEEDS_ATTENTION"
                  ? applySetup.isPending
                    ? "Retrying..."
                    : "Retry setup"
                  : applySetup.isPending
                    ? "Applying..."
                    : "Apply PM setup"}
              </button>
            </>
          ) : (
            <div className="text-sm text-zinc-500">
              Setup inputs are read-only for your role.
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200/80 pt-4">
          <div className="space-y-2">
            <div className="text-sm font-semibold tracking-tight text-zinc-900">
              Meters and associations
            </div>
            <div className="text-xs leading-5 text-zinc-500">
              Keep local Quoin meters as the canonical roster, then link or create PM meters and
              apply property-level associations explicitly.
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-4">
            <div className="text-sm text-zinc-700">{meterSetupState.summaryLine}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
              <span>
                Meters: {meterSetupState.metersStatus.toLowerCase().replaceAll("_", " ")}
              </span>
              <span>
                Associations:{" "}
                {meterSetupState.associationsStatus.toLowerCase().replaceAll("_", " ")}
              </span>
            </div>
          </div>

          {meterAccessWarning ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <div className="font-medium">
                Quoin can only access some of this property&apos;s Portfolio Manager meters.
              </div>
              <div className="mt-1 text-amber-800">
                This is an ESPM sharing or permission issue, not a Quoin import failure.
              </div>
              <div className="mt-3 text-amber-800">{meterAccessWarning}</div>
              {remoteMeterAccess.inaccessibleCount > 0 ? (
                <div className="mt-3 text-xs leading-5 text-amber-800">
                  Inaccessible meters: {remoteMeterAccess.inaccessibleCount}
                  {" | "}
                  IDs: {remoteMeterAccess.inaccessibleMeterIds.join(", ")}
                </div>
              ) : null}
              <div className="mt-3 text-xs leading-5 text-amber-800">
                Share the supported property meters Quoin should import before saving meter
                mappings or applying PM meter setup.
              </div>
            </div>
          ) : null}

          {meterSetupQuery.data.localMeters.length === 0 ? (
            <div className="mt-4">
              <EmptyState message="No local Quoin meters are available for PM linkage yet." />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {meterSetupQuery.data.localMeters.map((meter) => {
                const draft = localMeterDrafts[meter.id] ?? {
                  meterId: meter.id,
                  strategy: "LINK_EXISTING_REMOTE" as const,
                  selectedRemoteMeterId: meter.suggestedRemoteMeterId,
                };
                const compatibleRemoteMeters = meterSetupQuery.data.remoteMeters.filter(
                  (remoteMeter) =>
                    remoteMeter.compatibleLocalMeterIds.includes(meter.id) &&
                    (!remoteMeter.alreadyLinkedLocally ||
                      remoteMeter.linkedLocalMeterId === meter.id),
                );

                return (
                  <div
                    key={meter.id}
                    className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-zinc-900">{meter.name}</div>
                        <div className="text-xs text-zinc-500">
                          {meter.meterType} · {meter.unit}
                          {meter.espmMeterId ? ` · PM meter ${meter.espmMeterId}` : ""}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <StatusBadge
                          label={meter.meterStatus.toLowerCase().replaceAll("_", " ")}
                          tone={
                            meter.meterStatus === "APPLIED"
                              ? "success"
                              : meter.meterStatus === "NEEDS_ATTENTION"
                                ? "danger"
                                : "warning"
                          }
                        />
                        <StatusBadge
                          label={meter.associationStatus.toLowerCase().replaceAll("_", " ")}
                          tone={
                            meter.associationStatus === "APPLIED"
                              ? "success"
                              : meter.associationStatus === "NEEDS_ATTENTION"
                                ? "danger"
                                : "muted"
                          }
                        />
                      </div>
                    </div>

                    {meter.espmMeterId == null ? (
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                            Strategy
                          </span>
                          <select
                            value={draft.strategy}
                            onChange={(event) =>
                              updateLocalMeterDraft(meter.id, {
                                strategy: event.target.value as "LINK_EXISTING_REMOTE" | "CREATE_REMOTE",
                              })
                            }
                            disabled={!canManage || !remoteMeterAccess.canProceed}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
                          >
                            <option value="LINK_EXISTING_REMOTE">Link existing PM meter</option>
                            <option value="CREATE_REMOTE">Create PM meter</option>
                          </select>
                        </label>

                        {draft.strategy === "LINK_EXISTING_REMOTE" ? (
                          <label className="space-y-1">
                            <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                              Remote PM meter
                            </span>
                            <select
                              value={draft.selectedRemoteMeterId ?? ""}
                              onChange={(event) =>
                                updateLocalMeterDraft(meter.id, {
                                  selectedRemoteMeterId: event.target.value || null,
                                })
                              }
                              disabled={!canManage || !remoteMeterAccess.canProceed}
                              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
                            >
                              <option value="">Select a PM meter</option>
                              {compatibleRemoteMeters.map((remoteMeter) => (
                                <option key={remoteMeter.meterId} value={remoteMeter.meterId}>
                                  {remoteMeter.name} ({remoteMeter.meterId}) -{" "}
                                  {remoteMeter.rawUnitOfMeasure ?? remoteMeter.unit}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
                            {meter.canCreateRemote
                              ? "Quoin will create a new PM meter for this local meter."
                              : meter.createBlockedReason}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {meter.latestErrorMessage ? (
                      <div className="mt-3 text-xs leading-5 text-[#7b3f3f]">
                        {meter.latestErrorMessage}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {meterSetupQuery.data.remoteMeters.some(
            (meter) => !meter.alreadyLinkedLocally && meter.canImport,
          ) ? (
            <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
              <div className="text-sm font-semibold tracking-tight text-zinc-900">
                Remote import candidates
              </div>
              <div className="mt-1 text-xs leading-5 text-zinc-500">
                Select existing PM meters to import into the local Quoin meter roster.
              </div>
              <div className="mt-4 space-y-2">
                {meterSetupQuery.data.remoteMeters
                  .filter((meter) => !meter.alreadyLinkedLocally)
                  .map((meter) => (
                    <label
                      key={meter.meterId}
                      className="flex items-start gap-3 rounded-xl border border-zinc-200/70 px-3 py-3"
                    >
                      <input
                        type="checkbox"
                        checked={remoteImportSelections.includes(meter.meterId)}
                        onChange={() => toggleRemoteImport(meter.meterId)}
                        disabled={
                          !canManage || !meter.canImport || !remoteMeterAccess.canProceed
                        }
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900">
                          {meter.name} ({meter.meterId})
                        </div>
                        <div className="text-xs text-zinc-500">
                          {meter.meterType} · {meter.rawUnitOfMeasure ?? meter.unit}
                          {meter.alreadyAssociated ? " · already associated" : ""}
                        </div>
                        {meter.unitCompatibilityStatus === "SUPPORTED_CONVERSION" ? (
                          <div className="mt-1 text-xs text-amber-700">
                            Supported conversion from the exact PM unit to Quoin&apos;s canonical
                            local unit.
                          </div>
                        ) : null}
                        {!meter.canImport && meter.importBlockedReason ? (
                          <div className="mt-1 text-xs text-[#7b3f3f]">
                            {meter.importBlockedReason}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {canManage ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    saveMeterSetup.mutate({
                      buildingId,
                      localMeterStrategies: serializedLocalMeterStrategies,
                      importRemoteMeterIds: remoteImportSelections,
                    })
                  }
                  disabled={!canSaveMeterSetup || saveMeterSetup.isPending}
                  className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {saveMeterSetup.isPending ? "Saving..." : "Save meter setup"}
                </button>
                <button
                  type="button"
                  onClick={() => applyMeterSetup.mutate({ buildingId })}
                  disabled={
                    applyMeterSetup.isPending ||
                    !meterSetupState.canApplyMeters ||
                    meterSetupState.status === "APPLY_QUEUED" ||
                    meterSetupState.status === "APPLY_RUNNING"
                  }
                  className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {applyMeterSetup.isPending ? "Applying..." : "Apply PM meters"}
                </button>
                <button
                  type="button"
                  onClick={() => applyMeterAssociations.mutate({ buildingId })}
                  disabled={
                    applyMeterAssociations.isPending ||
                    !meterSetupState.canApplyAssociations ||
                    meterSetupState.status === "APPLY_QUEUED" ||
                    meterSetupState.status === "APPLY_RUNNING"
                  }
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {applyMeterAssociations.isPending
                    ? "Applying..."
                    : "Apply PM associations"}
                </button>
              </>
            ) : (
              <div className="text-sm text-zinc-500">
                Meter setup is read-only for your role.
              </div>
            )}
          </div>
          {!remoteMeterAccess.canProceed ? (
            <div className="mt-3 text-xs leading-5 text-zinc-500">
              Save and apply actions stay disabled until every Portfolio Manager meter for this
              property is shared with Quoin.
            </div>
          ) : null}
        </div>

        <div className="border-t border-zinc-200/80 pt-4">
          <div className="space-y-2">
            <div className="text-sm font-semibold tracking-tight text-zinc-900">
              Usage and metrics
            </div>
            <div className="text-xs leading-5 text-zinc-500">
              Run monthly usage explicitly from linked local meters, then let Quoin refresh
              Portfolio Manager metrics when coverage is benchmark-usable.
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-4">
            <div className="text-sm text-zinc-700">{pushReadiness.summaryLine}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <StatusBadge
                label={pushReadinessDisplay.label}
                tone={pushReadinessDisplay.tone}
              />
              <StatusBadge
                label={usageStatusDisplay.label}
                tone={usageStatusDisplay.tone}
              />
              <StatusBadge
                label={coverageStatusDisplay.label}
                tone={coverageStatusDisplay.tone}
              />
              <StatusBadge
                label={metricsStatusDisplay.label}
                tone={metricsStatusDisplay.tone}
              />
              <span className="text-zinc-500">
                Reporting year {pushReadiness.reportingYear}
              </span>
            </div>
          </div>

          {pushReadiness.blockers.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">
              <div className="font-medium">Push blockers</div>
              <ul className="mt-2 space-y-1 text-red-800">
                {pushReadiness.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {pushReadiness.warnings.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <div className="font-medium">Push warnings</div>
              <ul className="mt-2 space-y-1 text-amber-800">
                {pushReadiness.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {usageState.resultSummary || usageState.latestMetrics ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                  Latest usage run
                </div>
                <div className="mt-3 space-y-1 text-sm text-zinc-700">
                  <div>
                    Direction:{" "}
                    {usageState.lastRunDirection === "IMPORT_PM_TO_LOCAL"
                      ? "Import PM to Quoin"
                      : usageState.lastRunDirection === "PUSH_LOCAL_TO_PM"
                        ? "Push Quoin to PM"
                        : "Not run"}
                  </div>
                  <div>
                    Last usage action:{" "}
                    {usageState.lastUsageAppliedAt
                      ? formatDate(usageState.lastUsageAppliedAt)
                      : "Not yet"}
                  </div>
                  <div>
                    Last metrics refresh:{" "}
                    {usageState.lastMetricsRefreshedAt
                      ? formatDate(usageState.lastMetricsRefreshedAt)
                      : "Not yet"}
                  </div>
                  {usageState.resultSummary ? (
                    <>
                      <div>
                        Ready meters: {String(pushReadiness.pushableMeterCount)}
                        {" | "}
                        Ready readings: {String(pushReadiness.pushableReadingCount)}
                      </div>
                      <div>
                        Linked meters:{" "}
                        {String(usageState.resultSummary.linkedMeterCount ?? "-")}
                      </div>
                      <div>
                        Meters with readings:{" "}
                        {String(usageState.resultSummary.metersWithReadings ?? "-")}
                      </div>
                      <div>
                        Created: {String(usageState.resultSummary.readingsCreated ?? 0)}
                        {" | "}
                        Updated: {String(usageState.resultSummary.readingsUpdated ?? 0)}
                      </div>
                      <div>
                        Pushed: {String(usageState.resultSummary.readingsPushed ?? 0)}
                        {" | "}
                        Skipped:{" "}
                        {String(
                          usageState.resultSummary.readingsSkippedExisting ??
                            usageState.resultSummary.readingsSkippedConflicting ??
                            0,
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                  Latest PM metrics
                </div>
                <div className="mt-3 space-y-1 text-sm text-zinc-700">
                  {usageState.latestMetrics ? (
                    <>
                      <div>
                        ENERGY STAR score:{" "}
                        {String(latestMetricsRecord?.score ?? "Not available")}
                      </div>
                      <div>
                        Site EUI:{" "}
                        {String(latestMetricsRecord?.siteIntensity ?? "Not available")}
                      </div>
                      <div>
                        Source EUI:{" "}
                        {String(latestMetricsRecord?.sourceIntensity ?? "Not available")}
                      </div>
                    </>
                  ) : (
                    <div>No PM metrics have been captured yet.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <PortfolioManagerPushReviewDialog
            open={isPushReviewOpen}
            onOpenChange={(open) => {
              if (!open) {
                pushUsage.reset?.();
              }
              setIsPushReviewOpen(open);
            }}
            canManage={canManage}
            pushReadiness={pushReadiness}
            usageState={usageState}
            confirmPending={pushUsage.isPending}
            onConfirm={() =>
              pushUsage.mutate({
                buildingId,
                reportingYear: pushReadiness.reportingYear,
              })
            }
            errorMessage={pushUsage.error?.message ?? null}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {canManage ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsPushReviewOpen(true)}
                  disabled={pushUsage.isPending}
                  className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {pushUsage.isPending ? "Queueing..." : "Review push to PM"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    importUsage.mutate({
                      buildingId,
                      reportingYear: pushReadiness.reportingYear,
                    })
                  }
                  disabled={
                    importUsage.isPending ||
                    !usageState.canImport ||
                    usageBusy
                  }
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {importUsage.isPending ? "Queueing..." : "Import usage from PM"}
                </button>
              </>
            ) : (
              <div className="text-sm text-zinc-500">
                Usage actions are read-only for your role.
              </div>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
