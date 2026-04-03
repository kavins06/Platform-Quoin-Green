import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base: sharp, no rounded corners, institutional feel
  "inline-flex shrink-0 items-center justify-center border border-transparent text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary: slate-blue fill, Stitch institutional
        default:
          "bg-[#545f73] text-[#f6f7ff] hover:bg-[#485367] active:bg-[#3d4759] focus-visible:outline-[#545f73]",
        // Teal CTA: for primary compliance actions
        luminous:
          "bg-[#006b63] text-[#e2fffa] hover:bg-[#005e57] active:bg-[#004f4a] focus-visible:outline-[#006b63]",
        // Ghost border: transparent with hairline
        outline:
          "bg-transparent border-[rgba(169,180,185,0.4)] text-[#2a3439] hover:bg-[#e8eff3] focus-visible:outline-[#545f73]",
        // Muted fill secondary
        secondary:
          "bg-[#e8eff3] text-[#2a3439] hover:bg-[#e1e9ee] focus-visible:outline-[#545f73]",
        // No background
        ghost:
          "hover:bg-[#f0f4f7] text-[#566166] hover:text-[#2a3439] focus-visible:outline-[#545f73]",
        // Danger
        destructive:
          "bg-[rgba(159,64,61,0.08)] text-[#9f403d] hover:bg-[rgba(159,64,61,0.14)] border-[rgba(159,64,61,0.2)] focus-visible:outline-[#9f403d]",
        // Text link
        link: "text-[#545f73] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-3 text-[11px] uppercase tracking-widest font-semibold",
        xs:      "h-6 gap-1 px-2 text-[10px] uppercase tracking-widest font-semibold",
        sm:      "h-7 gap-1 px-2.5 text-[11px] uppercase tracking-widest font-semibold",
        lg:      "h-10 gap-2 px-4 text-[11px] uppercase tracking-widest font-semibold",
        icon:    "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
