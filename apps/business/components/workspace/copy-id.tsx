'use client'

import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Copyable identifiers. Any id, reference or order number a person may need to paste elsewhere is rendered with <CopyId>:
 * one tap copies the COMPLETE original value (even when the visible text is shortened), the icon flips to a check, and a
 * quiet "تم النسخ" notice appears once per page through <CopyToaster /> (role="status", so it is announced, never modal).
 * It is a real <button>: Tab/Enter/Space work, and the hit area is padded for touch without making the id louder.
 */

const COPIED_EVENT = 'bw:copied'

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* fall through to the legacy path (insecure origin, denied permission) */
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.insetInlineStart = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export function CopyId({
  value,
  display,
  label = 'المعرّف',
  className,
  mono = true,
  muted = false,
}: {
  /** The complete original value that lands on the clipboard. */
  value: string | null | undefined
  /** What is shown; defaults to the value. May be shortened or prettified, the clipboard still gets `value`. */
  display?: React.ReactNode
  /** Names the thing for assistive tech: "نسخ رقم الطلب". */
  label?: string
  className?: string
  mono?: boolean
  muted?: boolean
}) {
  const [done, setDone] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  if (!value) return <span className={cn('text-bw-ink-subtle', className)}>—</span>

  const onCopy = async (event: React.MouseEvent) => {
    event.stopPropagation()
    const ok = await copyText(value)
    window.dispatchEvent(new CustomEvent(COPIED_EVENT, { detail: { ok } }))
    if (!ok) return
    setDone(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(false), 1400)
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`نسخ ${label}: ${value}`}
      title={`نسخ ${label}`}
      className={cn(
        // The padding enlarges the tap target; the negative margin keeps the visible rhythm unchanged.
        'group/copy -mx-1 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-bw-field px-1 py-1 align-middle transition-colors hover:bg-bw-veil-2 focus-visible:bg-bw-veil-2',
        muted ? 'text-bw-ink-subtle hover:text-bw-ink-soft' : 'text-inherit',
        className,
      )}
    >
      <span className={cn('min-w-0 truncate', mono && 'bw-code')} dir={mono ? 'ltr' : undefined}>{display ?? value}</span>
      {done ? (
        <Check className="size-3 shrink-0 text-bw-emerald" aria-hidden />
      ) : (
        <Copy className="size-3 shrink-0 opacity-45 transition-opacity group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100" aria-hidden />
      )}
    </button>
  )
}

/**
 * Mount once per page. Shows a short "تم النسخ" (or a failure note) at the bottom; never traps focus or blocks input.
 * The visual notice is a manual popover so it lands in the top layer, above an open dialog (a modal would otherwise hide it);
 * a separate always-present live region announces the same words to assistive technology.
 */
export function CopyToaster() {
  const [state, setState] = React.useState<'idle' | 'ok' | 'fail'>('idle')
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const popover = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const onCopied = (event: Event) => {
      const ok = (event as CustomEvent<{ ok: boolean }>).detail?.ok !== false
      setState(ok ? 'ok' : 'fail')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), ok ? 1600 : 3200)
    }
    window.addEventListener(COPIED_EVENT, onCopied)
    return () => {
      window.removeEventListener(COPIED_EVENT, onCopied)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  React.useEffect(() => {
    const el = popover.current
    if (!el || typeof el.showPopover !== 'function') return
    try {
      // Re-showing moves it to the top of the layer stack, above any dialog opened since.
      if (el.matches(':popover-open')) el.hidePopover()
      if (state !== 'idle') el.showPopover()
    } catch {
      /* the inline check icon still confirms the copy */
    }
  }, [state])

  const text = state === 'ok' ? 'تم النسخ' : state === 'fail' ? 'تعذّر النسخ — انسخه يدويًا' : ''
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">{text}</div>
      <div
        ref={popover}
        popover="manual"
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-4 top-auto m-0 flex w-full max-w-none justify-center overflow-visible border-0 bg-transparent p-0"
      >
        <span
          className={cn(
            'bw-arrive inline-flex items-center gap-1.5 rounded-full border bg-bw-surface px-3 py-1.5 text-bw-small font-semibold text-bw-ink shadow-bw-overlay',
            state === 'fail' ? 'border-bw-danger/40 text-bw-danger' : 'border-bw-line',
          )}
        >
          {state === 'ok' ? <Check className="size-3.5 text-bw-emerald" aria-hidden /> : null}
          {text}
        </span>
      </div>
    </>
  )
}
