import * as React from "react"

import { cn } from "@/lib/utils"

// Stitch: bottom-border only, no bounding box, no rounded corners
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Layout
        "h-9 w-full min-w-0 px-0 py-1 text-sm",
        // Stitch: bottom border only — "signature line on a document"
        "border-0 border-b border-[rgba(169,180,185,0.6)] bg-transparent",
        // Typography: Inter
        "font-sans text-[#2a3439] placeholder:text-[#a9b4b9]",
        // No rounding
        "rounded-none",
        // Transitions
        "transition-colors duration-150 outline-none",
        // Focus: border thickens & shifts to primary
        "focus:border-b-2 focus:border-[#545f73]",
        // File input
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[#2a3439]",
        // States
        "disabled:pointer-events-none disabled:opacity-40",
        "aria-invalid:border-[#9f403d] aria-invalid:focus:border-[#9f403d]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
