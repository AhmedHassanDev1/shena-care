"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface ToastProps {
  children: React.ReactNode
  /** Optional secondary subtitle text */
  subtitle?: React.ReactNode
  /** Optional action button */
  action?: { label: string; onClick: () => void }
  className?: string
}

/**
 * Sahel Toast: ink ground, chalk text, pill radius (rounded-pill), shadow-e3, citron check circle.
 */
export function Toast({ children, subtitle, action, className }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-3.5 rounded-pill bg-ink p-2.5 pe-4 text-chalk shadow-e3 font-display", className)}
    >
      <span aria-hidden="true" className="flex size-10.5 flex-none items-center justify-center rounded-full bg-citron text-ink">
        <Icon name="check" size={20} strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-16 font-semibold leading-tight">{children}</div>
        {subtitle ? <div className="text-13 text-chalk/75 leading-tight mt-0.5">{subtitle}</div> : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="h-control-m px-4 rounded-pill bg-linen text-ink text-15 font-semibold transition-transform hover:scale-105 active:scale-95"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
