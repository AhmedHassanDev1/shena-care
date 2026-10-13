import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Abstract concern glyphs from the design system's ConcernCard (dots, drops, waves). Concerns are
 * shopping aids, never diagnoses, so there are no faces, skin close-ups or condition illustrations.
 * Static, repository-owned markup (same trust model as icon-paths.ts).
 */
const GLYPHS = {
  acne: '<circle cx="9" cy="10" r="2.2"/><circle cx="15.5" cy="8.5" r="1.5"/><circle cx="14" cy="15" r="2.6"/><circle cx="8" cy="16" r="1.2"/>',
  oily: '<path d="M12 4c3.2 3.9 5.4 6.9 5.4 9.6a5.4 5.4 0 0 1-10.8 0C6.6 10.9 8.8 7.9 12 4z"/><path d="M10 14.2a2.2 2.2 0 0 0 2 2" />',
  dry: '<path d="M4 8h5l2 3-2 3H4M20 8h-5l-2 3 2 3h5M11 11h2"/>',
  pigment: '<circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor"/>',
  sensitive:
    '<path d="M3.5 10c2.1-2.4 4.2-2.4 6.3 0s4.2 2.4 6.3 0 3.1-1.6 4.4-.6M3.5 15c2.1-2.4 4.2-2.4 6.3 0s4.2 2.4 6.3 0 3.1-1.6 4.4-.6"/>',
  frizz: '<path d="M6 20c0-4 3-4 3-8s-3-4-3-8M12 20c0-4 3-4 3-8s-3-4-3-8M18 20c0-4 2-4 2-8"/>',
  hairfall: '<path d="M8 3v8c0 3 2 4 2 7M13 3v6M17 3v10"/><path d="M16 18.5c.8.5 1.4 1.2 1.6 2"/>',
  /** Radiance (dullness): a four-point glint and a small companion. */
  glow: '<path d="M11 4l1.5 4.5L17 10l-4.5 1.5L11 16l-1.5-4.5L5 10l4.5-1.5z"/><path d="M18 14.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>',
  /** Flakes over the scalp line (dandruff). */
  flakes: '<path d="M4 19c2.5-3 5.3-4.5 8-4.5s5.5 1.5 8 4.5"/><path d="M8 6.5l1.2.8M15.5 5l-.6 1.3M12 9.2l1.3-.4M6.5 11.2l1.1.6M17.6 9.8l-1.2.4"/>',
} as const

export type ConcernGlyphName = keyof typeof GLYPHS

export function ConcernGlyph({ name, size = 28, className }: { name: ConcernGlyphName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      dangerouslySetInnerHTML={{ __html: GLYPHS[name] }}
    />
  )
}
