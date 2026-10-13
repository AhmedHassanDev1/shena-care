import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The routine signature: beads on a rail, one per step (design-system "routines are sequences you own").
 * Shows only the NUMBER of steps — never invented step names. Decorative: the step count is always
 * written next to it. Takes colors from the nearest `data-atmosphere`.
 */
export function BeadRail({ count, max = 7, className }: { count: number; max?: number; className?: string }) {
  const beads = Math.min(Math.max(count, 0), max)
  if (beads === 0) return null
  return (
    <div aria-hidden="true" className={cn("flex items-center", className)}>
      {Array.from({ length: beads }, (_, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <span className="h-0.5 min-w-3 flex-1 rounded-pill bg-atm-accent/50" /> : null}
          <span
            className={cn(
              "size-3.5 shrink-0 rounded-pill border-2",
              index === 0 ? "border-primary bg-primary" : "border-atm-accent bg-card"
            )}
          />
        </React.Fragment>
      ))}
    </div>
  )
}
