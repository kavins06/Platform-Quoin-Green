"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

interface EspmConnectCardProps {
  canManage: boolean;
}

function buildSummaryCopy(input: {
  summaryState: string;
  propertyCount: number;
  linkedBuildingCount: number;
}) {
  switch (input.summaryState) {
    case "WAITING_FOR_REQUEST":
      return "Save the customer's ESPM username, then ask that customer to connect and share with Quoin's provider account.";
    case "WAITING_FOR_SHARES":
      return "The customer account is connected. Quoin is waiting for property and meter shares.";
    case "SYNCING":
      return "Quoin is syncing shared ESPM properties through the provider account now.";
    case "CONNECTED":
      return `${input.propertyCount} shared propert${input.propertyCount === 1 ? "y is" : "ies are"} available. ${input.linkedBuildingCount} already linked in Quoin.`;
    case "FAILED":
      return "The provider-share sync needs attention before Quoin can finish importing ESPM data.";
    case "QUOIN_MANAGED":
      return "Portfolio Manager is being handled through Quoin.";
    case "NOT_CONNECTED":
    default:
      return "Add a customer's ESPM username when you are ready to connect Portfolio Manager.";
  }
}

function buildMetaCopy(input: {
  summaryState: string;
  providerUsername: string | null | undefined;
  targetUsername: string | null | undefined;
  linkedUsername: string | null | undefined;
  linkedAccountId: string | null | undefined;
  latestErrorMessage: string | null | undefined;
  backgroundSyncMessage: string | null | undefined;
}) {
  if (input.latestErrorMessage) {
    return input.latestErrorMessage;
  }

  if (input.backgroundSyncMessage) {
    return input.backgroundSyncMessage;
  }

  const customerUsername = input.linkedUsername ?? input.targetUsername;
  const segments = [
    customerUsername ? `Customer ESPM account: ${customerUsername}` : null,
    input.providerUsername ? `Provider: ${input.providerUsername}` : null,
    input.linkedAccountId ? `Customer account ID ${input.linkedAccountId}` : null,
  ].filter(Boolean);

  if (segments.length > 0) {
    return segments.join(" | ");
  }

  return "Quoin syncs Portfolio Manager through the provider account after the customer shares access.";
}

export function EspmConnectCard({ canManage }: EspmConnectCardProps) {
  const connection = trpc.portfolioManager.getProviderConnectionStatus.useQuery(undefined, {
    enabled: canManage,
    refetchInterval: (query) =>
      query.state.data?.summary.state === "WAITING_FOR_REQUEST" ||
      query.state.data?.summary.state === "WAITING_FOR_SHARES" ||
      query.state.data?.summary.state === "SYNCING"
        ? 5000
        : false,
  });

  if (!canManage) {
    return null;
  }

  const state = connection.data;
  const summaryState = state?.summary.state ?? "NOT_CONNECTED";
  const propertyCount = state?.remoteProperties.length ?? 0;
  const linkedBuildingCount = state?.summary.linkedBuildingCount ?? 0;
  const summaryCopy = buildSummaryCopy({
    summaryState,
    propertyCount,
    linkedBuildingCount,
  });
  const metaCopy = buildMetaCopy({
    summaryState,
    providerUsername: state?.summary.providerUsername,
    targetUsername: state?.summary.targetUsername,
    linkedUsername: state?.summary.linkedUsername,
    linkedAccountId: state?.summary.linkedAccountId,
    latestErrorMessage: state?.summary.latestErrorMessage,
    backgroundSyncMessage: state?.summary.backgroundSyncMessage,
  });

  return (
    <section
      className="rounded-[30px] px-6 py-5 lg:px-7"
      style={{
        background:
          "linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(247,244,237,0.86) 100%)",
        border: "1px solid rgba(205, 210, 214, 0.72)",
        boxShadow: "0 20px 44px -34px rgba(27, 39, 51, 0.28)",
      }}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 font-dashboard-sans text-[0.76rem] font-semibold"
              style={{
                backgroundColor: "rgba(115, 126, 138, 0.09)",
                color: "#5e6670",
              }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    summaryState === "CONNECTED"
                      ? "#4f7a68"
                      : summaryState === "FAILED" ||
                          summaryState === "WAITING_FOR_REQUEST" ||
                          summaryState === "WAITING_FOR_SHARES"
                        ? "#a67c38"
                        : "#97a0aa",
                }}
              />
              Portfolio Manager
            </span>
          </div>

          <div>
            <p
              className="font-dashboard-sans text-[1.02rem] font-medium leading-7"
              style={{ color: "#252c33" }}
            >
              {summaryCopy}
            </p>
            <p
              className="mt-1 font-dashboard-sans text-[0.93rem] leading-6"
              style={{
                color:
                  summaryState === "FAILED" ||
                  summaryState === "WAITING_FOR_REQUEST" ||
                  summaryState === "WAITING_FOR_SHARES"
                    ? "#8d6a3b"
                    : "#6b737c",
              }}
            >
              {metaCopy}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="lg"
            className="rounded-full border-zinc-300 bg-white/75 px-5 font-dashboard-sans text-[0.88rem] font-medium text-zinc-800 hover:bg-white"
          >
            <Link href="/settings">
              {summaryState === "NOT_CONNECTED" || summaryState === "WAITING_FOR_REQUEST"
                ? "Connect in settings"
                : "Open settings"}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
