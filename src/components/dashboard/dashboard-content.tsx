"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/layout/page-header";
import { KPIRow } from "./kpi-row";
import { Skeleton } from "@/components/ui/skeleton";
import { AddBuildingDialogTrigger } from "./add-building-dialog-trigger";

function truncateCopy(value: string, max = 92) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 3).trimEnd()}...`;
}

function urgencyClass(level: string) {
  if (level === "NOW") {
    return {
      backgroundColor: "rgba(184, 95, 84, 0.08)",
      color: "#8d514c",
    };
  }

  if (level === "NEXT") {
    return {
      backgroundColor: "rgba(180, 146, 88, 0.1)",
      color: "#8a6a35",
    };
  }

  return {
    backgroundColor: "rgba(118, 128, 138, 0.1)",
    color: "#6c7580",
  };
}

export function DashboardContent() {
  const onboarding = trpc.building.onboardingStatus.useQuery();
  const stats = trpc.building.portfolioStats.useQuery();
  const worklist = trpc.building.portfolioWorklist.useQuery({
    pageSize: 5,
    sortBy: "PRIORITY",
  });

  if (stats.isLoading || worklist.isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="space-y-3 pt-3">
          <Skeleton className="h-4 w-24 rounded-full" />
          <Skeleton className="h-10 w-52 rounded-full" />
          <Skeleton className="h-5 w-72 rounded-full" />
        </div>

        <Skeleton className="h-28 w-full rounded-[30px]" />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-44 w-full rounded-[28px]" />
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {[1, 2].map((item) => (
            <Skeleton key={item} className="h-80 w-full rounded-[32px]" />
          ))}
        </div>
      </div>
    );
  }

  if (stats.error || worklist.error) {
    const err = stats.error ?? worklist.error;
    const code = err?.data?.code;
    const msg = err?.message;

    if (code === "FORBIDDEN" || msg?.includes("No organization")) {
      return (
        <div className="flex min-h-[500px] flex-col items-center justify-center rounded-[32px] border border-dashed border-zinc-200 bg-white/85 p-12 text-center">
          <p className="font-dashboard-display text-4xl font-medium tracking-[-0.05em] text-zinc-900">
            No organization selected
          </p>
          <p className="mt-3 max-w-sm font-dashboard-sans text-[0.98rem] leading-7 text-zinc-500">
            Create or choose an organization to see your portfolio.
          </p>
          <a
            href="/onboarding"
            className="mt-6 rounded-full bg-zinc-900 px-5 py-2.5 font-dashboard-sans text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Get started
          </a>
        </div>
      );
    }

    if (code === "NOT_FOUND" || msg?.includes("Organization not found")) {
      return (
        <div className="flex min-h-[500px] flex-col items-center justify-center rounded-[32px] border border-dashed border-zinc-200 bg-white/85 p-12 text-center">
          <p className="font-dashboard-display text-4xl font-medium tracking-[-0.05em] text-zinc-900">
            Organization syncing
          </p>
          <p className="mt-3 max-w-sm font-dashboard-sans text-[0.98rem] leading-7 text-zinc-500">
            This usually settles in a few seconds.
          </p>
          <button
            onClick={() => {
              stats.refetch();
              worklist.refetch();
            }}
            className="mt-6 rounded-full border border-zinc-300 bg-white px-5 py-2.5 font-dashboard-sans text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Refresh
          </button>
        </div>
      );
    }

    return (
      <div className="flex min-h-[500px] flex-col items-center justify-center rounded-[32px] border border-dashed border-zinc-200 bg-white/85 p-12 text-center">
        <p className="font-dashboard-display text-4xl font-medium tracking-[-0.05em] text-zinc-900">
          Portfolio data could not load
        </p>
        <p className="mt-3 max-w-sm font-dashboard-sans text-[0.98rem] leading-7 text-zinc-500">
          {msg}
        </p>
        <button
          onClick={() => {
            stats.refetch();
            worklist.refetch();
          }}
          className="mt-6 rounded-full border border-zinc-300 bg-white px-5 py-2.5 font-dashboard-sans text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          Try again
        </button>
      </div>
    );
  }

  const portfolioStats = stats.data!;
  const queue = worklist.data!;
  const scoredCount =
    portfolioStats.compliant +
    portfolioStats.atRisk +
    portfolioStats.nonCompliant;
  const priorityItems = queue.items.slice(0, 4);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Portfolio"
        subtitle="A calm view of what matters today."
        kicker="Overview"
        variant="portfolio"
        density="compact"
      />

      <KPIRow
        items={[
          {
            label: "Buildings",
            value: portfolioStats.totalBuildings,
            subtitle:
              portfolioStats.totalBuildings > 0
                ? "A small, current view of the portfolio."
                : "Start with the first building record.",
          },
          {
            label: "Ready for review",
            value: portfolioStats.atRisk,
            subtitle:
              portfolioStats.atRisk > 0
                ? "These are the next likely reviews."
                : "Nothing is waiting for review right now.",
          },
          {
            label: "Average score",
            value: portfolioStats.averageScore || "Not available",
            subtitle:
              scoredCount > 0
                ? `Based on ${scoredCount} recent score${scoredCount === 1 ? "" : "s"}.`
                : "Scores will appear once data is available.",
          },
          {
            label: "Needs fresh data",
            value: portfolioStats.pendingData,
            subtitle:
              portfolioStats.pendingData > 0
                ? "A few records could use a refresh."
                : "Everything looks current enough to rely on.",
            subtitleColor:
              portfolioStats.pendingData > 0 && portfolioStats.pendingData === portfolioStats.totalBuildings
                ? "danger"
                : undefined,
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <section
          className="rounded-[32px] px-7 py-7"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(247,244,239,0.84) 100%)",
            border: "1px solid rgba(205, 210, 214, 0.72)",
            boxShadow: "0 24px 52px -38px rgba(27, 39, 51, 0.28)",
          }}
        >
          <div className="space-y-8">
            <div className="space-y-3">
              <p
                className="font-dashboard-sans text-[0.84rem] font-semibold tracking-[0.08em]"
                style={{ color: "#7a818b" }}
              >
                Next step
              </p>
              <h2 className="font-dashboard-display text-[2.2rem] font-medium tracking-[-0.045em] text-zinc-900">
                Keep it simple.
              </h2>
              <p className="max-w-md font-dashboard-sans text-[1rem] leading-7 text-zinc-600">
                Add a building or open the full list when you want more detail.
              </p>
            </div>

            <div className="space-y-3">
              <AddBuildingDialogTrigger
                buttonClassName="w-full rounded-full bg-zinc-900 px-5 py-3.5 font-dashboard-sans text-[0.96rem] font-medium text-white transition hover:bg-zinc-800"
              />
              <Link
                href="/buildings"
                className="flex items-center justify-between rounded-full border border-zinc-300 bg-white/75 px-5 py-3.5 font-dashboard-sans text-[0.95rem] font-medium text-zinc-800 transition-colors hover:bg-white"
              >
                <span>Open buildings</span>
                <ArrowRight size={16} className="text-zinc-400" />
              </Link>
            </div>
          </div>
        </section>

        <section
          className="rounded-[32px] px-7 py-7"
          style={{
            background: "rgba(255,255,255,0.82)",
            border: "1px solid rgba(205, 210, 214, 0.72)",
            boxShadow: "0 24px 52px -40px rgba(27, 39, 51, 0.22)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <p
                className="font-dashboard-sans text-[0.84rem] font-semibold tracking-[0.08em]"
                style={{ color: "#7a818b" }}
              >
                Next up
              </p>
              <h2 className="font-dashboard-display text-[2.1rem] font-medium tracking-[-0.045em] text-zinc-900">
                A short list.
              </h2>
              <p className="max-w-lg font-dashboard-sans text-[1rem] leading-7 text-zinc-600">
                These are the few items most worth opening next.
              </p>
            </div>
            <Link
              href="/buildings"
              className="pt-1 font-dashboard-sans text-[0.93rem] font-medium text-zinc-500 transition-colors hover:text-zinc-900"
            >
              View all
            </Link>
          </div>

          {priorityItems.length === 0 ? (
            <div className="mt-6 rounded-[24px] border border-dashed border-zinc-200 px-5 py-6 font-dashboard-sans text-[0.96rem] leading-7 text-zinc-500">
              Nothing needs attention right now.
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {priorityItems.map((item) => (
                <Link
                  key={`${item.buildingId}-${item.nextAction.code}`}
                  href={`/buildings/${item.buildingId}`}
                  className="block rounded-[24px] border border-zinc-200/80 bg-[rgba(250,248,244,0.82)] px-5 py-4 transition-colors hover:bg-white"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-dashboard-sans text-[1rem] font-semibold text-zinc-900">
                          {item.buildingName}
                        </span>
                        <span
                          className="rounded-full px-2.5 py-1 font-dashboard-sans text-[0.72rem] font-semibold tracking-[0.06em]"
                          style={urgencyClass(item.triage.urgency)}
                        >
                          {item.triage.urgency}
                        </span>
                      </div>
                      <p className="font-dashboard-sans text-[0.95rem] font-medium text-zinc-800">
                        {item.nextAction.title}
                      </p>
                      <p className="font-dashboard-sans text-[0.94rem] leading-6 text-zinc-500">
                        {truncateCopy(item.nextAction.reason)}
                      </p>
                    </div>
                    <ArrowRight size={16} className="mt-1 shrink-0 text-zinc-400" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
