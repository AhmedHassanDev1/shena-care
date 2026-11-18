'use client'

import * as React from 'react'

/** The primary action of a form or the scan area: inline on desktop, pinned above the bottom navigation on a phone so the thumb always reaches it. */
/** The primary action of a form or the scan area: inline on desktop, docked directly above the bottom navigation on mobile with zero floating gap. */
export function StickyAction({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-14 z-20 border-t border-bw-line bg-bw-surface px-4 py-2.5 shadow-bw-sheen-strong lg:static lg:inset-auto lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
      <div className="mx-auto flex max-w-[84rem] items-center justify-between gap-3">{children}</div>
    </div>
  )
}
