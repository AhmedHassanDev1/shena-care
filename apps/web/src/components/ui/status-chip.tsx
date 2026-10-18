import * as React from "react"

import { cn } from "@/lib/utils"

export type StatusTone = "blue" | "ok" | "warn" | "gray" | "err" | "ink"

const tones: Record<StatusTone, string> = {
  blue: "bg-blue-tint text-blue-deep",
  ok: "bg-ok-tint text-ok",
  warn: "bg-saffron-tint text-saffron-ink",
  gray: "bg-sand text-ink-2",
  err: "bg-err-tint text-err",
  ink: "bg-night text-linen",
}

/** Status chip (OrdersD): 26 tall, 12.5/700, pill. Tone pairs the tint with its ink; the label always names the state. */
export function StatusChip({ tone, className, children }: { tone: StatusTone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6.5 items-center whitespace-nowrap rounded-pill px-2.5 text-12.5 font-bold leading-17", tones[tone], className)}>
      {children}
    </span>
  )
}

/** «تجريبي» sample tag (every commerce board): marks demo values until real data ships. */
export function SampleTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-pill bg-linen px-2 text-11 font-semibold leading-14 text-ink-2 shadow-outline-control", className)}>
      {children}
    </span>
  )
}
