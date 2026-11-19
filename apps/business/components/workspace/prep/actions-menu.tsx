'use client'

import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type DeskLine, productTitle } from './model'
import { type ActionKind, actionItems } from './sheets'

/** Where the popover replaces the bottom sheet: tablets and desktops. A phone keeps the sheet (bigger targets, thumb reach). */
const WIDE = '(min-width: 640px)'

function useWide() {
  const [wide, setWide] = React.useState(false)
  React.useEffect(() => {
    const query = window.matchMedia(WIDE)
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return wide
}

/**
 * The ⋯ of a product card. Desktop: a compact popover anchored to the button (arrow keys move, Home/End jump, Esc and a click outside close it
 * and focus returns to the button). Phone: asks the owner to open the bottom sheet, which lists the same actions.
 */
export function ActionsMenu({ line, canPrice, onPick, onOpenSheet }: {
  line: DeskLine; canPrice: boolean; onPick: (kind: ActionKind) => void; onOpenSheet: () => void
}) {
  const wide = useWide()
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLDivElement>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const menu = React.useRef<HTMLDivElement>(null)
  const menuId = React.useId()
  const items = actionItems(line, canPrice)

  const close = React.useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }, [])

  // The first action takes focus when the popover opens, so the keyboard can drive it at once.
  React.useEffect(() => { if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus() }, [open])
  // A resize into phone width swaps the popover for the sheet: never leave one open behind.
  React.useEffect(() => { if (!wide) setOpen(false) }, [wide])

  React.useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(true) } }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [open, close])

  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    if (!buttons.length) return
    const at = buttons.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % buttons.length
      : event.key === 'ArrowUp' ? (at - 1 + buttons.length) % buttons.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? buttons.length - 1 : -1
    if (next >= 0) { event.preventDefault(); buttons[next].focus() }
    else if (event.key === 'Tab') close(false)
  }

  return (
    <div ref={root} className="relative shrink-0">
      <button ref={trigger} type="button" aria-label={`خيارات ${productTitle(line)}`} aria-haspopup={wide ? 'menu' : 'dialog'} aria-expanded={wide ? open : undefined} aria-controls={wide && open ? menuId : undefined}
        onClick={() => { if (wide) setOpen((was) => !was); else onOpenSheet() }}
        className="grid size-bw-control place-items-center rounded-full text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink">
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {wide && open ? (
        <div ref={menu} id={menuId} role="menu" aria-label={`إجراءات ${productTitle(line)}`} onKeyDown={move}
          className="bw-glass-raised absolute end-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-bw-card p-1">
          {items.map(({ kind, label, hint, icon: Icon }) => (
            <button key={kind} type="button" role="menuitem" onClick={() => { close(false); onPick(kind) }}
              className={cn('flex w-full items-center gap-2.5 rounded-bw-field px-2.5 py-2 text-start transition-colors hover:bg-bw-sunken focus-visible:bg-bw-sunken')}>
              <Icon className="size-4 shrink-0 text-bw-ink-soft" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-bw-small font-semibold text-bw-ink">{label}</span>
                <span className="block text-[12px] leading-snug text-bw-ink-soft">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
