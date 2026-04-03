import React from "react";

export function PageHeader({
  title,
  subtitle,
  kicker = "Benchmarking workbench",
  children,
  variant = "default",
  density = "regular",
}: {
  title: string;
  subtitle?: string;
  kicker?: string;
  children?: React.ReactNode;
  variant?: "default" | "portfolio";
  density?: "regular" | "compact";
}) {
  const isPortfolio = variant === "portfolio";
  const isCompact = density === "compact";

  return (
    <div
      className={
        isCompact
          ? "flex flex-col gap-3 pb-4 lg:flex-row lg:items-center lg:justify-between"
          : "flex flex-col gap-5 pb-8 lg:flex-row lg:items-end lg:justify-between"
      }
      style={{
        borderBottom: isPortfolio
          ? "1px solid rgba(203, 209, 214, 0.55)"
          : "0.5px solid rgba(169,180,185,0.3)",
      }}
    >
      <div
        className={
          isCompact
            ? "space-y-1"
            : isPortfolio
              ? "space-y-3"
              : "space-y-2"
        }
      >
        {kicker ? (
          <div
            className={
              isCompact
                ? "font-dashboard-sans text-[0.82rem] font-medium tracking-[0.02em]"
                : isPortfolio
                ? "font-dashboard-sans text-[0.82rem] font-medium tracking-[0.02em]"
                : "font-sans text-[11px] tracking-[0.06em]"
            }
            style={{ color: isPortfolio ? "#7b828b" : "#717c82" }}
          >
            {kicker}
          </div>
        ) : null}
        <h1
          className={
            isCompact
              ? "font-dashboard-sans text-[1rem] font-semibold tracking-[-0.01em]"
              : isPortfolio
              ? "font-dashboard-display text-[clamp(2.3rem,5vw,3.65rem)] font-medium leading-[0.96] tracking-[-0.04em]"
              : "font-display font-bold tracking-tight leading-tight"
          }
          style={{
            fontSize: isPortfolio ? undefined : "2.55rem",
            color: isPortfolio ? "#20262d" : "#2a3439",
          }}
        >
          {title}
        </h1>
        {subtitle && !isCompact ? (
          <p
            className={
              isPortfolio
                ? "font-dashboard-sans max-w-2xl text-[1.02rem] leading-7"
                : "font-sans text-sm leading-relaxed"
            }
            style={{
              color: isPortfolio ? "#5d6670" : "#566166",
              maxWidth: isPortfolio ? "34rem" : "56rem",
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {children && (
        <div className="flex items-center gap-4 lg:justify-end">{children}</div>
      )}
    </div>
  );
}
