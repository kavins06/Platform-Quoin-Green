import { getComplianceStatusDisplay } from "@/components/internal/status-helpers";

export function StatusDot({ status }: { status: string }) {
 const config = getComplianceStatusDisplay(status);
 const color =
 config.tone === "success"
 ? "#16a34a"
 : config.tone === "warning"
 ? "#ca8a04"
 : config.tone === "danger"
 ? "#dc2626"
 : "#9ca3af";
 return (
 <span className="inline-flex items-center gap-1.5 text-sm text-zinc-700">
 <span
 className="h-1.5 w-1.5 rounded-full"
 style={{ backgroundColor: color }}
 />
 {config.label}
 </span>
 );
}
