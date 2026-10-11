import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export type StepStatus = "complete" | "current" | "upcoming"

export interface StepItem {
  id: string
  label: React.ReactNode
  detail?: React.ReactNode
  status: StepStatus
}

export interface StepsProps extends Omit<React.OlHTMLAttributes<HTMLOListElement>, "children"> {
  items: StepItem[]
  /** Localized screen-reader prefixes, e.g. { complete: "Completed", current: "Current step", upcoming: "Upcoming" }. */
  statusLabels: Record<StepStatus, string>
  /** Formats the step number for the active locale (e.g. Arabic-Indic digits). Defaults to String(n). */
  formatIndex?: (n: number) => string
}

/**
 * Vertical sequence of real, backend-defined steps (e.g. order tracking stages).
 *
 * Only use it for a genuine sequence whose status comes from data — never as decoration and never
 * to imply a recommendation. Circles are reserved for this component. State is conveyed three ways:
 * marker shape (filled + check / ring / outline), text weight, and a screen-reader prefix.
 * The connector runs along the inline-start edge, so it mirrors automatically in RTL.
 */
function Steps({ items, statusLabels, formatIndex = String, className, ...props }: StepsProps) {
  return (
    <ol className={cn("flex flex-col", className)} {...props}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <li
            key={item.id}
            aria-current={item.status === "current" ? "step" : undefined}
            className={cn("relative flex gap-3", !isLast && "pb-6")}
          >
            {!isLast ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute bottom-0 start-[15px] top-8 w-0.5",
                  item.status === "complete" ? "bg-primary" : "bg-border"
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative flex size-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
                item.status === "complete" && "bg-primary text-primary-foreground",
                item.status === "current" && "border-2 border-primary bg-card text-primary",
                item.status === "upcoming" && "border border-input bg-card text-muted-foreground"
              )}
            >
              {item.status === "complete" ? <Check className="size-4" strokeWidth={2.5} /> : formatIndex(index + 1)}
            </span>
            <div className="min-w-0 pt-1">
              <p
                className={cn(
                  "text-support",
                  item.status === "current" ? "font-semibold text-foreground" : "font-medium",
                  item.status === "upcoming" ? "text-muted-foreground" : "text-foreground"
                )}
              >
                <span className="sr-only">{statusLabels[item.status]}: </span>
                {item.label}
              </p>
              {item.detail ? <p className="text-caption text-muted-foreground">{item.detail}</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export { Steps }
