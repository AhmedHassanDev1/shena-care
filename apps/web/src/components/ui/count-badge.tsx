import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Cart count (CartD header: saffron pill, night 12/700 digits, min 22×22). Decorative: the owning link puts the
 * number in its accessible name. Pass the count already formatted for the locale; render nothing for an empty cart.
 */
export function CountBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-pill bg-saffron px-1.5 text-12 font-bold leading-17 text-night", className)}
    >
      {children}
    </span>
  )
}
