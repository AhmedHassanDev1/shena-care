'use client'

import * as React from 'react'
import { Code, Money, Notice, StatusLabel } from '@/components/bw/primitives'
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

/** Command failure: the server's own words and code, never a fake success. */
export function CommandError({ error }: { error: ApiError | null }) {
  if (!error) return null
  return (
    <Notice tone="danger" title="العملية ماتمتش">
      {error.message}
      {error.code ? <> · <Code>{error.code}</Code></> : null}
    </Notice>
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
        className="h-bw-control w-full rounded-bw-field border-[1.5px] border-bw-line-field bg-bw-surface px-3 text-bw-body"
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
        className="w-full rounded-bw-field border-[1.5px] border-bw-line-field bg-bw-surface p-3 text-bw-body"
      />
    </div>
  )
}

export function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl space-y-5 p-4 lg:p-6">{children}</div>
}
