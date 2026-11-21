'use client'

import * as React from 'react'
import {
  Ban, Banknote, Clock, HandCoins, Landmark, Package, PackageX, Receipt, ShoppingBag, TriangleAlert, Truck, Undo2,
} from 'lucide-react'
import { StatusLabel, type Tone } from '@/components/bw/primitives'
import { cn } from '@/lib/utils'
import { monthName, presetRange, type SettlementState } from './partner-ui'

/* Plain-language pieces for the partner portal: one icon and one short phrase per thing, small charts, no jargon. */

// ───────────────────────────────────────────────────────────────────────────── what a movement is
const TYPES: Record<string, { label: string; icon: React.ElementType; tint: string }> = {
  PURCHASE: { label: 'شراء بضاعة', icon: ShoppingBag, tint: 'text-bw-cobalt' },
  DIRECT_EXPENSE: { label: 'مصروف', icon: Receipt, tint: 'text-bw-cobalt' },
  DELIVERY_COST: { label: 'توصيل', icon: Truck, tint: 'text-bw-cobalt' },
  PACKAGING_COST: { label: 'تغليف', icon: Package, tint: 'text-bw-cobalt' },
  CAPITAL_RETURN: { label: 'رجّعنا لك رأس مال', icon: Landmark, tint: 'text-bw-amber' },
  PROFIT_PAYOUT: { label: 'دفعنا لك ربح', icon: HandCoins, tint: 'text-bw-emerald' },
  SOUND_RETURN: { label: 'مرتجع سليم', icon: Undo2, tint: 'text-bw-ink-soft' },
  DAMAGED_RETURN: { label: 'مرتجع تالف', icon: PackageX, tint: 'text-bw-ink-soft' },
  DAMAGE: { label: 'تالف', icon: TriangleAlert, tint: 'text-bw-rose' },
  CANCELLED_ORDER: { label: 'طلب ملغي', icon: Ban, tint: 'text-bw-ink-soft' },
  CASH_SETTLEMENT: { label: 'كاش اتسلّم', icon: Banknote, tint: 'text-bw-emerald' },
  CASH_PENDING: { label: 'كاش لسه مع المندوب', icon: Clock, tint: 'text-bw-amber' },
}
export const typeName = (type: string) => TYPES[type]?.label ?? type

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const entry = TYPES[type]
  const Icon = entry?.icon ?? Receipt
  return <span className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-bw-sunken', entry?.tint, className)}><Icon className="size-4" aria-hidden /></span>
}

/** Four groups instead of twelve types: what most people want to filter by. */
export const GROUPS: Array<{ value: string; label: string; types: string[] }> = [
  { value: '', label: 'الكل', types: [] },
  { value: 'funded', label: 'اللي دفعته', types: ['PURCHASE', 'DIRECT_EXPENSE', 'DELIVERY_COST', 'PACKAGING_COST'] },
  { value: 'paid', label: 'اللي رجع لك', types: ['CAPITAL_RETURN', 'PROFIT_PAYOUT'] },
  { value: 'cash', label: 'الكاش', types: ['CASH_SETTLEMENT', 'CASH_PENDING'] },
  { value: 'other', label: 'مرتجع وتالف', types: ['SOUND_RETURN', 'DAMAGED_RETURN', 'DAMAGE', 'CANCELLED_ORDER'] },
]

// ───────────────────────────────────────────────────────────────────────────── statuses (short words)
const STATUS: Record<string, [string, Tone]> = {
  FUNDED: ['اتدفع', 'info'], APPROVED: ['معتمد', 'ok'], PENDING_APPROVAL: ['معلّق', 'pending'], PAID: ['مدفوع', 'ok'], VOIDED: ['ملغي', 'neutral'],
  RESTOCKED: ['رجع للمخزون', 'ok'], COUNTED_IN_COST: ['في التكلفة', 'neutral'], CONFIRMED: ['مؤكد', 'warn'], RECOVERABLE: ['بضاعة موجودة', 'info'],
  COST_MISSING: ['التكلفة ناقصة', 'pending'], SETTLED: ['اتسلّم', 'ok'], SHORT: ['فيه عجز', 'warn'], OVER: ['فيه زيادة', 'warn'], UNSETTLED: ['غير مسوّى', 'warn'], DISPUTED: ['معلّق', 'danger'],
}
export function StatusChip({ status }: { status: string }) {
  const [text, tone] = STATUS[status] ?? [status, 'neutral']
  return <StatusLabel tone={tone}>{text}</StatusLabel>
}
export const statusName = (status: string) => STATUS[status]?.[0] ?? status

const SETTLEMENT: Record<SettlementState, [string, Tone]> = {
  PENDING: ['معلّق', 'pending'], NO_PROFIT: ['مفيش ربح', 'neutral'], UNSETTLED: ['غير مسوّى', 'warn'], DUE: ['مستحق', 'info'], PARTIAL: ['مدفوع جزئيًا', 'info'], PAID: ['مدفوع', 'ok'],
}
export function SettlementChip({ state }: { state: SettlementState }) {
  const [text, tone] = SETTLEMENT[state] ?? [state, 'neutral']
  return <StatusLabel tone={tone}>{text}</StatusLabel>
}

// ───────────────────────────────────────────────────────────────────────────── period: four choices
export const PERIODS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'الشهر ده' }, { value: '3', label: 'آخر 3 شهور' }, { value: '6', label: 'آخر 6 شهور' }, { value: '12', label: 'آخر سنة' },
]
export function usePeriod(initial = '3') {
  const [value, setValue] = React.useState(initial)
  return { value, setValue, ...presetRange(value as '1' | '3' | '6' | '12') }
}
export function PeriodSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select aria-label="الفترة" value={value} onChange={(event) => onChange(event.target.value)} className="bw-control h-10 rounded-bw-field border border-bw-line-field bg-bw-surface px-3 text-bw-small">
      {PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
  )
}

// ───────────────────────────────────────────────────────────────────────────── cards
export function Kpi({ icon: Icon, label, value, tone = 'cobalt', note }: { icon: React.ElementType; label: string; value: React.ReactNode; tone?: 'cobalt' | 'emerald' | 'amber' | 'violet'; note?: string }) {
  const tint = { cobalt: 'text-bw-cobalt bg-bw-cobalt-soft', emerald: 'text-bw-emerald bg-bw-emerald-soft', amber: 'text-bw-amber bg-bw-amber-soft', violet: 'text-bw-violet bg-bw-veil-3' }[tone]
  return (
    <div className="bw-panel flex items-center gap-3 p-4">
      <span className={cn('grid size-11 shrink-0 place-items-center rounded-full', tint)}><Icon className="size-5" aria-hidden /></span>
      <div className="min-w-0">
        <p className="truncate text-bw-small text-bw-ink-soft">{label}</p>
        <p className="text-xl font-bold leading-tight tabular-nums text-bw-ink sm:text-2xl">{value}</p>
        {note ? <p className="truncate text-[11px] text-bw-ink-subtle">{note}</p> : null}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────── charts (CSS only, accessible text table)
export interface BarMonth { key: string; label: string; a: number | null; b: number }

/** Two bars per month: what the partner earned (green) and what was already paid to them (blue). A month still waiting on costs is an empty dashed bar. */
export function MonthBars({ months, aLabel, bLabel, pendingLabel }: { months: BarMonth[]; aLabel: string; bLabel: string; pendingLabel: string }) {
  const top = Math.max(...months.flatMap((m) => [m.a ?? 0, m.b]), 1)
  const H = 120
  const h = (v: number) => (v <= 0 ? 2 : Math.max(4, (v / top) * H))
  return (
    <div>
      <div role="img" aria-label={`${aLabel} و${bLabel} لكل شهر`} className="flex items-end gap-3" style={{ height: H + 26 }}>
        {months.map((m) => (
          <div key={m.key} className="flex min-w-0 flex-1 flex-col items-center" title={`${m.label}: ${m.a === null ? pendingLabel : m.a.toLocaleString('en-US')} / ${m.b.toLocaleString('en-US')}`}>
            <div className="flex w-full items-end justify-center gap-1" style={{ height: H }}>
              {m.a === null
                ? <span className="block w-1/3 max-w-6 rounded-t-sm border border-dashed border-bw-amber/70" style={{ height: 28 }} />
                : <span className="bw-meter-fill block w-1/3 max-w-6 rounded-t-sm bg-bw-emerald" style={{ height: h(m.a) }} />}
              <span className="bw-meter-fill block w-1/3 max-w-6 rounded-t-sm bg-bw-cobalt" style={{ height: h(m.b) }} />
            </div>
            <span className="mt-2 truncate text-[11px] text-bw-ink-subtle">{m.label}</span>
          </div>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-bw-ink-soft">
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-bw-emerald" />{aLabel}</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-bw-cobalt" />{bLabel}</li>
        {months.some((m) => m.a === null) ? <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm border border-dashed border-bw-amber/70" />{pendingLabel}</li> : null}
      </ul>
      <table className="sr-only"><caption>{aLabel} و{bLabel}</caption><tbody>{months.map((m) => <tr key={m.key}><th scope="row">{m.label}</th><td>{m.a === null ? pendingLabel : m.a}</td><td>{m.b}</td></tr>)}</tbody></table>
    </div>
  )
}

export interface Slice { key: string; label: string; value: number; color: string }

/** One horizontal stacked bar and its legend: where a total went. */
export function StackBar({ slices, total, label }: { slices: Slice[]; total: number; label: string }) {
  const sum = slices.reduce((s, x) => s + Math.max(0, x.value), 0)
  if (!(total > 0) || !(sum > 0)) return <p className="py-3 text-center text-bw-small text-bw-ink-subtle">مفيش أرقام تتعرض لسه</p>
  return (
    <div>
      <div role="img" aria-label={label} className="flex h-4 overflow-hidden rounded-full bg-bw-veil-3">
        {slices.filter((s) => s.value > 0).map((s) => <span key={s.key} className={cn('bw-meter-fill h-full', s.color)} style={{ width: `${(s.value / sum) * 100}%` }} />)}
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-1.5 text-bw-small sm:grid-cols-2">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-bw-ink-soft"><span aria-hidden className={cn('size-2.5 rounded-sm', s.color)} />{s.label}</span>
            <span className="tabular-nums text-bw-ink"><bdi className="bw-code">{s.value.toLocaleString('en-US')}</bdi> ج.م</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const shortMonth = (period: string) => monthName(period, 'short').replace(/\s?\d{4}$/, '')
