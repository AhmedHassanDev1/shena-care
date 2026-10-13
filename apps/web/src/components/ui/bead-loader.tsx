import * as React from "react"

import { cn } from "@/lib/utils"

export interface BeadLoaderProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Announces the wait. Omit when a surrounding element already carries `aria-busy` (e.g. a loading button). */
  label?: string
}

/**
 * Three beads rising in turn: the design system's local-wait indicator (waits under ~2s). The beads
 * take the surrounding text color, so it reads on a malachite fill, on paper and on kohl alike.
 * Page-level loads use `Skeleton` instead.
 */
export function BeadLoader({ label, className, ...props }: BeadLoaderProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex items-center gap-[5px] [&>i]:size-[7px] [&>i]:rounded-pill [&>i]:bg-current [&>i]:motion-safe:animate-bead", className)}
      {...props}
    >
      <i />
      <i className="[animation-delay:150ms]" />
      <i className="[animation-delay:300ms]" />
    </span>
  )
}
