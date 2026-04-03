import React, { type ReactNode } from "react";
import { formatPathwayLabel as formatGovernedPathwayLabel } from "@/lib/contracts/beps";

export type StatusTone = "success" | "warning" | "danger" | "muted" | "info";
export type PrimaryComplianceSurfaceStatus =
 | "DATA_INCOMPLETE"
 | "READY"
 | "COMPLIANT"
 | "NON_COMPLIANT";
export type SubmissionReadinessSurfaceStatus =
 | "DATA_INCOMPLETE"
 | "READY_FOR_REVIEW"
 | "READY_TO_SUBMIT"
 | "SUBMITTED";
export type WorklistTriageBucket =
 | "COMPLIANCE_BLOCKER"
 | "ARTIFACT_ATTENTION"
 | "REVIEW_QUEUE"
 | "SUBMISSION_QUEUE"
 | "SYNC_ATTENTION"
 | "MONITORING";

export function toneClasses(tone: StatusTone) {
 switch (tone) {
 case "success":
 return "badge-status-success";
 case "warning":
 return "badge-status-warning";
 case "danger":
 return "badge-status-danger";
 case "info":
 return "badge-status-info";
 default:
 return "badge-status border-zinc-200 bg-zinc-50 text-zinc-600";
 }
}

export function toneDotClasses(tone: StatusTone) {
 switch (tone) {
 case "success":
 return "bg-emerald-700";
 case "warning":
 return "bg-amber-700";
 case "danger":
 return "bg-red-700";
 case "info":
 return "bg-slate-700";
 default:
 return "bg-zinc-400";
 }
}

export function humanizeToken(value: string | null | undefined) {
 if (!value) {
 return "Not available";
 }

 const pathwayLabel = formatGovernedPathwayLabel(value);
 if (pathwayLabel) {
 return pathwayLabel;
 }

 const cycleMatch = value.match(/^CYCLE_(\d+)$/);
 if (cycleMatch) {
 return `BEPS Cycle ${cycleMatch[1]}`;
 }

 return value
 .toLowerCase()
 .split("_")
 .map((part) => {
 switch (part) {
 case "qa":
 return "QA";
 case "beps":
 return "BEPS";
 case "doee":
 return "DOEE";
 case "espm":
 return "ESPM";
 case "pm":
 return "PM";
 case "acp":
 return "ACP";
 case "kbtu":
 return "kBtu";
 default:
 return part.charAt(0).toUpperCase() + part.slice(1);
 }
 })
 .join(" ");
}

export function formatCycleLabel(value: string | null | undefined) {
 return humanizeToken(value);
}

export function getComplianceStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "COMPLIANT":
 return { label: "Compliant", tone: "success" as const };
 case "AT_RISK":
 return { label: "At risk", tone: "warning" as const };
 case "NON_COMPLIANT":
 return { label: "Non-compliant", tone: "danger" as const };
 case "EXEMPT":
 return { label: "Exempt", tone: "muted" as const };
 case "PENDING_DATA":
 return { label: "Needs data", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getWorkflowStageStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "COMPLETE":
 return { label: "Complete", tone: "success" as const };
 case "NEEDS_ATTENTION":
 return { label: "Needs attention", tone: "warning" as const };
 case "BLOCKED":
 return { label: "Blocked", tone: "danger" as const };
 case "NOT_STARTED":
 return { label: "Not started", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getSubmissionWorkflowStateDisplay(status: string | null | undefined) {
 switch (status) {
 case "READY_FOR_REVIEW":
 return { label: "Ready for review", tone: "info" as const };
 case "APPROVED_FOR_SUBMISSION":
 return { label: "Approved for submission", tone: "success" as const };
 case "SUBMITTED":
 return { label: "Submitted", tone: "warning" as const };
 case "COMPLETED":
 return { label: "Completed", tone: "success" as const };
 case "NEEDS_CORRECTION":
 return { label: "Needs correction", tone: "danger" as const };
 case "DRAFT":
 return { label: "Draft", tone: "muted" as const };
 case "NOT_STARTED":
 return { label: "Not started", tone: "muted" as const };
 case "SUPERSEDED":
 return { label: "Superseded", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getGovernedVersionStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "ACTIVE":
 return { label: "Active", tone: "success" as const };
 case "CANDIDATE":
 return { label: "Candidate", tone: "info" as const };
 case "DRAFT":
 return { label: "Draft", tone: "muted" as const };
 case "SUPERSEDED":
 return { label: "Superseded", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getSyncStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "SUCCEEDED":
 return { label: "Up to date", tone: "success" as const };
 case "PARTIAL":
 return { label: "Partial import", tone: "warning" as const };
 case "FAILED":
 return { label: "Sync failed", tone: "danger" as const };
 case "RUNNING":
 return { label: "Syncing", tone: "info" as const };
 case "NOT_STARTED":
 return { label: "Not started", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getRuntimeStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "SUCCEEDED":
 return { label: "Healthy", tone: "success" as const };
 case "STALE":
 return { label: "Stale", tone: "warning" as const };
 case "FAILED":
 return { label: "Failed", tone: "danger" as const };
 case "RETRYING":
 return { label: "Retrying", tone: "warning" as const };
 case "RUNNING":
 return { label: "Running", tone: "info" as const };
 case "IDLE":
 return { label: "Idle", tone: "muted" as const };
 case "NOT_CONNECTED":
 return { label: "Not connected", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getPortfolioManagerProvisioningStatusDisplay(
 status: string | null | undefined,
) {
 switch (status) {
 case "SUCCEEDED":
 return { label: "Linked", tone: "success" as const };
 case "FAILED":
 return { label: "Needs attention", tone: "danger" as const };
 case "RUNNING":
 return { label: "Provisioning", tone: "info" as const };
 case "QUEUED":
 return { label: "Queued", tone: "warning" as const };
 case "NOT_STARTED":
 return { label: "Not started", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getPortfolioManagerConnectionStateDisplay(
 state: string | null | undefined,
) {
 switch (state) {
 case "WAITING_FOR_REQUEST":
 return { label: "Waiting for connection", tone: "warning" as const };
 case "WAITING_FOR_SHARES":
 return { label: "Waiting for shares", tone: "warning" as const };
 case "SYNCING":
 return { label: "Syncing", tone: "info" as const };
 case "CONNECTED":
 return { label: "Connected", tone: "success" as const };
 case "FAILED":
 return { label: "Sync failed", tone: "danger" as const };
 case "QUOIN_MANAGED":
 return { label: "Managed by Quoin", tone: "info" as const };
 case "NOT_CONNECTED":
 return { label: "Not connected", tone: "muted" as const };
 default:
 return { label: humanizeToken(state), tone: "muted" as const };
 }
}

export function getPortfolioManagerSetupDisplay(state: string | null | undefined) {
 switch (state) {
 case "BENCHMARK_READY":
 return { label: "Benchmark-ready", tone: "success" as const };
 case "READY_FOR_NEXT_STEP":
 return { label: "Setup ready for next step", tone: "success" as const };
 case "NEEDS_ATTENTION":
 return { label: "Needs attention", tone: "danger" as const };
 case "SETUP_INCOMPLETE":
 return { label: "Setup incomplete", tone: "warning" as const };
 default:
 return { label: humanizeToken(state), tone: "muted" as const };
 }
}

export function getPortfolioManagerUsageStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "SUCCEEDED":
 return { label: "Usage applied", tone: "success" as const };
 case "PARTIAL":
 return { label: "Usage partial", tone: "warning" as const };
 case "FAILED":
 return { label: "Usage failed", tone: "danger" as const };
 case "RUNNING":
 return { label: "Usage running", tone: "info" as const };
 case "QUEUED":
 return { label: "Usage queued", tone: "warning" as const };
 case "NOT_STARTED":
 return { label: "Not started", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getPortfolioManagerCoverageStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "READY_FOR_METRICS":
 return { label: "Ready for metrics", tone: "success" as const };
 case "PARTIAL_COVERAGE":
 return { label: "Partial coverage", tone: "warning" as const };
 case "NO_USABLE_DATA":
 return { label: "No usable data", tone: "muted" as const };
 case "NEEDS_ATTENTION":
 return { label: "Needs attention", tone: "danger" as const };
 case "NOT_STARTED":
 return { label: "Not started", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getPortfolioManagerMetricsStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "SUCCEEDED":
 return { label: "Metrics ready", tone: "success" as const };
 case "PARTIAL":
 return { label: "Metrics partial", tone: "warning" as const };
 case "FAILED":
 return { label: "Metrics failed", tone: "danger" as const };
 case "RUNNING":
 return { label: "Refreshing metrics", tone: "info" as const };
 case "QUEUED":
 return { label: "Metrics queued", tone: "warning" as const };
 case "SKIPPED":
 return { label: "Metrics skipped", tone: "muted" as const };
 case "NOT_STARTED":
 return { label: "Not started", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getPacketStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "FINALIZED":
 return { label: "Finalized", tone: "success" as const };
 case "GENERATED":
 return { label: "Generated", tone: "info" as const };
 case "STALE":
 return { label: "Needs refresh", tone: "warning" as const };
 case "NOT_STARTED":
 return { label: "Not started", tone: "muted" as const };
 case "DRAFT":
 return { label: "Draft", tone: "muted" as const };
 case "NONE":
 return { label: "Not started", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getPenaltySummaryStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "ESTIMATED":
 return { label: "Estimated", tone: "warning" as const };
 case "NOT_APPLICABLE":
 return { label: "Not applicable", tone: "muted" as const };
 case "INSUFFICIENT_CONTEXT":
 return { label: "Insufficient context", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getOperationalAnomalyConfidenceDisplay(
 confidenceBand: string | null | undefined,
) {
 switch (confidenceBand) {
 case "HIGH":
 return { label: "High confidence", tone: "success" as const };
 case "MEDIUM":
 return { label: "Medium confidence", tone: "warning" as const };
 case "LOW":
 return { label: "Low confidence", tone: "muted" as const };
 default:
 return { label: humanizeToken(confidenceBand), tone: "muted" as const };
 }
}

export function getOperationalAnomalyPenaltyImpactDisplay(
 status: string | null | undefined,
) {
 switch (status) {
 case "ESTIMATED":
 return { label: "Penalty impact estimated", tone: "warning" as const };
 case "NOT_APPLICABLE":
 return { label: "No penalty context", tone: "muted" as const };
 case "INSUFFICIENT_CONTEXT":
 return { label: "Penalty impact unavailable", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getRequestItemStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "VERIFIED":
 return { label: "Verified", tone: "success" as const };
 case "RECEIVED":
 return { label: "Received", tone: "info" as const };
 case "REQUESTED":
 return { label: "Requested", tone: "warning" as const };
 case "BLOCKED":
 return { label: "Blocked", tone: "danger" as const };
 case "NOT_REQUESTED":
 return { label: "Not requested", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getReadinessStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "READY":
 return { label: "Ready", tone: "success" as const };
 case "BLOCKED":
 return { label: "Blocked", tone: "danger" as const };
 case "IN_PROGRESS":
 return { label: "In progress", tone: "warning" as const };
 case "OUT_OF_SCOPE":
 return { label: "Out of scope", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getVerificationStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "PASS":
 return { label: "Pass", tone: "success" as const };
 case "FAIL":
 return { label: "Fail", tone: "danger" as const };
 case "NEEDS_REVIEW":
 return { label: "Needs review", tone: "warning" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getDataIssueSeverityDisplay(severity: string | null | undefined) {
 switch (severity) {
 case "BLOCKING":
 return { label: "Blocking", tone: "danger" as const };
 case "WARNING":
 return { label: "Warning", tone: "warning" as const };
 default:
 return { label: humanizeToken(severity), tone: "muted" as const };
 }
}

export function getDataIssueStatusDisplay(status: string | null | undefined) {
 switch (status) {
 case "OPEN":
 return { label: "Open", tone: "danger" as const };
 case "IN_PROGRESS":
 return { label: "In progress", tone: "warning" as const };
 case "RESOLVED":
 return { label: "Resolved", tone: "success" as const };
 case "DISMISSED":
 return { label: "Dismissed", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getSourceReconciliationStatusDisplay(
 status: string | null | undefined,
) {
 switch (status) {
 case "CLEAN":
 return { label: "Clean", tone: "success" as const };
 case "CONFLICTED":
 return { label: "Conflicted", tone: "danger" as const };
 case "INCOMPLETE":
 return { label: "Incomplete", tone: "warning" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getSubmissionReadinessDisplay(
 status: SubmissionReadinessSurfaceStatus | string | null | undefined,
) {
 switch (status) {
 case "DATA_INCOMPLETE":
 return { label: "Data incomplete", tone: "warning" as const };
 case "READY_FOR_REVIEW":
 return { label: "Ready for review", tone: "info" as const };
 case "READY_TO_SUBMIT":
 return { label: "Ready to submit", tone: "success" as const };
 case "SUBMITTED":
 return { label: "Submitted", tone: "muted" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function getWorklistTriageDisplay(
 bucket: WorklistTriageBucket | string | null | undefined,
) {
 switch (bucket) {
 case "COMPLIANCE_BLOCKER":
 return { label: "Compliance blocker", tone: "danger" as const };
 case "ARTIFACT_ATTENTION":
 return { label: "Artifact attention", tone: "warning" as const };
 case "REVIEW_QUEUE":
 return { label: "Review queue", tone: "info" as const };
 case "SUBMISSION_QUEUE":
 return { label: "Submission queue", tone: "success" as const };
 case "SYNC_ATTENTION":
 return { label: "Sync attention", tone: "warning" as const };
 case "MONITORING":
 return { label: "Monitoring", tone: "muted" as const };
 default:
 return { label: humanizeToken(bucket), tone: "muted" as const };
 }
}

export function getPrimaryComplianceStatusDisplay(
 status: PrimaryComplianceSurfaceStatus | string | null | undefined,
) {
 switch (status) {
 case "DATA_INCOMPLETE":
 return { label: "Data incomplete", tone: "warning" as const };
 case "READY":
 return { label: "Ready", tone: "info" as const };
 case "COMPLIANT":
 return { label: "Compliant", tone: "success" as const };
 case "NON_COMPLIANT":
 return { label: "Non-compliant", tone: "danger" as const };
 default:
 return { label: humanizeToken(status), tone: "muted" as const };
 }
}

export function StatusBadge({
 label,
 tone,
 icon,
}: {
 label: string;
 tone: StatusTone;
 icon?: ReactNode;
}) {
 return (
 <span className={`${toneClasses(tone)}`}>
 <span className={`h-1.5 w-1.5 rounded-full ${toneDotClasses(tone)}`} />
 {icon}
 {label}
 </span>
 );
}
