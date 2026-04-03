"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-0 data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // Stitch: tab list is a flat bar with hairline bottom
        "inline-flex w-full items-end gap-0 bg-transparent text-[#566166]",
        "border-b border-[rgba(169,180,185,0.3)]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Stitch: flat tab, bottom-border active indicator
        "relative inline-flex items-center justify-center gap-1.5 px-4 py-3",
        "font-sans text-[11px] font-medium uppercase tracking-[0.1em] whitespace-nowrap",
        "text-[#566166] transition-colors duration-150",
        "border-b-2 border-transparent -mb-px",
        // hover
        "hover:text-[#2a3439]",
        // active state
        "data-[state=active]:border-[#545f73] data-[state=active]:text-[#2a3439] data-[state=active]:font-semibold",
        // focus
        "focus-visible:outline-none focus-visible:ring-0",
        "disabled:pointer-events-none disabled:opacity-40",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
