"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
 CRITICAL: { color: "text-red-700", bg: "bg-red-50", border: "border-red-200", label: "Critical" },
 HIGH: { color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200", label: "High" },
 MEDIUM: { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", label: "Medium" },
 LOW: { color: "text-zinc-600", bg: "bg-zinc-100", border: "border-zinc-200", label: "Low" },
};

const RULE_LABELS: Record<string, string> = {
 EUI_SPIKE: "EUI Spike",
 SCORE_DROP: "Score Drop",
 CONSUMPTION_ANOMALY: "Consumption Anomaly",
 SEASONAL_DEVIATION: "Seasonal Deviation",
 SUSTAINED_DRIFT: "Sustained Drift",
};

const STATUS_LABELS: Record<string, { text: string; dot: string }> = {
 ACTIVE: { text: "Active", dot: "bg-red-500" },
 ACKNOWLEDGED: { text: "Acknowledged", dot: "bg-amber-500" },
 RESOLVED: { text: "Resolved", dot: "bg-emerald-500" },
};

type AlertFilter = "ALL" | "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED";

export function AlertsTab({ buildingId }: { buildingId: string }) {
 const utils = trpc.useUtils();
 const [filter, setFilter] = useState<AlertFilter>("ALL");

 const { data: alerts, isLoading } = trpc.drift.listAlerts.useQuery({
 buildingId,
 status: filter === "ALL" ? undefined : filter,
 limit: 50,
 });

 const { data: summary } = trpc.drift.alertSummary.useQuery({ buildingId });

 const acknowledgeMutation = trpc.drift.acknowledge.useMutation({
 onSuccess: () => {
 utils.drift.listAlerts.invalidate({ buildingId });
 utils.drift.alertSummary.invalidate({ buildingId });
 },
 });

 const resolveMutation = trpc.drift.resolve.useMutation({
 onSuccess: () => {
 utils.drift.listAlerts.invalidate({ buildingId });
 utils.drift.alertSummary.invalidate({ buildingId });
 },
 });

 if (isLoading) {
 return (
 <div className="overflow-hidden">
 <div className="loading-bar h-0.5 w-1/3 bg-zinc-300" />
 </div>
 );
 }

 return (
 <div className="space-y-6">
 {/* Summary Cards */}
 {summary && (
 <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
 <SummaryCard label="Active Alerts" value={summary.active} accent="text-zinc-900" />
 <SummaryCard label="Critical" value={summary.critical} accent="text-red-600" />
 <SummaryCard label="High" value={summary.high} accent="text-orange-600" />
 <SummaryCard label="Medium" value={summary.medium} accent="text-amber-600" />
 <SummaryCard label="Low" value={summary.low} accent="text-zinc-600" />
 </div>
 )}

 {/* Filter Tabs */}
 <div className="flex gap-2 text-sm">
 {(["ALL", "ACTIVE", "ACKNOWLEDGED", "RESOLVED"] as AlertFilter[]).map((f) => (
 <button
 key={f}
 onClick={() => setFilter(f)}
 className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
 filter === f
 ? "bg-zinc-900 text-white "
 : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
 }`}
 >
 {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
 </button>
 ))}
 </div>

 {/* Alert List */}
 {!alerts || alerts.length === 0 ? (
 <div className="border border-zinc-200 p-12 text-center">
 <svg className="mx-auto h-12 w-12 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
 <p className="mt-3 text-sm text-zinc-500">
 {filter === "ALL"
 ? "No drift alerts detected. Your building is performing within expected ranges."
 : `No ${filter.toLowerCase()} alerts.`}
 </p>
 </div>
 ) : (
 <div className="space-y-4">
 {alerts.map((alert) => {
 const sev = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.LOW;
 const statusInfo = STATUS_LABELS[alert.status] ?? STATUS_LABELS.ACTIVE;
 const detectedDate = new Date(alert.detectedAt);

 return (
 <div
 key={alert.id}
 className={`rounded-xl border ${sev.border} ${sev.bg} p-5 transition-all hover:`}
 >
 <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
 <div className="flex-1">
 <div className="flex items-center gap-2 flex-wrap">
 <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${sev.color} ${sev.bg} ring-1 ring-inset ring-current/20`}>
 {sev.label}
 </span>
 <span className="text-zinc-300 font-normal">|</span>
 <span className="text-xs font-medium text-zinc-600">
 {RULE_LABELS[alert.ruleId] ?? alert.ruleId}
 </span>
 <span className="text-zinc-300 font-normal">|</span>
 <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
 <span className={`inline-block h-2 w-2 rounded-full ${statusInfo.dot} ring-1 ring-white/50`} />
 {statusInfo.text}
 </span>
 </div>

 <h4 className="mt-3 text-base font-semibold tracking-tight text-zinc-900">
 {alert.title}
 </h4>
 <p className="mt-1 text-sm text-zinc-700 leading-relaxed">
 {alert.description}
 </p>

 {alert.aiRootCause && (
 <div className="mt-3 bg-white border border-zinc-200 p-3">
 <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-700">AI Root Cause Analysis</p>
 <p className="mt-1 text-sm text-zinc-900 leading-relaxed">{alert.aiRootCause}</p>
 </div>
 )}

 <p className="mt-4 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
 Detected {detectedDate.toLocaleDateString("en-US", {
 month: "short",
 day: "numeric",
 year: "numeric",
 hour: "2-digit",
 minute: "2-digit",
 })}
 </p>
 </div>

 {/* Action Buttons */}
 {alert.status === "ACTIVE" && (
 <div className="flex flex-row sm:flex-col gap-2 w-full sm:w-auto mt-2 sm:mt-0">
 <button
 onClick={() => acknowledgeMutation.mutate({ alertId: alert.id })}
 disabled={acknowledgeMutation.isPending}
 className="flex-1 sm:flex-none rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 transition-colors disabled:opacity-50"
 >
 Acknowledge
 </button>
 <button
 onClick={() => resolveMutation.mutate({ alertId: alert.id })}
 disabled={resolveMutation.isPending}
 className="flex-1 sm:flex-none rounded-md bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-50 transition-colors disabled:opacity-50"
 >
 Resolve
 </button>
 </div>
 )}
 {alert.status === "ACKNOWLEDGED" && (
 <div className="flex flex-row sm:flex-col gap-2 w-full sm:w-auto mt-2 sm:mt-0">
 <button
 onClick={() => resolveMutation.mutate({ alertId: alert.id })}
 disabled={resolveMutation.isPending}
 className="flex-1 sm:flex-none rounded-md bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-50 transition-colors disabled:opacity-50"
 >
 Resolve
 </button>
 </div>
 )}
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 );
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent: string }) {
 return (
 <div className="border border-zinc-200 p-5 transition-shadow hover:">
 <p className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">{label}</p>
 <p className={`mt-2 text-3xl font-bold tracking-tight ${accent}`}>{value}</p>
 </div>
 );
}
