import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Small status/metadata label. Rectangular (radius-xs) by design: pills are for things you press. Every
 * tone pairs a soft surface with a ≥ 4.5:1 text color; the label text must say what the tone means.
 *
 * `offer` is the only henna fill (discount stamp); `guide` is dashed because it is an assistant suggestion.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-xs px-2 py-0.5 text-caption [&_svg]:size-icon-s [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "bg-sand text-foreground",
        default: "bg-primary-subtle text-guide",
        secondary: "bg-sand text-foreground",
        accent: "bg-attention-soft text-attention-ink",
        success: "bg-success-subtle text-guide",
        warning: "bg-attention-soft text-attention-ink",
        destructive: "bg-destructive-subtle text-destructive",
        info: "bg-sand text-foreground",
        offer: "bg-henna font-semibold text-on-henna",
        new: "bg-foreground text-card",
        guide: "bg-guide-surface text-guide outline-dashed outline-[1.5px] -outline-offset-[1.5px] outline-guide-line",
        outline: "border border-input text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
