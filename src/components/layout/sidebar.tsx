"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartNoAxesCombined,
  Building2,
  Menu,
  Settings,
  X,
} from "lucide-react";
import { useState } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Building2;
  disabled?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Portfolio", icon: ChartNoAxesCombined },
  { href: "/buildings", label: "Buildings", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-50 rounded-full p-2 text-[#6b737b] transition-colors hover:bg-[#f1f0ec] hover:text-[#2b3138] lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-[rgba(42,52,57,0.4)] lg:hidden transition-opacity duration-300"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar: Stitch — surface-container-low bg, hairline right border */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          background:
            "linear-gradient(180deg, rgba(247,246,242,0.98) 0%, rgba(242,243,241,0.96) 100%)",
          borderRight: "1px solid rgba(207, 211, 214, 0.7)",
        }}
      >
        {/* Brand */}
        <div
          className="px-6 py-5"
          style={{ borderBottom: "1px solid rgba(207, 211, 214, 0.64)" }}
        >
          <Link
            href="/buildings"
            className="transition-opacity hover:opacity-80"
          >
            <div>
              <div
                className="font-dashboard-sans text-[11px] font-semibold uppercase leading-none tracking-[0.18em]"
                style={{ color: "#6c7480" }}
              >
                Project
              </div>
              <div className="mt-1 font-dashboard-display text-[1.45rem] font-medium leading-none tracking-[0.02em] text-[#272e35]">
                QUOIN
              </div>
            </div>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 text-[#6b737b] transition-colors hover:text-[#2b3138] lg:hidden"
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-6 px-0">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 py-3 px-6 transition-all duration-150"
                style={{
                  borderLeft: active ? "2px solid #6c7480" : "2px solid transparent",
                  color: active ? "#2b3138" : "#69727b",
                  backgroundColor: active ? "rgba(255,255,255,0.62)" : "transparent",
                  fontFamily: "var(--font-dashboard-sans)",
                  fontSize: "15px",
                  fontWeight: active ? 600 : 500,
                  textTransform: "none",
                  letterSpacing: "0.01em",
                  borderTopRightRadius: "18px",
                  borderBottomRightRadius: "18px",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.color = "#2b3138";
                    (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.44)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.color = "#69727b";
                    (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                  }
                }}
              >
                <Icon
                  size={16}
                  strokeWidth={active ? 2 : 1.5}
                  style={{ color: active ? "#4d5966" : "#a4adb6", flexShrink: 0 }}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className="px-6 py-4 font-dashboard-sans text-[10px] tracking-[0.08em]"
          style={{
            borderTop: "1px solid rgba(207, 211, 214, 0.64)",
            color: "#9ea5ac",
          }}
        >
          ESPM Benchmarking
        </div>
      </aside>
    </>
  );
}
