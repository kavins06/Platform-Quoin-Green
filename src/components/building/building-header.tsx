"use client";

import React from "react";
import { BuildingDeleteDialog } from "./building-delete-dialog";

interface BuildingHeaderProps {
  buildingId: string;
  name: string;
  address: string;
  propertyType: string;
  grossSquareFeet: number;
  yearBuilt: number | null;
  espmPropertyId: string | null;
  portfolioManagerManagement: {
    managementMode: string;
    status: string;
    latestErrorMessage: string | null;
    connectedUsername?: string | null;
    targetUsername?: string | null;
    connectedAccountId?: string | number | bigint | null;
    providerUsername?: string | null;
  } | null;
  portfolioManagerProvisioning: {
    status: string;
    espmPropertyId: string | number | bigint | null;
    latestErrorMessage: string | null;
    latestJobId: string | null;
  } | null;
  portfolioManagerImportState: {
    status: string;
    latestErrorMessage: string | null;
  } | null;
  portfolioManagerSetupSummary?: {
    summaryState: string;
    summaryLine: string;
    isLinked: boolean;
  } | null;
  portfolioManagerRuntimeHealth?: {
    workerStatus: string;
    lastHeartbeatAt: string | null;
    warning: string | null;
    latestJob: {
      stalled: boolean;
    };
  } | null;
  canManage: boolean;
  onUpload: () => void;
}

export function BuildingHeader({
  buildingId,
  espmPropertyId,
  portfolioManagerProvisioning,
  canManage,
  onUpload,
}: BuildingHeaderProps) {
  const linkedPropertyId =
    portfolioManagerProvisioning?.espmPropertyId?.toString() ?? espmPropertyId;

  return (
    <div className="flex justify-end pb-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canManage ? (
          <button
            onClick={onUpload}
            className="rounded-full bg-zinc-900 px-5 py-2.5 font-dashboard-sans text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Upload data
          </button>
        ) : null}

        {canManage ? (
          <BuildingDeleteDialog
            buildingId={buildingId}
          />
        ) : null}
      </div>
    </div>
  );
}
