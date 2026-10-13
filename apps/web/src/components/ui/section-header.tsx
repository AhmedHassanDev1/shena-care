import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface SectionHeaderProps {
  /** Id for `aria-labelledby` on the section. */
  id?: string
  title: string
  subtitle?: string
  /** Small line above the title. */
  eyebrow?: string
  href?: string
  linkLabel?: string
  className?: string
}

/** Section title with an optional "see all" link. Title = display `title`; the link points forward (chevron mirrors with direction). */
export function SectionHeader({ id, title, subtitle, eyebrow, href, linkLabel, className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4 lg:mb-6", className)}>
      <div>
        {eyebrow ? <p className="mb-0.5 text-caption text-ink-soft">{eyebrow}</p> : null}
        <h2 id={id} className="text-title text-foreground lg:text-display-m">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-body-s text-muted-foreground">{subtitle}</p> : null}
      </div>
      {href && linkLabel ? (
        <Link
          href={href}
          className="inline-flex min-h-control-m shrink-0 items-center gap-1 rounded-pill px-1 text-label text-primary underline decoration-transparent underline-offset-4 transition-[text-decoration-color] duration-quick hover:decoration-current"
        >
          {linkLabel}
          <Icon name="chevron-forward" size={18} />
        </Link>
      ) : null}
    </div>
  )
}
