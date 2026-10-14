"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { IconButton } from "./icon-button"

export interface QuantityStepperProps {
  value: number
  min?: number
  max: number
  onChange: (next: number) => void
  /** Accessible names, localized by the caller. */
  labels: { group: string; decrease: string; increase: string }
  disabled?: boolean
  className?: string
}

/**
 * − n + in one outlined pill. The value is announced politely; buttons disable at the bounds so the
 * shopper never sends a quantity the backend would reject. Limits come from the caller (backend contract).
 */
export function QuantityStepper({ value, min = 1, max, onChange, labels, disabled, className }: QuantityStepperProps) {
  return (
    <div
      role="group"
      aria-label={labels.group}
      // Numeric control: always "− n +" left to right, like the phone and OTP fields.
      dir="ltr"
      className={cn("inline-flex h-control-l items-center rounded-pill border-[1.5px] border-input bg-card px-1", className)}
    >
      <IconButton
        icon="minus"
        size="s"
        label={labels.decrease}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      />
      <output aria-live="polite" className="min-w-8 text-center text-label tabular-nums text-foreground">
        <bdi>{value}</bdi>
      </output>
      <IconButton
        icon="plus"
        size="s"
        label={labels.increase}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      />
    </div>
  )
}
