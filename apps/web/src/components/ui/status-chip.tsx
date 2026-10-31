import * as React from "react"

import { cn } from "@/lib/utils"

export type StatusTone = "bottle" | "ok" | "warn" | "gray" | "err" | "ink" | "cobalt"

const tones: Record<StatusTone, string> = {
  bottle: "bg-sand text-cobalt-deep",
  cobalt: "bg-sand text-cobalt-deep",
  ok: "bg-ok-tint text-ok",
  warn: "bg-dusk text-stone",
  gray: "bg-sand text-stone",
  err: "bg-conflict text-tomato-ink",
  ink: "bg-ink text-chalk",
}

/** Status chip: 26 tall, 12.5/700, pill. Tone pairs the tint with its ink; the label always names the state. */
export function StatusChip({ tone, className, children }: { tone: StatusTone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6.5 items-center whitespace-nowrap rounded-pill px-2.5 text-12.5 font-display font-bold leading-none", tones[tone], className)}>
      {children}
    </span>
  )
}

/** «تجريبي» sample tag: marks demo values until real data ships. */
export function SampleTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-pill bg-linen px-2 text-11 font-display font-semibold leading-none text-stone shadow-outline-control", className)}>
      {children}
    </span>
  )
}
