import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The brand, set in type (Alexandria Bold + a malachite dot + the Latin name). The working name is not
 * final, so render it ONLY through this component. There is no drawn logo yet; do not create one.
 */
const wordmarkVariants = cva("inline-flex items-baseline gap-2 whitespace-nowrap font-display text-foreground", {
  variants: {
    size: {
      s: "[&>[data-ar]]:text-[22px] [&>[data-ar]]:leading-7",
      m: "[&>[data-ar]]:text-[26px] [&>[data-ar]]:leading-8 [&>[data-lat]]:text-[12px]",
      l: "[&>[data-ar]]:text-[40px] [&>[data-ar]]:leading-[48px] [&>[data-lat]]:text-[15px]",
    },
    onKohl: {
      true: "text-on-kohl [&>[data-lat]]:text-on-kohl [&>[data-ar]]:after:bg-malachite-on-kohl",
      false: "",
    },
  },
  defaultVariants: { size: "m", onKohl: false },
})

export interface WordmarkProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    Omit<VariantProps<typeof wordmarkVariants>, "onKohl"> {
  name?: string
  latin?: string
  /** Evening (kohl) surfaces. */
  onKohl?: boolean
}

export function Wordmark({ name = "شينا كير", latin = "ShinaCare", size = "m", onKohl = false, className, ...props }: WordmarkProps) {
  return (
    <span role="img" aria-label={`${latin} ${name}`} className={cn(wordmarkVariants({ size, onKohl }), className)} {...props}>
      <span
        data-ar
        className="font-bold after:ms-[0.12em] after:inline-block after:size-[0.32em] after:rounded-pill after:bg-primary after:align-[0.05em] after:content-['']"
      >
        {name}
      </span>
      {latin && size !== "s" ? (
        <span data-lat lang="en" dir="ltr" className="font-text font-medium tracking-[0.04em] text-ink-soft">
          {latin}
        </span>
      ) : null}
    </span>
  )
}
