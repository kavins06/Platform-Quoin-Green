"use client";

import React, { useEffect, useState } from "react";
import type { ReactNode } from "react";

const LOADING_MESSAGES = [
  "Evaluating compliance state...",
  "Reconciling energy sources...",
  "Reading building record...",
  "Verifying artifact chain...",
  "Checking benchmark readiness...",
  "Syncing Portfolio Manager data...",
  "Resolving submission readiness...",
  "Auditing triage queue...",
];

export function LoadingState() {
  const [msgIndex, setMsgIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Randomize starting point client-side only (avoids SSR mismatch)
    setMsgIndex(Math.floor(Math.random() * LOADING_MESSAGES.length));

    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
        setVisible(true);
      }, 200);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="py-16 flex flex-col items-start gap-6">
      <div className="overflow-hidden w-48 border-t border-zinc-200">
        <div className="loading-bar h-px w-1/3 bg-zinc-900" />
      </div>
      <p
        className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400 transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {LOADING_MESSAGES[msgIndex]}
      </p>
    </div>
  );
}

export function ErrorState({
  message,
  detail,
  action,
}: {
  message: string;
  detail?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-2 border-l border-[#D0342C]/35 bg-[#fff8f7] pl-5 py-4 pr-4">
      <p className="text-[11px] font-medium tracking-[0.06em] text-[#8d3a36]">
        Validation issue
      </p>
      <p className="mt-3 text-sm font-medium text-zinc-900">{message}</p>
      {detail ? (
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{detail}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-t border-zinc-200/80 py-12">
      <p className="max-w-3xl text-sm leading-relaxed text-zinc-500">
        {message}
      </p>
      {action ? <div className="mt-5 flex">{action}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "space-y-4 border-t border-zinc-200/80 pt-5" : "quoin-panel"}>
      <div
        className={
          compact
            ? "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
            : "quoin-panel-header"
        }
      >
        <div>
          <h3
            className={
              compact
                ? "text-[1.05rem] font-semibold tracking-tight text-zinc-900"
                : "font-display text-[1.85rem] font-medium tracking-tight text-zinc-900"
            }
          >
            {title}
          </h3>
          {subtitle ? (
            <p
              className={
                compact
                  ? "mt-1 max-w-3xl text-sm leading-6 text-zinc-500"
                  : "mt-2 max-w-3xl text-[15px] leading-7 text-zinc-500"
              }
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-3">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function MetricGrid({
  items,
  compact = false,
}: {
  items: Array<{
    label: string;
    value: ReactNode;
    tone?: "default" | "danger" | "warning" | "success";
  }>;
  compact?: boolean;
}) {
  const tones = {
    default: "text-zinc-900",
    danger: "text-red-700",
    warning: "text-amber-700",
    success: "text-emerald-700",
  } as const;

  return (
    <div className={compact ? "grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4" : "quoin-metric-strip lg:grid-cols-4"}>
      {items.map((item) => (
        <div key={item.label} className={compact ? "border-l border-zinc-200/80 pl-3 first:border-l-0 first:pl-0" : "quoin-metric"}>
          <p className={compact ? "mb-1 text-[11px] font-medium text-zinc-500" : "quoin-metric-label"}>
            {item.label}
          </p>
          <p
            className={`${compact ? "text-base font-semibold tracking-tight" : "quoin-metric-value"} ${
              tones[item.tone ?? "default"]
            }`}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function formatMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return `$${value.toLocaleString()}`;
}

export function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(digits);
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function downloadFile(params: {
  fileName: string;
  content: string;
  contentType: string;
  encoding?: "utf-8" | "base64";
}) {
  const blob =
    params.encoding === "base64"
      ? new Blob(
          [
            Uint8Array.from(atob(params.content), (character) =>
              character.charCodeAt(0),
            ),
          ],
          { type: params.contentType },
        )
      : new Blob([params.content], { type: params.contentType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = params.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export function downloadTextFile(params: {
  fileName: string;
  content: string;
  contentType: string;
}) {
  downloadFile({ ...params, encoding: "utf-8" });
}
