"use client";

import React from "react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import {
 BuildingForm,
 type BuildingFormData,
} from "@/components/onboarding/building-form";

interface AddBuildingDialogTriggerProps {
 buttonLabel?: string;
 buttonClassName?: string;
 title?: string;
 description?: string;
}

export function AddBuildingDialogTrigger({
 buttonLabel = "Add building",
 buttonClassName = "btn-primary px-4 py-2.5",
 title = "Add building",
 description = "Only what ESPM needs.",
}: AddBuildingDialogTriggerProps) {
 const utils = trpc.useUtils();
 const [isOpen, setIsOpen] = useState(false);
 const [portfolioManagerWarning, setPortfolioManagerWarning] = useState<string | null>(
  null,
 );
 const [warningBuildingId, setWarningBuildingId] = useState<string | null>(null);
 const createBuilding = trpc.building.create.useMutation({
 onSuccess: async (createdBuilding) => {
 await Promise.all([
 utils.building.list.invalidate(),
 utils.building.portfolioWorklist.invalidate(),
 utils.building.portfolioStats.invalidate(),
 ]);

 const warning =
  "portfolioManagerWarning" in createdBuilding
   ? createdBuilding.portfolioManagerWarning
   : null;

 if (typeof warning === "string" && warning.trim().length > 0) {
  setPortfolioManagerWarning(warning);
  setWarningBuildingId(createdBuilding.id);
  return;
 }

 setIsOpen(false);

 if (typeof window !== "undefined") {
 window.location.assign(`/buildings/${createdBuilding.id}`);
 }
 },
 });

 function handleCreateBuilding(input: BuildingFormData) {
 setPortfolioManagerWarning(null);
 setWarningBuildingId(null);
 createBuilding.mutate({
 name: input.name,
 address: input.address,
 grossSquareFeet: input.grossSquareFeet,
 yearBuilt: input.yearBuilt ?? undefined,
 plannedConstructionCompletionYear:
  input.plannedConstructionCompletionYear ?? undefined,
 occupancyRate: input.occupancyRate ?? undefined,
 irrigatedAreaSquareFeet: input.irrigatedAreaSquareFeet ?? undefined,
 numberOfBuildings: input.numberOfBuildings,
 propertyUses: input.propertyUses,
 });
 }

 return (
 <>
 <button onClick={() => setIsOpen(true)} className={buttonClassName}>
 {buttonLabel}
 </button>

 <Dialog
 open={isOpen}
 onOpenChange={(nextOpen) => {
 setIsOpen(nextOpen);
 if (!nextOpen) {
 setPortfolioManagerWarning(null);
 setWarningBuildingId(null);
 }
 }}
 >
 <DialogContent
 className="border border-zinc-200/80 bg-white p-0 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.35)]"
 style={{ width: "min(calc(100vw - 2rem), 48rem)", maxWidth: "48rem" }}
 >
 <DialogHeader className="border-b border-zinc-200 px-6 py-5">
 <DialogTitle>{title}</DialogTitle>
 <DialogDescription>{description}</DialogDescription>
 </DialogHeader>
 <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-6 py-6">
 <div className="space-y-5">
 <div className="min-w-0">
 {portfolioManagerWarning ? (
 <div className="mb-4 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
 <p className="font-medium">Building saved in Quoin only.</p>
 <p className="mt-1">{portfolioManagerWarning}</p>
 {warningBuildingId ? (
 <button
 type="button"
 className="mt-3 rounded-full border border-amber-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-amber-900"
 onClick={() => {
 setIsOpen(false);
 if (typeof window !== "undefined") {
 window.location.assign(`/buildings/${warningBuildingId}`);
 }
 }}
 >
 Open building
 </button>
 ) : null}
 </div>
 ) : null}
 <BuildingForm
 onSubmit={handleCreateBuilding}
 loading={createBuilding.isPending}
 />
 {createBuilding.error ? (
 <div className="mt-4 border border-red-200 bg-red-50 p-4 text-sm text-red-800">
 {createBuilding.error.message}
 </div>
 ) : null}
 </div>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 </>
 );
}
