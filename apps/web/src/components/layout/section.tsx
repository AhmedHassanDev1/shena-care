import * as React from "react"

import { cn } from "@/lib/utils"
import { PageContainer } from "./page-container"

export interface SectionProps {
  /** id of the section's heading (every section is a labelled landmark). */
  labelledBy: string
  /** Full-width linen band behind the section (used to separate a product shelf from the smoke-white ground). */
  band?: boolean
  /** Vertical rhythm: `default` 24/40, `tight` 16/24 (chip rows, the brand marquee). */
  rhythm?: "default" | "tight"
  className?: string
  children: React.ReactNode
}

/**
 * Page section: one labelled landmark, one container, one vertical rhythm. Pages compose Sections instead of choosing
 * their own padding, which is what keeps spacing consistent from page to page.
 */
export function Section({ labelledBy, band, rhythm = "default", className, children }: SectionProps) {
  return (
    <section aria-labelledby={labelledBy} className={band ? "bg-linen" : undefined}>
      <PageContainer className={cn("flex flex-col gap-5 lg:gap-6", rhythm === "default" ? "py-6 lg:py-10" : "py-4 lg:py-6", className)}>{children}</PageContainer>
    </section>
  )
}

export interface SectionHeaderProps {
  /** Two-digit index as Stitch numbers sections («٠١»); omit for unnumbered sections. */
  number?: string
  title: string
  titleId: string
  /** One-line lead under the title. */
  lead?: string
  /** Link or control on the end side of the title row. */
  aside?: React.ReactNode
}

/** Section heading: index + title (text-display-2), optional lead and end-side action. */
export function SectionHeader({ number, title, titleId, lead, aside }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-3">
          {number ? (
            <span aria-hidden="true" className="font-serif italic text-20 text-cobalt tabular-nums">
              {number}
            </span>
          ) : null}
          <h2 id={titleId} className="m-0 text-display-2 text-ink font-display font-bold">
            {title}
          </h2>
        </div>
        {aside}
      </div>
      {lead ? <p className="m-0 max-w-narrow text-body text-stone font-display">{lead}</p> : null}
    </div>
  )
}
