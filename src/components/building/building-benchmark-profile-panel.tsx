"use client";

import { trpc } from "@/lib/trpc";
import { BuildingForm } from "@/components/onboarding/building-form";
import {
  ErrorState,
  LoadingState,
  MetricGrid,
  Panel,
} from "@/components/internal/admin-primitives";
import { PROPERTY_TYPE_LABELS } from "@/lib/buildings/beps-targets";
import type { BuildingPropertyUseKey } from "@/lib/buildings/property-use-registry";

export function BuildingBenchmarkProfilePanel({
  buildingId,
  canManage,
}: {
  buildingId: string;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const buildingQuery = trpc.building.get.useQuery({ id: buildingId });
  const updateBuilding = trpc.building.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.building.get.invalidate({ id: buildingId }),
        utils.building.list.invalidate(),
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingMeterSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
      ]);
    },
  });

  if (buildingQuery.isLoading) {
    return <LoadingState />;
  }

  if (buildingQuery.error || !buildingQuery.data) {
    return (
      <ErrorState
        message="Benchmarking profile could not load."
        detail={buildingQuery.error?.message ?? "Building data is unavailable."}
      />
    );
  }

  const building = buildingQuery.data;
  const benchmarkProfile = building.benchmarkProfile;

  return (
    <Panel
      title="Benchmarking profile"
      subtitle="Detailed property uses now drive building completeness, benchmarking inputs, and Portfolio Manager setup readiness."
      compact
    >
      <div className="space-y-4 border-t border-zinc-200/80 pt-4">
        <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
          <MetricGrid
            compact
            items={[
              {
                label: "Profile status",
                value: benchmarkProfile.isComplete ? "Complete" : "Incomplete",
                tone: benchmarkProfile.isComplete ? "success" : "warning",
              },
              {
                label: "Derived type",
                value:
                  PROPERTY_TYPE_LABELS[benchmarkProfile.derivedPropertyType] ??
                  benchmarkProfile.derivedPropertyType,
              },
              {
                label: "Target score",
                value: String(benchmarkProfile.recommendedTargetScore),
              },
              {
                label: "Detailed uses",
                value: String(building.propertyUses.length),
              },
            ]}
          />
        </div>

        {!benchmarkProfile.isComplete ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-700">
              Missing inputs
            </div>
            <ul className="mt-2 space-y-1.5">
              {benchmarkProfile.missingInputMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {canManage ? (
          <BuildingForm
            mode="edit"
            initialData={{
              name: building.name,
              address: building.address,
              grossSquareFeet: building.grossSquareFeet,
              yearBuilt: building.yearBuilt,
              plannedConstructionCompletionYear:
                building.plannedConstructionCompletionYear,
              occupancyRate: building.occupancyRate,
              irrigatedAreaSquareFeet: building.irrigatedAreaSquareFeet,
              numberOfBuildings: building.numberOfBuildings,
              propertyUses: building.propertyUses.map((propertyUse) => ({
                id: propertyUse.id,
                sortOrder: propertyUse.sortOrder,
                useKey: propertyUse.useKey as BuildingPropertyUseKey,
                displayName: propertyUse.displayName,
                grossSquareFeet: propertyUse.grossSquareFeet,
                details: propertyUse.details as Record<
                  string,
                  string | number | boolean | null
                >,
              })),
            }}
            onSubmit={(data) =>
              updateBuilding.mutate({
                id: buildingId,
                data: {
                  name: data.name,
                  address: data.address,
                  grossSquareFeet: data.grossSquareFeet,
                  yearBuilt: data.yearBuilt ?? undefined,
                  plannedConstructionCompletionYear:
                    data.plannedConstructionCompletionYear ?? undefined,
                  occupancyRate: data.occupancyRate ?? undefined,
                  irrigatedAreaSquareFeet:
                    data.irrigatedAreaSquareFeet ?? undefined,
                  numberOfBuildings: data.numberOfBuildings,
                  propertyUses: data.propertyUses,
                },
              })
            }
            loading={updateBuilding.isPending}
            submitLabel="Save benchmarking profile"
          />
        ) : (
          <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-4 text-sm text-zinc-600">
            Benchmarking profile edits require manager or admin access.
          </div>
        )}
      </div>
    </Panel>
  );
}
