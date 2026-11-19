'use client'

import * as React from 'react'
import { XCircle } from 'lucide-react'
import { Code, Money, StatusLabel } from '@/components/bw/primitives'
import { useToast } from '@/components/bw/toast'
import type { ApiError } from '@/lib/api'
import { label } from '@/lib/labels'
import { cn } from '@/lib/utils'

/** Status from an API enum, always icon + words. */
export function Status({ map, value }: { map: Parameters<typeof label>[0]; value: string | null | undefined }) {
  const [text, tone] = label(map, value)
  return <StatusLabel tone={tone}>{text}</StatusLabel>
}

/** EGP amount from a number or the API's decimal string; '—' when absent. */
export function Egp({ value, className }: { value: number | string | null | undefined; className?: string }) {
  if (value === null || value === undefined || value === '') return <span className={className}>—</span>
  return <Money value={Number(value)} className={className} />
}

export function KeyValues({ rows, className }: { rows: Array<[string, React.ReactNode]>; className?: string }) {
  return (
    <dl className={cn('grid gap-x-4 gap-y-2 text-bw-small sm:grid-cols-[minmax(8rem,auto)_1fr]', className)}>
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-bw-ink-soft">{k}</dt>
          <dd className="min-w-0 font-medium text-bw-ink">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

/**
 * Command failure: the server's own words and code, never a fake success. A failed action is announced once as a toast
 * (so it is heard and can be retried) and stays as one slim line beside the control that failed, so the reason is still
 * there after the toast is gone. No banner, so nothing around it is pushed down.
 */
export function CommandError({ error }: { error: ApiError | null }) {
  const toast = useToast()
  React.useEffect(() => {
    if (error) toast.error('العملية ماتمتش', { detail: error.message })
    // Announces each distinct failure once; the toast API object is stable.
  }, [error, toast])
  if (!error) return null
  return (
    <p className="flex items-start gap-1.5 text-bw-small text-bw-danger">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        {error.message}
        {error.code ? <> · <Code className="text-bw-ink-subtle">{error.code}</Code></> : null}
      </span>
    </p>
  )
}

export function Select({
  label: text,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
  className?: string
}) {
  const id = React.useId()
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="block text-bw-small font-semibold">{text}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bw-control h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface px-3 text-bw-body"
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
    </div>
  )
}

export function TextArea({ label: text, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  const id = React.useId()
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-bw-small font-semibold">{text}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface p-3 text-bw-body"
      />
    </div>
  )
}

export function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:px-6 lg:px-8 lg:py-6">{children}</div>
}
