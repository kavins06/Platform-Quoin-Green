"use client";

import { trpc } from "@/lib/trpc";
import { formatPeriodDateRange } from "@/lib/period-date";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  formatDate,
} from "@/components/internal/admin-primitives";

type UtilitySectionKey = "ELECTRIC" | "GAS" | "WATER";

const SECTIONS: Array<{
  key: UtilitySectionKey;
  title: string;
  subtitle: string;
  emptyMessage: string;
}> = [
  {
    key: "ELECTRIC",
    title: "Energy bills",
    subtitle: "Saved electricity bills.",
    emptyMessage: "No energy bills yet.",
  },
  {
    key: "GAS",
    title: "Gas bills",
    subtitle: "Saved gas bills.",
    emptyMessage: "No gas bills yet.",
  },
  {
    key: "WATER",
    title: "Water bills",
    subtitle: "Saved water bills.",
    emptyMessage: "No water bills yet.",
  },
];

function formatUploadStatus(status: string) {
  switch (status) {
    case "CONFIRMED":
      return "Saved";
    case "READY_FOR_REVIEW":
      return "Needs review";
    case "FAILED":
      return "Failed";
    case "PROCESSING":
      return "Processing";
    case "QUEUED":
      return "Queued";
    default:
      return status.replaceAll("_", " ").toLowerCase();
  }
}

export function BenchmarkRecordTab({ buildingId }: { buildingId: string }) {
  const uploadsQuery = trpc.building.listUtilityBillUploads.useQuery(
    { buildingId },
    { retry: false },
  );

  if (uploadsQuery.isLoading) {
    return <LoadingState />;
  }

  if (uploadsQuery.error) {
    return (
      <ErrorState
        message="Bill library is unavailable."
        detail={uploadsQuery.error.message}
      />
    );
  }

  const uploads = uploadsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <Panel
        title="Benchmark record"
        subtitle="This page only keeps the bills saved for this building."
        compact
      >
        <div className="space-y-5 border-t border-zinc-200/80 pt-4">
          {SECTIONS.map((section) => {
            const sectionUploads = uploads.filter((upload) => upload.utilityType === section.key);

            return (
              <section key={section.key} className="space-y-3">
                <div>
                  <div className="text-sm font-semibold tracking-tight text-zinc-900">
                    {section.title}
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-zinc-500">
                    {section.subtitle}
                  </div>
                </div>

                {sectionUploads.length === 0 ? (
                  <EmptyState message={section.emptyMessage} />
                ) : (
                  <div className="space-y-3">
                    {sectionUploads.map((upload) => (
                      <div
                        key={upload.id}
                        className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold tracking-tight text-zinc-900">
                              {upload.originalFileName}
                            </div>
                            <div className="mt-1 text-[12px] leading-5 text-zinc-500">
                              {upload.periodStart && upload.periodEnd
                                ? formatPeriodDateRange(upload.periodStart, upload.periodEnd)
                                : `Uploaded ${formatDate(upload.createdAt)}`}
                            </div>
                            <div className="mt-2 text-[12px] leading-5 text-zinc-500">
                              {formatUploadStatus(upload.status)}
                              {upload.confirmedAt ? ` · Saved ${formatDate(upload.confirmedAt)}` : ""}
                              {upload.latestErrorMessage ? ` · ${upload.latestErrorMessage}` : ""}
                            </div>
                          </div>

                          {upload.fileUrl ? (
                            <a
                              href={upload.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-4"
                            >
                              Open bill
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
