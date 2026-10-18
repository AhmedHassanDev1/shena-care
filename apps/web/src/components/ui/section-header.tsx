import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

export interface SectionHeaderProps {
  /** Id for `aria-labelledby` on the section. */
  id?: string
  title: React.ReactNode
  /** Small line above the title (12/17, 600, ink-2): «مختارات الموسم». */
  eyebrow?: React.ReactNode
  /** Line under the title (15/27, ink-2). */
  description?: React.ReactNode
  /** Underlined text link at the reading end: «شوف الكل», «كل الماركات». */
  link?: { href: string; label: string }
  /** Controls beside the link (e.g. Home filter pills). */
  aside?: React.ReactNode
  className?: string
}

/** Section title (Main / Mobile): eyebrow, Beiruti display-2 title, optional description, link at the end. */
export function SectionHeader({ id, title, eyebrow, description, link, aside, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <p className="m-0 text-12 font-semibold leading-17 text-ink-2">{eyebrow}</p> : null}
        <h2 id={id} className="m-0 text-display-2 text-night">
          {title}
        </h2>
        {description ? <p className="m-0 text-15 leading-27 text-ink-2">{description}</p> : null}
      </div>
      {aside || link ? (
        <div className="flex flex-wrap items-center gap-2 lg:gap-6">
          {aside}
          {link ? (
            <Link href={link.href} className="text-link">
              {link.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
