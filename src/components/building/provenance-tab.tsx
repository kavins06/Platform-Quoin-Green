"use client";

import { trpc } from "@/lib/trpc";
import {
 EmptyState,
 ErrorState,
 LoadingState,
 Panel,
 formatDate,
} from "@/components/internal/admin-primitives";

export function ProvenanceTab({ buildingId }: { buildingId: string }) {
 const rulePackages = trpc.provenance.rulePackages.useQuery({ activeOnly: true });
 const factorSets = trpc.provenance.factorSetVersions.useQuery({ activeOnly: true });
 const runs = trpc.provenance.complianceRuns.useQuery({ buildingId, limit: 20 });
 const submissions = trpc.provenance.benchmarkSubmissions.useQuery({ buildingId, limit: 10 });
 const filings = trpc.provenance.filingRecords.useQuery({ buildingId, limit: 10 });

 if (
 rulePackages.isLoading ||
 factorSets.isLoading ||
 runs.isLoading ||
 submissions.isLoading ||
 filings.isLoading
 ) {
 return <LoadingState />;
 }

 if (rulePackages.error || factorSets.error || runs.error || submissions.error || filings.error) {
 const error =
 rulePackages.error ?? factorSets.error ?? runs.error ?? submissions.error ?? filings.error;
 return <ErrorState message="Provenance records are unavailable." detail={error?.message} />;
 }

 return (
 <div className="space-y-6">
 <div className="grid gap-6 xl:grid-cols-2">
 <Panel title="Active Rule Packages" subtitle="Governed rule packages used by compliance workflows.">
 {!rulePackages.data || rulePackages.data.length === 0 ? (
 <EmptyState message="No active rule packages found." />
 ) : (
 <div className="space-y-3">
 {rulePackages.data.map((pkg) => (
 <div key={pkg.id} className="py-4 border-t border-zinc-200 first:border-0 first:pt-0">
 <div className="font-medium text-zinc-900">{pkg.key}</div>
 <div className="mt-1 text-xs text-zinc-500">{pkg.name}</div>
 <div className="mt-2 text-xs text-zinc-600">
 {pkg.versions.map((version) => `${version.version} (${version.status})`).join(", ")}
 </div>
 </div>
 ))}
 </div>
 )}
 </Panel>

 <Panel title="Active Factor Sets" subtitle="Governed factor sets and standards used by the engines.">
 {!factorSets.data || factorSets.data.length === 0 ? (
 <EmptyState message="No active factor sets found." />
 ) : (
 <div className="space-y-3">
 {factorSets.data.map((factorSet) => (
 <div key={factorSet.id} className="py-4 border-t border-zinc-200 first:border-0 first:pt-0">
 <div className="font-medium text-zinc-900">{factorSet.key}</div>
 <div className="mt-1 text-xs text-zinc-500">
 {factorSet.version} • {factorSet.status}
 </div>
 <div className="mt-1 text-xs text-zinc-600">
 Effective {formatDate(factorSet.effectiveFrom)}
 </div>
 </div>
 ))}
 </div>
 )}
 </Panel>
 </div>

 <Panel title="Compliance Runs" subtitle="Governed calculation runs and manifests for this building.">
 {!runs.data || runs.data.length === 0 ? (
 <EmptyState message="No governed compliance runs found for this building." />
 ) : (
 <div className="space-y-3">
 {runs.data.map((run) => (
 <div key={run.id} className="py-4 border-t border-zinc-200 first:border-0 first:pt-0">
 <div className="flex items-center justify-between gap-3">
 <div className="font-medium text-zinc-900">{run.runType}</div>
 <div className="text-xs text-zinc-500">{run.status}</div>
 </div>
 <div className="mt-1 text-xs text-zinc-500">
 Executed {formatDate(run.executedAt)} • {run.ruleVersion.rulePackage.key} {run.ruleVersion.version}
 </div>
 <div className="mt-1 text-xs text-zinc-600">
 Factor set {run.factorSetVersion.key} {run.factorSetVersion.version}
 </div>
 </div>
 ))}
 </div>
 )}
 </Panel>

 <div className="grid gap-6 xl:grid-cols-2">
 <Panel title="Benchmark Submissions" subtitle="Canonical benchmarking submissions and their governed runs.">
 {!submissions.data || submissions.data.length === 0 ? (
 <EmptyState message="No benchmark submissions found." />
 ) : (
 <div className="space-y-3">
 {submissions.data.map((submission) => (
 <div key={submission.id} className="py-4 border-t border-zinc-200 first:border-0 first:pt-0">
 <div className="font-medium text-zinc-900">
 Reporting year {submission.reportingYear}
 </div>
 <div className="mt-1 text-xs text-zinc-500">{submission.status}</div>
 <div className="mt-1 text-xs text-zinc-600">
 Rule {submission.ruleVersion.rulePackage.key} {submission.ruleVersion.version}
 </div>
 </div>
 ))}
 </div>
 )}
 </Panel>

 <Panel title="Filing Records" subtitle="Governed filing records and linked evidence for this building.">
 {!filings.data || filings.data.length === 0 ? (
 <EmptyState message="No filing records found." />
 ) : (
 <div className="space-y-3">
 {filings.data.map((filing) => (
 <div key={filing.id} className="py-4 border-t border-zinc-200 first:border-0 first:pt-0">
 <div className="font-medium text-zinc-900">
 {filing.filingType} • {filing.status}
 </div>
 <div className="mt-1 text-xs text-zinc-500">
 Filing year {filing.filingYear ?? "—"} • {formatDate(filing.createdAt)}
 </div>
 <div className="mt-1 text-xs text-zinc-600">
 Evidence artifacts {filing.evidenceArtifacts.length}
 </div>
 </div>
 ))}
 </div>
 )}
 </Panel>
 </div>
 </div>
 );
}
