import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { CountBadge } from "./count-badge"
import { Icon, type IconName } from "./icon"

/**
 * Icon-only pill. Exported as a class builder so links (cart, account) get the exact same look and hit
 * area as buttons: `<Link className={iconButtonVariants()}>`.
 */
export const iconButtonVariants = cva(
  [
    "relative inline-grid shrink-0 place-items-center rounded-pill text-foreground",
    "transition-[background-color,border-color] duration-quick ease-out",
    "disabled:cursor-not-allowed disabled:text-disabled-foreground",
  ],
  {
    variants: {
      variant: {
        plain: "hover:bg-sand disabled:hover:bg-transparent",
        outline: "border-[1.5px] border-input bg-card hover:border-foreground",
        filled: "bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-disabled",
      },
      size: {
        s: "size-control-s",
        m: "size-control-m",
      },
    },
    defaultVariants: { variant: "plain", size: "m" },
  }
)

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof iconButtonVariants> {
  icon: IconName
  /** Required: an icon alone has no name. */
  label: string
  /** Cart-style count shown on the corner; also include it in `label` for screen readers. */
  count?: number
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, variant, size, count, className, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} aria-label={label} className={cn(iconButtonVariants({ variant, size }), className)} {...props}>
      <Icon name={icon} size={size === "s" ? 20 : 24} />
      {count ? <CountBadge count={count} className="absolute end-0 top-0.5" /> : null}
    </button>
  )
)
IconButton.displayName = "IconButton"

export { IconButton }
