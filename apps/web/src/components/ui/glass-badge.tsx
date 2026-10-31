import * as React from "react"

import { cn } from "@/lib/utils"

export interface GlassBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** `photo` frosted glass for use over photography or night fields; `quiet` hairline on bone; `accent` bottle tint. */
  tone?: "photo" | "quiet" | "accent"
  /** Leading status dot in the given token colour class (e.g. "bg-citron"). */
  dot?: string
}

const tones = {
  photo: "bg-chalk/35 text-ink shadow-outline-hairline backdrop-blur-md",
  quiet: "bg-linen text-stone shadow-outline-hairline",
  accent: "bg-citron text-ink shadow-e1",
} as const

/**
 * Small pill label (the only badge style): 28 tall, 12/600. The glass tone is the storefront's restrained glassmorphism;
 * use it only on top of a photograph or a night panel so the blur has something to blur.
 */
export function GlassBadge({ tone = "quiet", dot, className, children, ...props }: GlassBadgeProps) {
  return (
    <span className={cn("inline-flex h-7 items-center gap-2 rounded-pill px-3.5 text-12 font-semibold leading-16", tones[tone], className)} {...props}>
      {dot ? <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)} /> : null}
      {children}
    </span>
  )
}
