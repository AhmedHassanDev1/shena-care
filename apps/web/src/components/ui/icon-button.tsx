import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { CountBadge } from "./count-badge"
import { Icon, type IconName } from "./icon"

/**
 * Icon-only 44×44 target (header account, back chevron, map «استخدم موقعي»). Exported as a class builder so links get
 * the exact same look and hit area: `<Link className={iconButtonVariants()}>`.
 */
export const iconButtonVariants = cva(
  "relative inline-flex size-control-s shrink-0 items-center justify-center rounded-pill text-night transition-colors duration-fast ease-standard disabled:cursor-not-allowed disabled:text-ink-3",
  {
    variants: {
      variant: {
        plain: "hover:bg-sand/60",
        raised: "bg-linen shadow-elevation-1 hover:bg-bone",
      },
    },
    defaultVariants: { variant: "plain" },
  }
)

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof iconButtonVariants> {
  icon: IconName
  /** Required: an icon alone has no name. */
  label: string
  iconSize?: number
  /** Count on the corner, already formatted; include it in `label` too. */
  count?: string
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, variant, iconSize = 22, count, className, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} aria-label={label} className={cn(iconButtonVariants({ variant }), className)} {...props}>
      <Icon name={icon} size={iconSize} />
      {count ? <CountBadge className="absolute end-0.5 top-0.5">{count}</CountBadge> : null}
    </button>
  )
)
IconButton.displayName = "IconButton"

export { IconButton }
