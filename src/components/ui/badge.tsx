import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Stitch: badges are "stamps" — 0px radius, no pill shape
const badgeVariants = cva(
  "inline-flex h-fit w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border-transparent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // Slate-blue: governed / default
        default:
          "bg-[#545f73] text-[#f6f7ff]",
        // Teal: compliant / approved
        secondary:
          "bg-[rgba(0,107,99,0.1)] text-[#006b63]",
        // Error: non-compliant
        destructive:
          "bg-[rgba(159,64,61,0.1)] text-[#9f403d]",
        // Hairline outline: pending / informational
        outline:
          "border border-[rgba(169,180,185,0.4)] text-[#566166] bg-transparent",
        // Muted: secondary status
        ghost:
          "bg-[#e8eff3] text-[#566166]",
        // Warning: amber
        warning:
          "bg-[rgba(180,130,0,0.08)] text-[#7d5a00]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
