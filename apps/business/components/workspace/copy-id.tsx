'use client'

import * as React from 'react'
import Link from 'next/link'
import { Check, Copy } from 'lucide-react'
import { useToast } from '@/components/bw/toast'
import { cn } from '@/lib/utils'

/*
 * Copyable identifiers. Any id, reference or order number a person may need to paste elsewhere is rendered with <CopyId>:
 * one tap copies the COMPLETE original value (even when the visible text is shortened), the icon flips to a check, and the
 * single global toast (components/bw/toast) answers «تم النسخ» — replacing any toast already on screen, never stacking.
 * It is a real <button>: Tab/Enter/Space work, and the hit area is padded for touch without making the id louder.
 * With `href` the identifier stays a link to its details and the copy control is a separate button beside it.
 */

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

/** Copies `value` and answers through the global toast. `done` flips on briefly for the check mark. */
export function useCopy() {
  const toast = useToast()
  const [done, setDone] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = React.useCallback(async (value: string) => {
    if (await copyText(value)) {
      toast.success('تم النسخ')
      setDone(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setDone(false), 1400)
    } else {
      toast.error('تعذّر النسخ', { detail: 'انسخه يدويًا من الشاشة.' })
    }
  }, [toast])
  return { copy, done }
}

export function CopyId({
  value,
  display,
  label = 'المعرّف',
  className,
  textClassName,
  href,
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
  /** Extra classes for the visible text (alias of `className` for the chip form). */
  textClassName?: string
  /** Keeps the identifier a link to its details; the copy button then sits beside it. */
  href?: string
  mono?: boolean
  muted?: boolean
}) {
  const { copy, done } = useCopy()
  if (!value) return <span className={cn('text-bw-ink-subtle', className)}>—</span>

  const icon = done
    ? <Check className="size-3 shrink-0 text-bw-emerald" aria-hidden />
    : <Copy className="size-3 shrink-0 opacity-45 transition-opacity group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100" aria-hidden />
  const text = <span className={cn('min-w-0 truncate', mono && 'bw-code', textClassName)} dir={mono ? 'ltr' : undefined}>{display ?? value}</span>
  const tone = muted ? 'text-bw-ink-subtle hover:text-bw-ink-soft' : 'text-inherit'
  const onCopy = (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); void copy(value) }

  if (href) {
    return (
      <span className={cn('inline-flex min-w-0 max-w-full items-center align-middle', tone, className)}>
        <Link href={href} className="min-w-0 truncate underline-offset-2 hover:underline">{text}</Link>
        <button type="button" onClick={onCopy} aria-label={`نسخ ${label}: ${value}`} title={`نسخ ${label}`}
          className="group/copy grid size-7 shrink-0 place-items-center rounded-bw-field transition-colors hover:bg-bw-veil-2 focus-visible:bg-bw-veil-2">
          {icon}
        </button>
      </span>
    )
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
        tone,
        className,
      )}
    >
      {text}
      {icon}
    </button>
  )
}

/** Retained for pages that still mount it; copy feedback now comes from the global toast, so this renders nothing. */
export function CopyToaster() {
  return null
}
