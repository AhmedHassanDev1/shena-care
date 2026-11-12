"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"
import { Spinner } from "./spinner"

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
  /** `commerce`: the product card's "added" counter (cobalt-tint pill, 1.5px cobalt ring, cobalt-deep glyphs, 44-wide buttons). */
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
    "flex h-control-s items-center justify-center disabled:cursor-not-allowed disabled:text-stone",
    "w-11", commerce ? "text-cobalt-deep" : "text-ink"
  )
  return (
    <span
      role="group"
      aria-label={labels.group}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex h-control-s flex-none items-center rounded-pill",
        commerce ? "bg-sand shadow-outline-commerce" : "bg-linen shadow-outline-control",
        pending && "opacity-60",
        className
      )}
    >
      <button type="button" aria-label={labels.increase} className={button} disabled={locked || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Icon name="plus" size={16} strokeWidth={2.25} />
      </button>
      <span aria-live="polite" className={cn("relative min-w-4.5 text-center text-16 font-display font-bold text-ink", pending && "sl-inward px-2 rounded-pill")}>
        {pending ? (
          <span className="relative z-1 flex items-center justify-center gap-1.5">
            <Spinner size="xs" tone="cobalt" />
            <span className="text-11">{displayValue}</span>
          </span>
        ) : (
          displayValue
        )}
      </span>
      <button type="button" aria-label={labels.decrease} className={button} disabled={locked || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Icon name="minus" size={16} strokeWidth={2.25} />
      </button>
    </span>
  )
}
