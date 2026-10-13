import * as React from "react"
import Link from "next/link"

import { CountBadge } from "@/components/ui/count-badge"
import { Icon, type IconName } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

export interface BottomNavItem {
  href: string
  label: string
  icon: IconName
  /** Cart-style count on the icon. */
  badge?: number
  /** Overrides the accessible name (e.g. "Cart, 3 items"); the badge itself is decorative. */
  ariaLabel?: string
}

export interface BottomNavProps {
  items: BottomNavItem[]
  /** href of the current destination. */
  activeHref?: string
  /** Accessible name of the navigation landmark. */
  label: string
  className?: string
}

/**
 * Persistent phone/tablet navigation (hidden from bp-desktop, where the site header takes over). The first
 * item sits at the reading start, so in RTL Home is on the far right. The active item gets the malachite
 * tint pill AND a heavier label, so it never relies on color alone. Pair the page with `pb-nav-safe`.
 */
export function BottomNav({ items, activeHref, label, className }: BottomNavProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "fixed inset-x-0 bottom-0 z-nav border-t border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-float lg:hidden",
        className
      )}
    >
      <ul className="mx-auto grid h-bottom-nav-h max-w-lg grid-cols-5">
        {items.map(({ href, label: itemLabel, icon, badge, ariaLabel }) => {
          const active = href === activeHref
          return (
            <li key={href} className="contents">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={ariaLabel}
                className={cn(
                  "group relative grid place-content-center justify-items-center gap-0.5 text-caption transition-colors duration-quick ease-out focus-visible:shadow-[inset_0_0_0_2px_rgb(var(--ink-rgb))]",
                  active ? "font-semibold text-primary" : "text-ink-soft hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "relative grid h-[30px] w-11 place-items-center rounded-[22px_22px_var(--radius-xs)_var(--radius-xs)] transition-colors duration-quick ease-out",
                    active && "bg-primary-subtle"
                  )}
                >
                  <Icon name={icon} />
                  {badge ? <CountBadge count={badge} className="absolute -top-0.5 end-0.5" /> : null}
                </span>
                {itemLabel}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
