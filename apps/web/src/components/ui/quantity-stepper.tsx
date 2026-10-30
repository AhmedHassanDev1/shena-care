"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface QuantityStepperProps {
  value: number
  /** Value as displayed in the active language (Arabic-Indic in Arabic). */
  displayValue: string
  min?: number
  max: number
  onChange: (next: number) => void
  /** Accessible names, localized by the caller. */
  labels: { group: string; decrease: string; increase: string }
  /** Locks the whole stepper while a quantity change is pending (handoff §Async: «stepper locked»). */
  pending?: boolean
  disabled?: boolean
  /** `commerce`: the product card's "added" counter (bottle-tint pill, 1.5px bottle ring, bottle-deep glyphs, 44-wide buttons). */
  tone?: "default" | "commerce"
  className?: string
}

/**
 * Quantity stepper (CartD): 44-tall linen pill with a 1px line-2 outline; «+» at the reading start, the value
 * (15/700, announced politely), «−» at the end. Limits come from the backend contract.
 */
export function QuantityStepper({ value, displayValue, min = 1, max, onChange, labels, pending, disabled, tone = "default", className }: QuantityStepperProps) {
  const locked = pending || disabled
  const commerce = tone === "commerce"
  const button = cn(
    "flex h-control-s items-center justify-center disabled:cursor-not-allowed disabled:text-ink-3",
    "w-11", commerce ? "text-bottle-deep" : "text-night"
  )
  return (
    <span
      role="group"
      aria-label={labels.group}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex h-control-s flex-none items-center rounded-pill",
        commerce ? "bg-bottle-tint shadow-outline-commerce" : "bg-linen shadow-outline-control",
        pending && "opacity-60",
        className
      )}
    >
      <button type="button" aria-label={labels.increase} className={button} disabled={locked || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Icon name="plus" size={16} strokeWidth={2.25} />
      </button>
      <span aria-live="polite" className="min-w-4.5 text-center text-15 font-bold text-night">
        {displayValue}
      </span>
      <button type="button" aria-label={labels.decrease} className={button} disabled={locked || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Icon name="minus" size={16} strokeWidth={2.25} />
      </button>
    </span>
  )
}
