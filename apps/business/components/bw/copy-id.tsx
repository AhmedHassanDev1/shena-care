'use client'

import * as React from 'react'
import Link from 'next/link'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/bw/toast'

/*
 * A displayed reference (order, trip, batch, settlement…) that can be copied without becoming visually loud.
 * The ORIGINAL value is always what lands on the clipboard, even when the shown text is shortened or truncated.
 * Pass `href` to keep the identifier a link to its details; the copy button then stays a separate control, so
 * navigation and copying never fight over the same click.
 */

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.insetBlockStart = '0'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Copies `value`, shows one «تم النسخ» toast. Returned `copied` flips on briefly for the button's check mark. */
export function useCopy() {
  const toast = useToast()
  const [copied, setCopied] = React.useState(false)
  const reset = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(reset.current), [])
  const copy = React.useCallback(async (value: string) => {
    if (await writeClipboard(value)) {
      toast.success('تم النسخ')
      setCopied(true)
      window.clearTimeout(reset.current)
      reset.current = window.setTimeout(() => setCopied(false), 1400)
    } else {
      toast.error('تعذر النسخ', { detail: 'انسخه يدويًا من الشاشة.' })
    }
  }, [toast])
  return { copy, copied }
}

export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const { copy, copied } = useCopy()
  return (
    <button
      type="button"
      aria-label={`نسخ ${label}`}
      title={`نسخ ${label}`}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); void copy(value) }}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-bw-field text-bw-ink-subtle transition-colors hover:bg-bw-sunken hover:text-bw-ink',
        copied && 'text-bw-emerald hover:text-bw-emerald',
        className,
      )}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  )
}

export function CopyId({ value, display, label = 'المعرّف', href, className, textClassName }: {
  /** The complete original identifier. */
  value: string
  /** What is shown, when it is shortened. Defaults to the value. */
  display?: string
  /** Names the thing in the button's accessible label, e.g. «رقم الطلب». */
  label?: string
  href?: string
  className?: string
  textClassName?: string
}) {
  const text = (
    <bdi className={cn('bw-code min-w-0 truncate', href && 'underline-offset-2 hover:underline', textClassName)} title={display && display !== value ? value : undefined}>
      {display ?? value}
    </bdi>
  )
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-0.5 align-middle', className)}>
      {href ? <Link href={href} className="min-w-0 truncate">{text}</Link> : text}
      <CopyButton value={value} label={label} />
    </span>
  )
}
