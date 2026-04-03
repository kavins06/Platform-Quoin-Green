"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { BuildingOverviewTab, type ReadingTabKey } from "./building-overview-tab";
import { BenchmarkWorkbenchTab } from "./benchmark-workbench-tab";
import { BenchmarkRecordTab } from "./benchmark-record-tab";
import { BuildingDeleteDialog } from "./building-delete-dialog";
import { BuildingEditDialog } from "./building-edit-dialog";
import { UploadModal } from "./upload-modal";
import { motion, AnimatePresence } from "framer-motion";

interface Tab {
 key: string;
 label: string;
}

const TABS: Tab[] = [
 {
  key: "overview",
  label: "Overview",
 },
 {
  key: "benchmarking",
  label: "Benchmarking",
 },
 {
  key: "record",
  label: "Benchmark record",
 },
];

function defaultReportingYear() {
 return new Date().getUTCFullYear() - 1;
}

export function BuildingDetail({ buildingId }: { buildingId: string }) {
 const [activeTab, setActiveTab] = useState("overview");
 const [showUpload, setShowUpload] = useState(false);
 const [uploadUtility, setUploadUtility] = useState<ReadingTabKey>("electricity");

 const utils = trpc.useUtils();
 const { data, isLoading, error } = trpc.building.get.useQuery({
 id: buildingId,
 });

 const reportingYear =
 data?.readinessSummary.evaluations.benchmark?.reportingYear ??
 data?.readinessSummary.artifacts.benchmarkSubmission?.reportingYear ??
 defaultReportingYear();
 useEffect(() => {
 const applyHash = () => {
 const rawHash = window.location.hash.replace("#", "");
 const hash =
 rawHash === "interpretation" || rawHash === "evidence"
 ? "record"
 : rawHash === "workflow"
 ? "benchmarking"
 : rawHash === "decision-record"
 ? "record"
 : rawHash === "secondary" || rawHash === "advisory"
 ? "benchmarking"
 : rawHash;
 if (TABS.some((tab) => tab.key === hash)) {
 setActiveTab(hash);
 }
 };

 applyHash();
 window.addEventListener("hashchange", applyHash);
 return () => window.removeEventListener("hashchange", applyHash);
 }, []);

 const handleTabChange = (tabKey: string) => {
 setActiveTab(tabKey);
 window.history.replaceState(null, "", `#${tabKey}`);
 };

 if (isLoading) {
 return (
 <div className="overflow-hidden">
 <div className="loading-bar h-0.5 w-1/3 bg-zinc-300" />
 </div>
 );
 }

 if (error) {
 return (
 <p className="py-12 text-center text-sm text-zinc-500">
 {error.data?.code === "NOT_FOUND"
 ? "Building not found."
 : "Something went wrong. Try refreshing."}
 </p>
 );
 }

 if (!data) return null;

 return (
 <div className="-mt-6 space-y-8">
 <section className="space-y-5 pt-0">
 <div className="flex flex-col gap-4">
 <div className="space-y-2">
 <div className="flex items-center justify-between gap-4">
 <div className="text-sm font-medium text-zinc-500">Inside this building</div>
 {data.operatorAccess.canManage ? (
 <div className="flex items-center gap-2">
 <BuildingEditDialog
 building={{
 id: data.id,
 name: data.name,
 address: data.address,
 grossSquareFeet: data.grossSquareFeet,
 yearBuilt: data.yearBuilt,
 plannedConstructionCompletionYear:
 data.plannedConstructionCompletionYear,
 occupancyRate: data.occupancyRate,
 irrigatedAreaSquareFeet: data.irrigatedAreaSquareFeet,
 numberOfBuildings: data.numberOfBuildings,
 propertyUses: data.propertyUses,
 }}
 />
 <BuildingDeleteDialog
 buildingId={buildingId}
 />
 </div>
 ) : null}
 </div>
 <div className="flex flex-wrap items-center gap-2">
 {TABS.map((tab) => {
 const isActive = activeTab === tab.key;
 return (
 <button
 key={tab.key}
 onClick={() => handleTabChange(tab.key)}
 className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
 isActive
 ? "bg-white text-zinc-900 ring-1 ring-inset ring-zinc-200"
 : "text-zinc-500 hover:bg-white/60 hover:text-zinc-900"
 }`}
 >
 {tab.label}
 </button>
 );
 })}
 </div>
</div>
</div>

 <div className="min-w-0">
 <AnimatePresence mode="wait">
 <motion.div
 key={activeTab}
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -10 }}
 transition={{ duration: 0.2, ease: "easeOut" }}
 >
 {activeTab === "overview" && (
 <BuildingOverviewTab
 buildingId={buildingId}
 building={data}
 canManage={data.operatorAccess.canManage}
 onUpload={(utility) => {
 setUploadUtility(utility);
 setShowUpload(true);
 }}
 />
 )}

 {activeTab === "benchmarking" && (
       <BenchmarkWorkbenchTab
 buildingId={buildingId}
 canManage={data.operatorAccess.canManage}
 canManageSubmissionWorkflows={data.operatorAccess.canManage}
 onUpload={() => {
 setUploadUtility("electricity");
 setShowUpload(true);
 }}
 readinessSummary={data.readinessSummary}
 governedSummary={{
 artifactSummary: data.governedSummary.artifactSummary,
 submissionSummary: data.governedSummary.submissionSummary,
 runtimeSummary: data.governedSummary.runtimeSummary,
 }}
 />
 )}

 {activeTab === "record" && (
 <BenchmarkRecordTab buildingId={buildingId} />
 )}
 </motion.div>
 </AnimatePresence>
 </div>
 </section>

 {showUpload && (
 <UploadModal
 buildingId={buildingId}
 utilityScope={uploadUtility}
 onClose={() => setShowUpload(false)}
 onSuccess={() => {
 utils.building.get.invalidate({ id: buildingId });
 utils.building.list.invalidate();
 utils.building.portfolioWorklist.invalidate();
 utils.building.getArtifactWorkspace.invalidate({ buildingId });
 utils.building.energyReadings.invalidate({ buildingId, months: 24 });
 utils.building.utilityReadings.invalidate({ buildingId });
 utils.building.complianceHistory.invalidate({ buildingId });
 utils.benchmarking.getVerificationChecklist.invalidate({
 buildingId,
 reportingYear,
 });
 }}
 />
 )}
 </div>
 );
}
