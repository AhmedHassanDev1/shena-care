import * as React from "react"

import { cn } from "@/lib/utils"

export interface WordmarkProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** `header` 34/36 desktop and 28/30 mobile (Main, PLPMobile); `footer` 34/36 on night. */
  size?: "header" | "footer"
  /** Show the Latin «SHINACARE» brand caps beside the Arabic (desktop header only). */
  withLatin?: boolean
}

/**
 * The brand, set in type — there is no logo file (README §Assets): «شينا كير» in Beiruti 900, optionally followed by
 * «SHINACARE» in tracked Latin caps (11/13, 600, 0.12em, ink-2). Render the brand ONLY through this component.
 */
export function Wordmark({ size = "header", withLatin = false, className, ...props }: WordmarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 whitespace-nowrap", className)} {...props}>
      <span className={cn("font-display font-bold", size === "header" ? "text-28 leading-30 lg:text-34 lg:leading-36" : "text-34 leading-36")}>شينا كير</span>
      {withLatin ? (
        <span lang="en" dir="ltr" className="text-brand text-ink-2">
          SHINACARE
        </span>
      ) : null}
    </span>
  )
}
