import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Henna count dot (cart count). Henna is the offers/cart color — never errors. Decorative: the owning
 * control puts the number in its accessible name (e.g. "Cart, 3 items"). Renders nothing for 0.
 */
export function CountBadge({
  count,
  max = 99,
  className,
}: {
  count: number
  max?: number
  className?: string
}) {
  if (!count || count < 1) return null
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-[18px] min-w-[18px] place-items-center rounded-pill bg-henna px-1 text-caption font-medium leading-none tabular-nums text-on-henna ring-2 ring-background",
        className
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  )
}
