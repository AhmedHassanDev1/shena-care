import * as React from "react"
import Link, { type LinkProps } from "next/link"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface ArrowLinkProps extends LinkProps, Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> {
  children: React.ReactNode
}

/**
 * Text link with a forward arrow (section «عرض الكل», card «ابدأ…»): bottle green, 44 tall target, underline that draws
 * on hover or focus (.link-quiet). The arrow points at the reading end in both directions.
 */
export function ArrowLink({ className, children, ...props }: ArrowLinkProps) {
  return (
    <Link className={cn("link-quiet inline-flex min-h-control-s items-center gap-1.5 text-16 font-display font-semibold text-cobalt", className)} {...props}>
      {children}
      <Icon name="arrow-forward" size={16} strokeWidth={2} />
    </Link>
  )
}
