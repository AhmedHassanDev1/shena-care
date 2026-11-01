import * as React from "react"
import Link, { type LinkProps } from "next/link"

import { cn } from "@/lib/utils"
import { Icon, type IconName } from "./icon"

export interface ChipLinkProps extends LinkProps, Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> {
  icon?: IconName
  children: React.ReactNode
}

/**
 * Navigation chip (shop by concern): a link that looks like the filter pill, 48 tall, with an optional leading icon in
 * cobalt. Hover lifts 1px, darkens the outline and nudges the icon; the focus ring comes from the global
 * :focus-visible style. For toggle filters use `Chip` instead.
 */
export function ChipLink({ icon, className, children, ...props }: ChipLinkProps) {
  return (
    <Link
      className={cn(
        "group inline-flex h-12 flex-none items-center gap-2.5 whitespace-nowrap rounded-pill bg-linen ps-4 pe-5 text-16 font-display font-semibold leading-none text-ink no-underline shadow-outline-control",
        "transition-[transform,box-shadow,background-color] duration-base ease-standard hover:-translate-y-px hover:bg-chalk hover:shadow-elevation-1",
        className
      )}
      {...props}
    >
      {icon ? <Icon name={icon} size={18} className="text-cobalt transition-transform duration-base ease-standard group-hover:scale-110" /> : null}
      <span>{children}</span>
    </Link>
  )
}
