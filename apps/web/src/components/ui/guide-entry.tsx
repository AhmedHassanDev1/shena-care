import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

/**
 * Assistant entry point (design-system `GuideEntry`, bar variant): compact, inline, never a floating widget.
 * Suggestions are dashed ("a suggestion, not a fact") with the lens glyph, which belongs to the assistant only.
 * It is a plain link: where an assistant is not available it leads into the guided flow that exists.
 */
export function GuideEntry({
  href,
  label,
  hint,
  className,
}: {
  href: string
  label: string
  hint?: string
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-control-l items-center gap-3 rounded-md border-[1.5px] border-dashed border-guide-line bg-guide-surface px-4 py-2.5 text-guide transition-colors duration-quick ease-out hover:bg-primary-subtle",
        className
      )}
    >
      <span className="grid size-control-s shrink-0 place-items-center rounded-pill bg-card">
        <Icon name="lens" size={22} />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-label">{label}</span>
        {hint ? <span className="truncate text-body-s text-ink-soft">{hint}</span> : null}
      </span>
      <Icon name="chevron-forward" size={20} className="shrink-0" />
    </Link>
  )
}
