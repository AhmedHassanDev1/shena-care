"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: React.ReactNode
  /** Toggle state. Selected chips are filled ink and semibold, so the state never rests on colour alone. */
  selected?: boolean
  /** Optional count shown after the label (e.g. matching products). */
  count?: number
  /** Renders a trailing close icon: the chip removes an applied filter. Pass an accessible label via aria-label. */
  removable?: boolean
}

/**
 * Pressable filter pill (shape rule: pressable → pill). Use `selected` for toggles inside a filter sheet and
 * `removable` for the applied-filter row; both keep the 44px touch target.
 */
const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, selected, count, removable, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={removable ? undefined : selected ?? false}
      className={cn(
        "inline-flex h-control-m shrink-0 items-center gap-2 whitespace-nowrap rounded-pill border-[1.5px] px-4 text-label",
        "transition-[background-color,border-color] duration-quick ease-out",
        selected || removable
          ? "border-foreground bg-foreground font-semibold text-card"
          : "border-input bg-card text-foreground hover:border-foreground",
        className
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {count !== undefined ? <bdi className="text-caption tabular-nums opacity-80">{count}</bdi> : null}
      {removable ? <Icon name="close" size={16} aria-hidden /> : null}
    </button>
  )
)
Chip.displayName = "Chip"

export { Chip }
