'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { CopyId } from '@/components/workspace/copy-id'
import { label } from '@/lib/labels'
import { tripRef, type Run } from '@/lib/trip-ops'
import { cn } from '@/lib/utils'

/* Shared pieces of the three trip tabs. Quiet by default: one hairline card, text hierarchy instead of badges, tone only for exceptions. */

export function TripCardShell({ children, attention }: { children: React.ReactNode; attention?: boolean }) {
  return (
    <article
      className={cn(
        'bw-arrive rounded-bw-card border bg-bw-surface px-4 py-3.5 transition-colors',
        attention ? 'border-bw-warn/40' : 'border-bw-line hover:border-bw-line-field/60',
      )}
    >
      {children}
    </article>
  )
}

/** Courier name leads; the trip reference is a quiet copyable detail, never the heading. */
export function TripHeading({
  courier,
  run,
  sequence,
  trailing,
}: {
  courier: string
  run: Pick<Run, 'id'>
  sequence?: { n: number; of: number }
  trailing?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <h3 className="truncate text-bw-body font-semibold text-bw-ink">{courier}</h3>
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-bw-ink-subtle">
          <CopyId value={run.id} display={tripRef(run.id)} label="رقم المشوار" muted />
          {sequence && sequence.of > 1 ? <span>المشوار {sequence.n} من {sequence.of} اليوم</span> : null}
        </p>
      </div>
      {trailing ? <div className="shrink-0 text-bw-small">{trailing}</div> : null}
    </div>
  )
}

/** "4 طلبات" style inline fact. `tone` is reserved for exceptions so it stays meaningful. */
export function Fact({
  value,
  label,
  tone,
  strong,
}: {
  value: React.ReactNode
  label: string
  tone?: 'warn' | 'danger' | 'ok'
  strong?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 text-bw-small',
        tone === 'danger' ? 'text-bw-danger' : tone === 'warn' ? 'text-bw-warn' : tone === 'ok' ? 'text-bw-emerald' : 'text-bw-ink-soft',
      )}
    >
      <bdi className={cn('tabular-nums', strong ? 'text-bw-body font-semibold text-bw-ink' : 'font-semibold', tone && 'text-inherit')}>{value}</bdi>
      <span>{label}</span>
    </span>
  )
}

/** Thin outcome bar: delivered, failed, and what is left. Colour is never the only carrier (the numbers sit next to it). */
export function OutcomeBar({ delivered, failed, total }: { delivered: number; failed: number; total: number }) {
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0)
  return (
    <div
      role="progressbar"
      aria-label="نتائج التوصيل"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={delivered + failed}
      className="flex h-1 w-full overflow-hidden rounded-full bg-bw-sunken"
    >
      <div className="h-full bg-bw-emerald transition-[width] duration-200" style={{ width: `${pct(delivered)}%` }} />
      <div className="h-full bg-bw-rose transition-[width] duration-200" style={{ width: `${pct(failed)}%` }} />
    </div>
  )
}

/** Progressive disclosure for secondary detail. The button is the only thing visible until it is opened. */
export function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const id = React.useId()
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="-ms-1 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-bw-field px-1 text-bw-small font-medium text-bw-ink-soft transition-colors hover:text-bw-ink"
      >
        <ChevronDown className={cn('size-4 transition-transform duration-150', open && 'rotate-180')} aria-hidden />
        {label}
      </button>
      {open ? <div id={id} className="mt-2">{children}</div> : null}
    </div>
  )
}

/** Compact ledger row for orders inside a disclosure: copyable order number first, then place and state. */
export function OrderLine({
  orderNumber,
  fallbackId,
  area,
  meta,
  parcelId,
}: {
  orderNumber: string | null | undefined
  fallbackId?: string
  area?: string | null
  meta?: React.ReactNode
  parcelId?: string | null
}) {
  const number = orderNumber ?? fallbackId ?? null
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5 text-bw-small">
      <div className="flex min-w-0 items-center gap-2">
        <CopyId value={number} label="رقم الطلب" className="font-semibold text-bw-ink" />
        {area ? <span className="truncate text-bw-ink-soft">{area}</span> : null}
      </div>
      <div className="flex items-center gap-3 text-bw-ink-soft">
        {parcelId ? <ParcelId id={parcelId} /> : null}
        {meta}
      </div>
    </li>
  )
}

/** A parcel's id: the Arabic word stays outside the LTR run so digits never reorder in RTL. */
export function ParcelId({ id }: { id: string }) {
  return (
    <CopyId
      value={id}
      display={<>طرد <bdi className="bw-code">{id.replace(/-/g, '').slice(0, 8).toUpperCase()}</bdi></>}
      mono={false}
      label="معرّف الطرد"
      muted
      className="text-[11px]"
    />
  )
}

/** Shipment / state as plain coloured words: tone only for exceptions, no badge chrome. */
export function StateText({ map, value }: { map: Parameters<typeof label>[0]; value: string | null | undefined }) {
  const [text, tone] = label(map, value)
  return <span className={cn('text-bw-small', tone === 'danger' ? 'text-bw-danger' : tone === 'ok' ? 'text-bw-emerald' : tone === 'warn' ? 'text-bw-warn' : 'text-bw-ink-soft')}>{text}</span>
}
