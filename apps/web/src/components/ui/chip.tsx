"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: React.ReactNode
  /** Toggle state. Selected fills night and turns 600, so the state never rests on colour alone (aria-pressed). */
  selected?: boolean
  /** Optional count after the label (matching products), already formatted for the locale. */
  count?: string
  /** Trailing ✕: the chip removes an applied filter. Pass an accessible label via aria-label. */
  removable?: boolean
}

/**
 * Filter pill (Home «الكل · البشرة · الشعر», PLP filters): 44 tall, 18px padding, 14px; selected = night fill +
 * linen 600, idle = linen + 1px line-2 outline, 500.
 */
const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, selected, count, removable, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={removable ? undefined : selected ?? false}
      className={cn(
        "inline-flex h-control-s shrink-0 items-center gap-2 whitespace-nowrap rounded-pill px-4.5 text-16 font-display",
        "transition-[background-color,box-shadow,color,transform] duration-fast ease-standard",
        selected || removable
          ? "bg-cobalt font-semibold text-chalk shadow-e1"
          : "bg-linen font-medium text-ink shadow-outline-control hover:bg-chalk",
        className
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {count !== undefined ? <bdi className="text-12 opacity-80">{count}</bdi> : null}
      {removable ? <Icon name="close" size={16} /> : null}
    </button>
  )
)
Chip.displayName = "Chip"

export { Chip }
