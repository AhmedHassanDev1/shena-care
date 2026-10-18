import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export type TimelineDot = "done" | "na" | "now" | "next" | "err" | "warn"

export interface TimelineItem {
  id: string
  label: React.ReactNode
  /** Date/time or a short explanation (13px, ink-2). */
  detail?: React.ReactNode
  dot: TimelineDot
}

const dotClass: Record<TimelineDot, string> = {
  done: "bg-night text-linen",
  na: "bg-linen shadow-outline-night",
  now: "bg-blue shadow-halo-blue",
  next: "bg-linen shadow-outline-dune",
  err: "bg-err text-white",
  warn: "bg-linen shadow-outline-warn",
}

/**
 * Tracking timeline (OrdersD, CommerceMobile ٧; handoff §Components): 22px dots — `done` night with a check, `na` night
 * ring (cash: no payment step), `now` Sahel blue with a blue-tint halo and aria-current="step", `next` dune ring with
 * ink-3 text, `err` red with ✕, `warn` amber ring. The connector is night up to the current step, dune after it.
 * The label always names the state; the dot never carries it alone.
 */
export function Timeline({ items, label, className }: { items: TimelineItem[]; label?: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn("m-0 list-none p-0", className)}>
      {items.map((item, index) => {
        const last = index === items.length - 1
        const reached = item.dot === "done" || item.dot === "na"
        return (
          <li key={item.id} aria-current={item.dot === "now" ? "step" : undefined} className={cn("relative flex gap-3.5", !last && "pb-4.5")}>
            {!last ? (
              <span aria-hidden="true" className={cn("absolute -bottom-0.5 start-2.5 top-6.5 w-0.5", reached ? "bg-night" : "bg-dune")} />
            ) : null}
            <span className="relative z-10 flex-none">
              <span aria-hidden="true" className={cn("flex size-5.5 items-center justify-center rounded-full", dotClass[item.dot])}>
                {item.dot === "done" ? <Icon name="check" size={13} strokeWidth={2.4} /> : null}
                {item.dot === "err" ? <Icon name="close" size={13} strokeWidth={2.4} /> : null}
              </span>
            </span>
            <span className={cn("flex min-w-0 flex-col gap-px", item.dot === "next" ? "text-ink-3" : "text-night")}>
              <span className={cn("text-15", item.dot === "now" ? "font-bold" : "font-semibold")}>{item.label}</span>
              {item.detail ? <span className="text-13 text-ink-2">{item.detail}</span> : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
