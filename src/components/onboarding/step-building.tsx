"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { BuildingForm, type BuildingFormData } from "./building-form";

interface StepBuildingProps {
 onNext: (buildingId: string) => void;
 onSkip: () => void;
}

export function StepBuilding({ onNext, onSkip }: StepBuildingProps) {
 const [error, setError] = useState<string | null>(null);
 const onboarding = trpc.building.onboardingStatus.useQuery();
 const canManage = onboarding.data?.operatorAccess.canManage ?? false;

 const createBuilding = trpc.building.create.useMutation({
 onSuccess: (data) => onNext(data.id),
 onError: (err) => setError(err.message),
 });

 function handleSubmit(data: BuildingFormData) {
 setError(null);
 createBuilding.mutate({
 name: data.name,
 address: data.address,
 grossSquareFeet: data.grossSquareFeet,
 yearBuilt: data.yearBuilt ?? undefined,
 plannedConstructionCompletionYear:
  data.plannedConstructionCompletionYear ?? undefined,
 occupancyRate: data.occupancyRate ?? undefined,
 irrigatedAreaSquareFeet: data.irrigatedAreaSquareFeet ?? undefined,
 numberOfBuildings: data.numberOfBuildings,
 propertyUses: data.propertyUses,
 });
}

 return (
 <div className="space-y-8">
 <div>
 <h2 className="text-xl font-semibold tracking-tight text-zinc-900">Add a building</h2>
 <p className="mt-2 text-base leading-relaxed text-zinc-500">
 You can add more later.
 </p>
 </div>

 {error && (
 <div className="border-l-2 border-red-500 bg-red-50/50 pl-4 py-3">
 <p className="text-sm font-medium text-red-800">{error}</p>
 </div>
 )}

 {canManage ? (
 <BuildingForm
 onSubmit={handleSubmit}
 loading={createBuilding.isPending}
 />
 ) : (
 <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-4 text-sm text-zinc-600">
 Building creation is limited to organization managers and admins.
 </div>
 )}

 <button
 type="button"
 onClick={onSkip}
 className="w-full text-center text-sm font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
 >
 Skip for now
 </button>
 </div>
 );
}
