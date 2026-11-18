'use client'

import * as React from 'react'

/** The primary action of a form or the scan area: inline on desktop, pinned above the bottom navigation on a phone so the thumb always reaches it. */
export function StickyAction({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-[calc(var(--bw-bottom-nav,4.25rem)+0.5rem)] z-20 -mx-4 border-t border-bw-line bg-bw-page/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
