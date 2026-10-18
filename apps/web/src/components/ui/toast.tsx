"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface ToastProps {
  children: React.ReactNode
  /** Optional action, e.g. «تراجع» after removing an item. */
  action?: { label: string; onClick: () => void }
  className?: string
}

/**
 * Dark toast (CommerceStates §١ item removed, AuthStates §٥ «دخلت بحسابك…»): night ground, linen text, radius 16,
 * announced politely. Placement (above the sticky action area or the nav) is the page's job.
 */
export function Toast({ children, action, className }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-3 rounded-16 bg-night px-4 py-3 text-14 leading-22 text-linen shadow-elevation-2", className)}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="min-h-control-s flex-none px-1 text-14 font-semibold text-saffron underline underline-offset-4"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
