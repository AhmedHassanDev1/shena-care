import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Small status/metadata label. Square-ish (radius-sm) by design: circles are reserved for step
 * markers. Every tone pairs a subtle surface with a ≥ 4.5:1 text color; never rely on the tone
 * alone to carry meaning — the label text must say it.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border border-transparent px-2 py-0.5 text-caption font-medium [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary-subtle text-primary",
        secondary: "bg-secondary text-secondary-foreground",
        accent: "bg-accent text-accent-foreground",
        success: "bg-success-subtle text-success",
        warning: "bg-warning-subtle text-warning",
        destructive: "bg-destructive-subtle text-destructive",
        info: "bg-info-subtle text-info",
        outline: "border-input text-foreground",
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
