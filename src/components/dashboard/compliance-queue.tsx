"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/internal/admin-primitives";
import {
  getPacketStatusDisplay,
  getPrimaryComplianceStatusDisplay,
  getSubmissionWorkflowStateDisplay,
  getSyncStatusDisplay,
  getWorklistTriageDisplay,
} from "@/components/internal/status-helpers";
import { AddBuildingDialogTrigger } from "./add-building-dialog-trigger";

function truncateCopy(value: string, max = 72) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 3).trimEnd()}...`;
}

function buildPrimaryStatus(item: {
  flags: {
    readyToSubmit: boolean;
    readyForReview: boolean;
    needsCorrection: boolean;
  };
  blockingIssueCount: number;
  runtime: {
    portfolioManager: {
      currentState: string;
    };
  };
  triage: {
    bucket: string;
  };
}) {
  if (item.flags.readyToSubmit) {
    return "Ready";
  }

  if (item.flags.readyForReview) {
    return "Needs review";
  }

  if (item.flags.needsCorrection || item.blockingIssueCount > 0) {
    return "Needs data";
  }

  if (item.runtime.portfolioManager.currentState === "STALE") {
    return "Needs sync";
  }

  const triage = getWorklistTriageDisplay(item.triage.bucket);
  if (triage.label.toLowerCase().includes("sync")) {
    return "Needs sync";
  }

  return "In progress";
}

function buildSecondaryLine(item: {
  address?: string | null;
  nextAction: {
    title: string;
    reason: string;
  };
}) {
  return item.address?.trim() || truncateCopy(item.nextAction.reason, 64);
}

function buildMetaChip(item: {
  blockingIssueCount: number;
  triage: {
    urgency: string;
  };
  artifacts: {
    benchmark: {
      status: string;
    };
  };
  submission: {
    overall: {
      state: string;
    };
  };
  complianceSummary: {
    primaryStatus: string;
  };
  runtime: {
    portfolioManager: {
      currentState: string;
    };
  };
}) {
  if (item.triage.urgency === "NOW") {
    return "Now";
  }

  if (item.blockingIssueCount > 0) {
    return `${item.blockingIssueCount} blocker${item.blockingIssueCount === 1 ? "" : "s"}`;
  }

  const submission = getSubmissionWorkflowStateDisplay(item.submission.overall.state);
  if (submission.label.toLowerCase().includes("submitted")) {
    return "Submitted";
  }

  const packet = getPacketStatusDisplay(item.artifacts.benchmark.status);
  if (packet.label.toLowerCase().includes("final")) {
    return "Packet ready";
  }

  const sync = getSyncStatusDisplay(item.runtime.portfolioManager.currentState);
  if (sync.label.toLowerCase().includes("stale")) {
    return "Sync stale";
  }

  const compliance = getPrimaryComplianceStatusDisplay(item.complianceSummary.primaryStatus);
  return compliance.label;
}

function chipClass(label: string) {
  const normalized = label.toLowerCase();

  if (
    normalized.includes("now") ||
    normalized.includes("blocker") ||
    normalized.includes("needs")
  ) {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (
    normalized.includes("ready") ||
    normalized.includes("submitted") ||
    normalized.includes("compliant")
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

export function ComplianceQueue() {
  const pageSize = 24;
  const [search, setSearch] = useState("");
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  useEffect(() => {
    setCursor(undefined);
    setCursorHistory([]);
  }, [search, needsAttentionOnly]);

  const worklist = trpc.building.portfolioWorklist.useQuery({
    cursor,
    pageSize,
    search: search || undefined,
    triageUrgency: needsAttentionOnly ? "NOW" : undefined,
    sortBy: "PRIORITY",
  });

  if (worklist.isLoading) {
    return <LoadingState />;
  }

  if (worklist.error) {
    return (
      <ErrorState message="Buildings could not load." detail={worklist.error.message} />
    );
  }

  const data = worklist.data;

  if (!data) {
    return <EmptyState message="Buildings are not ready yet." />;
  }

  const pageInfo = data.pageInfo;
  const currentPage = cursorHistory.length + 1;
  const totalPages = Math.max(1, Math.ceil(pageInfo.totalMatchingCount / pageSize));

  function moveToNextPage() {
    if (!pageInfo.nextCursor) {
      return;
    }

    setCursorHistory((current) => [...current, cursor ?? ""]);
    setCursor(pageInfo.nextCursor);
  }

  function moveToPreviousPage() {
    if (cursorHistory.length === 0) {
      setCursor(undefined);
      return;
    }

    const previousCursor = cursorHistory[cursorHistory.length - 1];
    setCursor(previousCursor || undefined);
    setCursorHistory((current) => current.slice(0, -1));
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Buildings"
        subtitle="Open a building, check what needs attention, and keep moving."
        kicker="Portfolio"
        variant="portfolio"
        density="compact"
      >
        {data.operatorAccess.canManage ? (
          <AddBuildingDialogTrigger
            buttonClassName="rounded-full bg-zinc-900 px-5 py-2.5 font-dashboard-sans text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          />
        ) : null}
      </PageHeader>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setNeedsAttentionOnly(false)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              !needsAttentionOnly
                ? "bg-white text-zinc-900 ring-1 ring-inset ring-zinc-200"
                : "text-zinc-500 hover:bg-white/60 hover:text-zinc-900"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setNeedsAttentionOnly(true)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              needsAttentionOnly
                ? "bg-white text-zinc-900 ring-1 ring-inset ring-zinc-200"
                : "text-zinc-500 hover:bg-white/60 hover:text-zinc-900"
            }`}
          >
            Needs attention
          </button>
        </div>

        <div className="w-full lg:w-80">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search buildings"
            className="w-full rounded-full border border-zinc-200 bg-white/80 px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none transition-colors"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
        <span>{pageInfo.totalMatchingCount} buildings</span>
        <span aria-hidden="true">•</span>
        <span>{data.aggregate.needsAttentionNow} need attention</span>
        <span aria-hidden="true">•</span>
        <span>{data.aggregate.readyForReview} ready</span>
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          message={
            search || needsAttentionOnly
              ? "No buildings match this view."
              : "No buildings yet."
          }
          action={
            search || needsAttentionOnly ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setNeedsAttentionOnly(false);
                }}
                className="btn-secondary px-3 py-2"
              >
                Clear
              </button>
            ) : data.operatorAccess.canManage ? (
              <AddBuildingDialogTrigger buttonClassName="btn-secondary px-3 py-2" />
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.items.map((item) => {
            const primaryStatus = buildPrimaryStatus(item);
            const metaChip = buildMetaChip(item);
            const nextAction = truncateCopy(item.nextAction.title, 42);

            return (
              <Link
                key={item.buildingId}
                href={`/buildings/${item.buildingId}`}
                className="group rounded-[28px] px-6 py-5 transition-all hover:bg-white"
                style={{
                  background: "rgba(255,255,255,0.82)",
                  border: "1px solid rgba(205, 210, 214, 0.72)",
                  boxShadow: "0 24px 52px -40px rgba(27, 39, 51, 0.22)",
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-dashboard-display text-[1.65rem] font-medium tracking-[-0.04em] text-zinc-900">
                        {item.buildingName}
                      </h2>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${chipClass(metaChip)}`}
                      >
                        {metaChip}
                      </span>
                    </div>

                    <p className="font-dashboard-sans text-[0.95rem] text-zinc-500">
                      {buildSecondaryLine(item)}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 font-dashboard-sans text-sm">
                      <span className="font-medium text-zinc-900">{primaryStatus}</span>
                      <span className="text-zinc-400">•</span>
                      <span className="text-zinc-600">{nextAction}</span>
                    </div>
                  </div>

                  <ArrowRight
                    size={18}
                    className="mt-1 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5"
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {pageInfo.totalMatchingCount > pageSize ? (
        <div className="flex items-center justify-between pt-2 text-sm text-zinc-500">
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={moveToPreviousPage}
              disabled={cursorHistory.length === 0}
              className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={moveToNextPage}
              disabled={!pageInfo.nextCursor}
              className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
