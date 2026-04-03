"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { BuildingForm } from "@/components/onboarding/building-form";
import type { BuildingPropertyUseKey } from "@/lib/buildings/property-use-registry";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BuildingEditDialogProps = {
  building: {
    id: string;
    name: string;
    address: string;
    grossSquareFeet: number;
    yearBuilt: number | null;
    plannedConstructionCompletionYear: number | null;
    occupancyRate: number | null;
    irrigatedAreaSquareFeet: number | null;
    numberOfBuildings: number;
    propertyUses: Array<{
      id: string;
      sortOrder: number;
      useKey: string;
      displayName: string;
      grossSquareFeet: number;
      details: Record<string, unknown>;
    }>;
  };
};

export function BuildingEditDialog({ building }: BuildingEditDialogProps) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const updateBuilding = trpc.building.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.building.get.invalidate({ id: building.id }),
        utils.building.list.invalidate(),
        utils.building.portfolioWorklist.invalidate(),
        utils.building.portfolioStats.invalidate(),
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId: building.id }),
        utils.portfolioManager.getBuildingMeterSetup.invalidate({
          buildingId: building.id,
        }),
        utils.portfolioManager.getBuildingUsageStatus.invalidate({
          buildingId: building.id,
        }),
      ]);
      setOpen(false);
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-900"
      >
        Edit info
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="border border-zinc-200/80 bg-white p-0 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.35)]"
          style={{ width: "min(calc(100vw - 2rem), 48rem)", maxWidth: "48rem" }}
        >
          <DialogHeader className="border-b border-zinc-200 px-6 py-5">
            <DialogTitle>Edit building</DialogTitle>
            <DialogDescription>Update the basics and property uses.</DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-6 py-6">
            <BuildingForm
              mode="edit"
              loading={updateBuilding.isPending}
              submitLabel="Save changes"
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
                  id: building.id,
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
            />

            {updateBuilding.error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {updateBuilding.error.message}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
