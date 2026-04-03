"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

const REQUIRED_CONFIRMATION = "Delete";

export function BuildingDeleteDialog({
  buildingId,
}: {
  buildingId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const deleteBuilding = trpc.building.delete.useMutation({
    onSuccess: async (result) => {
      setActionMessage(result.message ?? null);
      await Promise.all([
        utils.building.get.invalidate({ id: buildingId }),
        utils.building.list.invalidate(),
        utils.building.portfolioWorklist.invalidate(),
        utils.building.portfolioStats.invalidate(),
        utils.building.onboardingStatus.invalidate(),
        utils.organization.governanceOverview.invalidate(),
      ]);
      if (result.outcome === "EXECUTED") {
        router.replace("/buildings");
      }
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setConfirmation("");
      setActionMessage(null);
      deleteBuilding.reset();
    }
    setOpen(nextOpen);
  }

  const confirmationMatches = confirmation === REQUIRED_CONFIRMATION;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-sans text-[11px] font-medium tracking-[0.06em] text-[#8d3a36] underline decoration-[rgba(159,64,61,0.25)] underline-offset-[0.35em] transition-colors hover:text-[#7c302d]"
      >
        Delete building
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="space-y-3">
            <DialogTitle>Delete building</DialogTitle>
            <DialogDescription>Delete this building from Quoin only.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-1">
            <div className="rounded-2xl border border-zinc-900 bg-zinc-50 px-4 py-3">
              <div className="text-sm font-semibold text-zinc-900">
                Delete from Quoin
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="building-delete-confirmation">Type Delete to confirm</Label>
              <Input
                id="building-delete-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Delete"
                aria-invalid={confirmation.length > 0 && !confirmationMatches}
              />
            </div>

            {deleteBuilding.error ? (
              <div className="border-l border-[#9f403d]/35 bg-[#fff8f7] px-4 py-3">
                <p className="text-[11px] font-medium tracking-[0.06em] text-[#8d3a36]">
                  Deletion failed
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#566166]">
                  {deleteBuilding.error.message}
                </p>
              </div>
            ) : null}

            {actionMessage ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {actionMessage}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={deleteBuilding.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                deleteBuilding.mutate({
                  id: buildingId,
                  deleteMode: "UNLINK_ONLY",
                })
              }
              disabled={!confirmationMatches || deleteBuilding.isPending}
            >
              {deleteBuilding.isPending
                ? "Deleting..."
                : "Delete from Quoin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
