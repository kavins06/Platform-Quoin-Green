"use client";

import { type ReactNode, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  downloadFile,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  formatDate,
} from "@/components/internal/admin-primitives";
import {
  StatusBadge,
  getPacketStatusDisplay,
  getReadinessStatusDisplay,
  getRequestItemStatusDisplay,
} from "@/components/internal/status-helpers";

const REQUEST_CATEGORIES = [
  { value: "DC_REAL_PROPERTY_ID", label: "DC Real Property Unique ID" },
  { value: "GROSS_FLOOR_AREA_SUPPORT", label: "Gross floor area support" },
  { value: "AREA_ANALYSIS_DRAWINGS", label: "Area analysis / drawings" },
  { value: "PROPERTY_USE_DETAILS_SUPPORT", label: "Property use details support" },
  { value: "METER_ROSTER_SUPPORT", label: "Meter roster / aggregate meter support" },
  { value: "UTILITY_BILLS", label: "Utility bills" },
  { value: "PORTFOLIO_MANAGER_ACCESS", label: "Portfolio Manager access/share confirmation" },
  { value: "DATA_QUALITY_CHECKER_SUPPORT", label: "Data Quality Checker support" },
  {
    value: "THIRD_PARTY_VERIFICATION_SUPPORT",
    label: "Third-party verification support documents",
  },
  { value: "OTHER_BENCHMARKING_SUPPORT", label: "Other benchmarking support evidence" },
] as const;

const REQUEST_STATUSES = [
  "NOT_REQUESTED",
  "REQUESTED",
  "RECEIVED",
  "VERIFIED",
  "BLOCKED",
] as const;

function defaultReportingYear() {
  return new Date().getUTCFullYear() - 1;
}

function toDateInputValue(value: string | Date | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function getReadinessStatus(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "NOT_STARTED";
  }

  const status = (data as { status?: unknown }).status;
  return typeof status === "string" ? status : "NOT_STARTED";
}

function DisclosureSection({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-2xl border border-zinc-200/80 bg-[#fafbfc] px-4 py-3"
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold tracking-tight text-zinc-900">{title}</div>
            {summary ? (
              <div className="mt-1 text-[12px] leading-5 text-zinc-500">{summary}</div>
            ) : null}
          </div>
          <div className="text-[12px] text-zinc-500">Show</div>
        </div>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

export function VerificationRequestsTab({
  buildingId,
  showPacketActions = true,
  canManage = false,
}: {
  buildingId: string;
  showPacketActions?: boolean;
  canManage?: boolean;
}) {
  const [reportingYear, setReportingYear] = useState(defaultReportingYear());
  const [editingRequestId, setEditingRequestId] = useState<string | undefined>();
  const [showComposer, setShowComposer] = useState(false);
  const [category, setCategory] = useState<(typeof REQUEST_CATEGORIES)[number]["value"]>(
    "DC_REAL_PROPERTY_ID",
  );
  const [title, setTitle] = useState("DC Real Property Unique ID");
  const [status, setStatus] = useState<(typeof REQUEST_STATUSES)[number]>("REQUESTED");
  const [isRequired, setIsRequired] = useState(true);
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [requestedFrom, setRequestedFrom] = useState("");
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();
  const readiness = trpc.benchmarking.getReadiness.useQuery(
    { buildingId, reportingYear },
    { retry: false },
  );
  const requestItems = trpc.benchmarking.listRequestItems.useQuery({
    buildingId,
    reportingYear,
  });
  const latestPacket = trpc.benchmarking.getLatestBenchmarkPacket.useQuery(
    { buildingId, reportingYear },
    { retry: false },
  );
  const packetManifest = trpc.benchmarking.getBenchmarkPacketManifest.useQuery(
    { buildingId, reportingYear },
    { retry: false },
  );
  const packets = trpc.benchmarking.listBenchmarkPackets.useQuery({
    buildingId,
    limit: 12,
  });

  const invalidateAll = () => {
    utils.benchmarking.listRequestItems.invalidate({ buildingId, reportingYear });
    utils.benchmarking.getLatestBenchmarkPacket.invalidate({ buildingId, reportingYear });
    utils.benchmarking.getBenchmarkPacketManifest.invalidate({ buildingId, reportingYear });
    utils.benchmarking.listBenchmarkPackets.invalidate({ buildingId, limit: 12 });
    utils.benchmarking.getReadiness.invalidate({ buildingId, reportingYear });
  };

  const upsertMutation = trpc.benchmarking.upsertRequestItem.useMutation({
    onSuccess: () => {
      invalidateAll();
      setEditingRequestId(undefined);
      setShowComposer(false);
      setCategory("DC_REAL_PROPERTY_ID");
      setTitle("DC Real Property Unique ID");
      setStatus("REQUESTED");
      setIsRequired(true);
      setDueDate("");
      setAssignedTo("");
      setRequestedFrom("");
      setNotes("");
    },
  });

  const generateMutation = trpc.benchmarking.generateBenchmarkPacket.useMutation({
    onSuccess: invalidateAll,
  });

  const finalizeMutation = trpc.benchmarking.finalizeBenchmarkPacket.useMutation({
    onSuccess: invalidateAll,
  });

  const packetStatusDisplay = getPacketStatusDisplay(latestPacket.data?.status ?? "NONE");
  const manifestWarnings = Array.isArray(packetManifest.data?.warnings)
    ? packetManifest.data.warnings
    : [];
  const manifestBlockers = Array.isArray(packetManifest.data?.blockers)
    ? packetManifest.data.blockers
    : [];

  useEffect(() => {
    if (editingRequestId) {
      setShowComposer(true);
    }
  }, [editingRequestId]);

  async function handleExport(format: "JSON" | "MARKDOWN" | "PDF") {
    const result = await utils.benchmarking.exportBenchmarkPacket.fetch({
      buildingId,
      reportingYear,
      format,
    });

    downloadFile({
      fileName: result.fileName,
      content: result.content,
      contentType: result.contentType,
      encoding: result.encoding,
    });
  }

  function hydrateEditor(item: NonNullable<typeof requestItems.data>[number]) {
    setEditingRequestId(item.id);
    setCategory(item.category);
    setTitle(item.title);
    setStatus(item.status);
    setIsRequired(item.isRequired);
    setDueDate(toDateInputValue(item.dueDate ?? null));
    setAssignedTo(item.assignedTo ?? "");
    setRequestedFrom(item.requestedFrom ?? "");
    setNotes(item.notes ?? "");
  }

  function resetComposer() {
    setEditingRequestId(undefined);
    setShowComposer(false);
    setCategory("DC_REAL_PROPERTY_ID");
    setTitle("DC Real Property Unique ID");
    setStatus("REQUESTED");
    setIsRequired(true);
    setDueDate("");
    setAssignedTo("");
    setRequestedFrom("");
    setNotes("");
  }

  if (readiness.isLoading || requestItems.isLoading || packets.isLoading) {
    return <LoadingState />;
  }

  if (requestItems.error) {
    return (
      <ErrorState
        message="Verification workspace is unavailable."
        detail={requestItems.error.message}
      />
    );
  }

  const btnClass =
    "rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50";
  const historySummary = packets.data?.[0]
    ? `${packets.data.length} version(s), latest ${formatDate(packets.data[0].generatedAt)}`
    : "No benchmark packet history yet";

  return (
    <div className="space-y-4">
      <Panel
        title="Review"
        subtitle={
          showPacketActions
            ? "Clear blockers and build the packet."
            : "Clear blockers and keep only the support items that still matter."
        }
        compact
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              value={reportingYear}
              onChange={(event) => setReportingYear(Number(event.target.value))}
              className="w-28 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900"
            />
            {showPacketActions ? (
              <>
                <button
                  className={btnClass}
                  onClick={() => generateMutation.mutate({ buildingId, reportingYear })}
                  disabled={generateMutation.isPending || readiness.isError || !canManage}
                >
                  {generateMutation.isPending
                    ? "Generating..."
                    : latestPacket.data
                      ? "Refresh packet"
                      : "Generate packet"}
                </button>
                <button
                  className={btnClass}
                  onClick={() => finalizeMutation.mutate({ buildingId, reportingYear })}
                  disabled={
                    finalizeMutation.isPending ||
                    !latestPacket.data ||
                    latestPacket.data.status === "FINALIZED" ||
                    !canManage
                  }
                >
                  {finalizeMutation.isPending ? "Finalizing..." : "Finalize packet"}
                </button>
              </>
            ) : null}
          </div>
        }
      >
        <div className="space-y-4 border-t border-zinc-200/80 pt-4">
          {readiness.error?.data?.code === "NOT_FOUND" ? (
            <EmptyState message="Run readiness first." />
          ) : null}

          {generateMutation.error ? (
            <ErrorState
              message="Benchmark packet generation failed."
              detail={generateMutation.error.message}
            />
          ) : null}

          {finalizeMutation.error ? (
            <ErrorState
              message="Benchmark packet finalization failed."
              detail={finalizeMutation.error.message}
            />
          ) : null}

          <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight text-zinc-900">
                  {manifestBlockers.length > 0
                    ? `${manifestBlockers.length} blocker(s) to clear`
                    : manifestWarnings.length > 0
                      ? `${manifestWarnings.length} warning(s) to review`
                      : latestPacket.data
                        ? "Packet ready for review"
                        : "No packet yet"}
                </div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-500">
                  {latestPacket.data
                    ? `Packet ${packetStatusDisplay.label.toLowerCase()}. Latest version v${latestPacket.data.version}.`
                    : "Create the first packet after readiness is ready."}
                </div>
              </div>
              <StatusBadge label={packetStatusDisplay.label} tone={packetStatusDisplay.tone} />
            </div>

            {manifestBlockers.length > 0 || manifestWarnings.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-zinc-700">
                {manifestBlockers.map((item, index) => (
                  <li
                    key={`blocker-${index}`}
                    className="rounded-xl border border-red-200/60 bg-red-50/60 px-3 py-2 text-red-800"
                  >
                    {String(item)}
                  </li>
                ))}
                {manifestWarnings.map((item, index) => {
                  const message =
                    item && typeof item === "object" && !Array.isArray(item)
                      ? String((item as Record<string, unknown>).message ?? "Warning")
                      : String(item);
                  return (
                    <li
                      key={`warning-${index}`}
                      className="rounded-xl border border-amber-200/60 bg-amber-50/60 px-3 py-2 text-amber-800"
                    >
                      {message}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <div className="border-t border-zinc-200/80 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold tracking-tight text-zinc-900">
                  Request items
                </div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-500">
                  Ask only for the items still needed.
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary px-4 py-2 text-sm"
                onClick={() => {
                  resetComposer();
                  setShowComposer(true);
                }}
                disabled={!canManage}
              >
                Add request item
              </button>
            </div>
          </div>

          {requestItems.data && requestItems.data.length > 0 ? (
            <div className="space-y-3 border-t border-zinc-200/80 pt-4">
            {requestItems.data.map((item) => {
              const statusDisplay = getRequestItemStatusDisplay(item.status);
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold tracking-tight text-zinc-900">
                        {item.title}
                      </div>
                      <div className="mt-1 text-[12px] text-zinc-500">
                        {REQUEST_CATEGORIES.find((entry) => entry.value === item.category)?.label ??
                          item.category}
                        {item.isRequired ? " | Required" : " | Optional"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge label={statusDisplay.label} tone={statusDisplay.tone} />
                      {canManage ? (
                        <button
                          className="text-[12px] font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4"
                          onClick={() => hydrateEditor(item)}
                        >
                          Edit
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-zinc-600">
                    {item.notes ||
                      `Due ${formatDate(item.dueDate)} | Assigned ${item.assignedTo ?? "None"} | Evidence ${item.evidenceArtifact?.name ?? item.sourceArtifact?.name ?? "None linked"}`}
                  </div>
                </div>
              );
            })}
            </div>
          ) : (
            <EmptyState message="No request items yet." />
          )}
        </div>
      </Panel>

      <DisclosureSection
        title={editingRequestId ? "Edit request item" : "Request item composer"}
        summary={
          editingRequestId
            ? "Update the selected support item."
            : "Add the next support item only when needed."
        }
        defaultOpen={showComposer}
      >
        <form
          className="space-y-4 rounded-2xl border border-zinc-200/80 bg-white/80 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            upsertMutation.mutate({
              requestItemId: editingRequestId,
              buildingId,
              reportingYear,
              category,
              title,
              status,
              isRequired,
              dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`).toISOString() : null,
              assignedTo: assignedTo || null,
              requestedFrom: requestedFrom || null,
              notes: notes || null,
            });
          }}
        >
          <label className="block text-sm font-medium text-zinc-700">
            Category
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as (typeof REQUEST_CATEGORIES)[number]["value"]);
                if (!editingRequestId) {
                  const selected = REQUEST_CATEGORIES.find(
                    (item) => item.value === event.target.value,
                  );
                  setTitle(selected?.label ?? event.target.value);
                }
              }}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
            >
              {REQUEST_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-zinc-700">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-zinc-700">
              Status
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as (typeof REQUEST_STATUSES)[number])
                }
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              >
                {REQUEST_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {item.replaceAll("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-zinc-700">
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-zinc-700">
              Requested from
              <input
                value={requestedFrom}
                onChange={(event) => setRequestedFrom(event.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm font-medium text-zinc-700">
              Assigned to
              <input
                value={assignedTo}
                onChange={(event) => setAssignedTo(event.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(event) => setIsRequired(event.target.checked)}
            />
            Required for verification readiness
          </label>

          <label className="block text-sm font-medium text-zinc-700">
            Notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={upsertMutation.isPending || !canManage}
              className="btn-primary disabled:opacity-50"
            >
              {upsertMutation.isPending
                ? "Saving..."
                : editingRequestId
                  ? "Update item"
                  : "Create item"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={resetComposer}
            >
              Cancel
            </button>
          </div>
        </form>
      </DisclosureSection>

      <DisclosureSection title="Packet history" summary={historySummary}>
        {packets.data && packets.data.length > 0 ? (
          <div className="space-y-3">
            {packets.data.map((packet) => {
              const display = getPacketStatusDisplay(packet.status);
              return (
                <div
                  key={packet.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                >
                  <div>
                    <div className="font-semibold text-zinc-900">
                      Reporting year {packet.reportingYear} | v{packet.version}
                    </div>
                    <div className="mt-1 text-sm text-zinc-500">
                      Generated {formatDate(packet.generatedAt)}
                    </div>
                  </div>
                  <StatusBadge label={display.label} tone={display.tone} />
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState message="No benchmark verification packets have been generated yet." />
        )}
      </DisclosureSection>

      {showPacketActions && latestPacket.data ? (
        <div className="flex flex-wrap gap-2">
          <button className={btnClass} onClick={() => handleExport("PDF")} disabled={!canManage}>
            Export PDF
          </button>
          <button className={btnClass} onClick={() => handleExport("MARKDOWN")} disabled={!canManage}>
            Export Markdown
          </button>
          <button className={btnClass} onClick={() => handleExport("JSON")} disabled={!canManage}>
            Export JSON
          </button>
        </div>
      ) : null}
    </div>
  );
}
