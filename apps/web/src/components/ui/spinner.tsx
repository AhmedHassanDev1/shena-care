"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type SpinnerSize = "xs" | "s" | "m" | "l"
export type SpinnerTone = "current" | "cobalt" | "citron" | "stone" | "chalk"

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: SpinnerSize
  tone?: SpinnerTone
  className?: string
}

const sizeClasses: Record<SpinnerSize, string> = {
  xs: "size-3.5",
  s: "size-4",
  m: "size-5",
  l: "size-6",
}

const toneClasses: Record<SpinnerTone, string> = {
  current: "text-current",
  cobalt: "text-cobalt",
  citron: "text-citron",
  stone: "text-stone",
  chalk: "text-chalk",
}

/**
 * Sahel luxury editorial beauty Spinner.
 * Features:
 * - Fluid 360-degree rotation matching the luxury aesthetic.
 * - Gentle 20% opacity guide track with a high-contrast sweeping arc.
 * - WCAG / Token compliant: uses logical currentColor and semantic design tokens.
 * - Motion-safe: gracefully handles `prefers-reduced-motion`.
 */
export function Spinner({
  size = "s",
  tone = "current",
  className,
  ...props
}: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      className={cn(
        "shrink-0 animate-spin motion-reduce:animate-none",
        sizeClasses[size],
        toneClasses[tone],
        className
      )}
      {...props}
    >
      <circle cx="12" cy="12" r="9" strokeWidth="2.5" opacity="0.2" />
      <path d="M12 3a9 9 0 0 1 9 9" strokeWidth="2.5" />
    </svg>
  )
}
