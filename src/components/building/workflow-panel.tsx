"use client";

import React from "react";
import {
  StatusBadge,
  getWorkflowStageStatusDisplay,
} from "@/components/internal/status-helpers";

type WorkflowStageStatus =
  | "COMPLETE"
  | "NEEDS_ATTENTION"
  | "BLOCKED"
  | "NOT_STARTED";

interface WorkflowPanelProps {
  activeStage: string;
  onStageChange: (stageKey: string) => void;
  stages: Array<{
    key: string;
    label: string;
    status: WorkflowStageStatus;
    summary: string;
  }>;
}

export function WorkflowPanel({
  activeStage,
  onStageChange,
  stages,
}: WorkflowPanelProps) {
  return (
    <div className="border-t border-zinc-200/80 pt-4">
      <div className="grid gap-2 lg:grid-cols-3">
        {stages.map((stage, index) => {
          const status = getWorkflowStageStatusDisplay(stage.status);
          const isActive = activeStage === stage.key;

          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => onStageChange(stage.key)}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                isActive
                  ? "border-zinc-300 bg-white text-zinc-900 shadow-[0_10px_30px_-26px_rgba(15,23,42,0.45)]"
                  : "border-zinc-200/80 bg-[#fafbfc] text-zinc-700 hover:border-zinc-300 hover:bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-zinc-500">
                    Step {index + 1}
                  </div>
                  <div className="mt-1 text-sm font-semibold tracking-tight">
                    {stage.label}
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-zinc-500">
                    {stage.summary}
                  </div>
                </div>
                <StatusBadge label={status.label} tone={status.tone} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
