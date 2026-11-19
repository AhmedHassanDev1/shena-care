'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One dialog for the whole trip desk: a centered modal from `md` up and a bottom sheet below it. Native <dialog> gives the focus
 * trap, Esc and the inert page for free. Mount it only while it is open; it opens itself on mount and reports `onClose` for Esc,
 * the backdrop and the close button alike.
 */
export function ResponsiveDialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 'md',
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: 'md' | 'lg'
}) {
  const ref = React.useRef<HTMLDialogElement>(null)
  const titleId = React.useId()

  React.useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (event.target === ref.current) ref.current?.close()
      }}
      className={cn(
        'bw-dialog border border-bw-line bg-bw-surface p-0 text-bw-ink shadow-bw-overlay',
        // Bottom sheet on phones.
        'max-md:mx-auto max-md:mb-0 max-md:mt-auto max-md:max-h-[92dvh] max-md:w-full max-md:max-w-none max-md:rounded-t-bw-card',
        // Centered modal on larger screens.
        'md:m-auto md:max-h-[90dvh] md:rounded-bw-card',
        width === 'lg' ? 'md:w-[min(40rem,calc(100%-2rem))]' : 'md:w-[min(30rem,calc(100%-2rem))]',
      )}
    >
      <div className="flex max-h-[inherit] flex-col">
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 space-y-1">
            <h2 id={titleId} className="text-bw-heading font-semibold text-bw-ink">{title}</h2>
            {subtitle ? <div className="text-bw-small text-bw-ink-soft">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={() => ref.current?.close()}
            className="-me-2 -mt-1 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-bw-ink-soft transition-colors hover:bg-bw-sunken hover:text-bw-ink"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bw-line px-5 py-3">{footer}</div> : null}
      </div>
    </dialog>
  )
}
