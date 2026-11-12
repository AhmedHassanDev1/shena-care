'use client'

import * as React from 'react'
import { MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MenuAction {
  label: string
  icon?: React.ElementType
  onSelect: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

/**
 * Small contextual menu. The trigger is always visible (never hover-only), opens with click, Enter or Space, closes on
 * Escape or an outside click, and every item is a real button, so it works with a keyboard and on a phone.
 */
export function RowMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-9 place-items-center rounded-bw-field text-bw-ink-soft transition-colors hover:bg-bw-sunken hover:text-bw-ink"
      >
        <MoreVertical className="size-4" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute end-0 top-full z-30 mt-1 min-w-48 overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface p-1 shadow-bw-overlay">
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false)
                  action.onSelect()
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-bw-field px-3 py-2 text-start text-bw-small transition-colors hover:bg-bw-sunken disabled:cursor-not-allowed disabled:opacity-50',
                  action.tone === 'danger' ? 'text-bw-rose' : 'text-bw-ink',
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0 text-bw-ink-soft" aria-hidden /> : null}
                {action.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** Dot + words: status is never colour alone. */
export function Dot({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted'; children: React.ReactNode }) {
  const color = {
    ok: 'bg-bw-emerald',
    warn: 'bg-bw-amber',
    danger: 'bg-bw-rose',
    info: 'bg-bw-cobalt',
    muted: 'bg-bw-ink-subtle',
  }[tone]
  return (
    <span className="inline-flex items-center gap-2 text-bw-small text-bw-ink">
      <span className={cn('size-2 shrink-0 rounded-full', color)} aria-hidden />
      {children}
    </span>
  )
}

/** Thin progress bar with a visible number next to it; used for per-request coverage. */
export function MiniBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2" role="img" aria-label={label}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bw-sunken">
        <div className="h-full rounded-full bg-bw-cobalt" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}
