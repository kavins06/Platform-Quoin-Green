"use client";

import { trpc } from "@/lib/trpc";
import { DecisionRecordTab } from "./decision-record-tab";

function defaultReportingYear() {
 return new Date().getUTCFullYear() - 1;
}

export function ComplianceTab({ buildingId }: { buildingId: string }) {
 const { data: building, isLoading } = trpc.building.get.useQuery({ id: buildingId });
 const reportingYear =
 building?.readinessSummary.evaluations.benchmark?.reportingYear ??
 defaultReportingYear();
 const verificationChecklist = trpc.benchmarking.getVerificationChecklist.useQuery(
 {
 buildingId,
 reportingYear,
 },
 {
 enabled: !!building && reportingYear != null,
 retry: false,
 },
 );

 if (isLoading) {
 return (
 <div className="overflow-hidden rounded-md">
 <div className="loading-bar h-1 w-1/3 bg-zinc-300" />
 </div>
 );
 }

 if (!building) {
 return null;
 }

 return (
 <DecisionRecordTab
 building={building}
 verificationChecklist={verificationChecklist.data}
 />
 );
}
