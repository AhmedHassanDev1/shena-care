'use client'

import * as React from 'react'
import { Check, Loader2, Minus, MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import { egp } from '@/components/workspace/buy-costs'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { type Desk, type DeskLine, type DeskOrder, productMeta, productTitle } from './model'
import { Thumb } from './product'

const SAVE_DELAY_MS = 800
const PERCENT = /^\d{1,2}(\.\d{1,2})?$/
const MONEY = /^\d+(\.\d{1,2})?$/
/** "12.50" → "12.5", "0.00" → "0": how the percentage is typed back to the operator. */
const trimPercent = (value: string | null | undefined) => (value == null ? '' : String(Number(value)))

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'invalid'; text: string } | { kind: 'error'; text: string }

/**
 * The supplier discount of one line, as a percentage of the supplier's list price. Prefilled from the recorded purchase, saved on its own
 * shortly after typing stops (or on leaving the field) with visible saving / saved / error states; a failed save keeps what was typed and
 * offers a retry. The price arithmetic is the server's: this only shows the figures it returns.
 */
function DiscountField({ line, suggestedList, hubId, orderId, onOrder }: {
  line: DeskLine; suggestedList: string | null; hubId: string; orderId: string; onOrder: (order: DeskOrder) => void
}) {
  const cost = line.cost
  const serverPercent = trimPercent(cost?.discountPercent)
  const [percent, setPercent] = React.useState(serverPercent)
  const [list, setList] = React.useState(cost?.recorded ? '' : suggestedList ? String(Number(suggestedList)) : '')
  const [state, setState] = React.useState<SaveState>({ kind: 'idle' })
  const dirty = React.useRef(false)
  const timer = React.useRef<number | null>(null)
  const seq = React.useRef(0)
  const latest = React.useRef({ percent, list })
  latest.current = { percent, list }
  const id = React.useId()

  // A poll or another save refreshes the server value; it never overwrites what the operator is typing.
  React.useEffect(() => { if (!dirty.current) setPercent(serverPercent) }, [serverPercent])
  React.useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const save = React.useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    const { percent: p, list: l } = latest.current
    if (!PERCENT.test(p) || Number(p) > 99.99) { setState({ kind: 'invalid', text: 'اكتب نسبة من 0 لـ 99.99' }); return }
    if (!cost?.recorded && !MONEY.test(l)) { setState({ kind: 'invalid', text: 'اكتب سعر القائمة (ج.م) الأول' }); return }
    const mine = ++seq.current
    setState({ kind: 'saving' })
    try {
      const result = await api<{ order: DeskOrder | null }>(`/fulfillment/locations/${hubId}/desk/orders/${orderId}/lines/${line.orderItemId}/discount`, {
        method: 'PUT', body: { discountPercent: Number(p), ...(cost?.recorded ? {} : { listUnitPrice: Number(l) }) },
      })
      if (mine !== seq.current) return
      if (latest.current.percent === p) dirty.current = false
      if (result.order) onOrder(result.order)
      setState({ kind: 'saved' })
    } catch (error) {
      if (mine !== seq.current) return
      setState({ kind: 'error', text: (error as Error).message || 'ماتحفظش' })
    }
  }, [cost?.recorded, hubId, orderId, line.orderItemId, onOrder])

  const touch = (nextPercent: string, nextList: string) => {
    dirty.current = true
    latest.current = { percent: nextPercent, list: nextList }
    setState({ kind: 'idle' })
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void save() }, SAVE_DELAY_MS)
  }

  if (!cost) {
    return <p className="rounded-bw-field bg-bw-sunken/60 px-3 py-2 text-[12px] text-bw-ink-soft">خصم المورّد بيتسجّل بعد ما المنتج يتسجّل «اتشترت».</p>
  }
  const base = cost.recorded && cost.listUnitPrice ? Number(cost.listUnitPrice) : null
  return (
    <div className="space-y-2 rounded-bw-field bg-bw-sunken/60 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-p`} className="text-bw-small font-semibold text-bw-ink">خصم المورّد</label>
          <div className="flex items-center gap-1">
            <input id={`${id}-p`} dir="ltr" inputMode="decimal" autoComplete="off" value={percent} aria-invalid={state.kind === 'invalid' || undefined}
              onChange={(event) => { const next = event.target.value.replace(/[^\d.]/g, ''); setPercent(next); touch(next, latest.current.list) }}
              onBlur={() => { if (dirty.current) void save() }}
              className={cn('bw-control h-bw-touch w-20 rounded-bw-field border bg-bw-surface px-2 text-center text-bw-body tabular-nums text-bw-ink', state.kind === 'invalid' || state.kind === 'error' ? 'border-bw-danger' : 'border-bw-line-field')} />
            <span aria-hidden className="text-bw-body font-semibold text-bw-ink-soft">%</span>
          </div>
        </div>
        {!cost.recorded ? (
          <div className="flex items-center gap-2">
            <label htmlFor={`${id}-l`} className="text-bw-small text-bw-ink-soft">سعر القائمة · ج.م</label>
            <input id={`${id}-l`} dir="ltr" inputMode="decimal" autoComplete="off" value={list}
              onChange={(event) => { const next = event.target.value.replace(/[^\d.]/g, ''); setList(next); touch(latest.current.percent, next) }}
              onBlur={() => { if (dirty.current) void save() }}
              className="bw-control h-bw-touch w-24 rounded-bw-field border border-bw-line-field bg-bw-surface px-2 text-center text-bw-body tabular-nums text-bw-ink" />
          </div>
        ) : null}
      </div>
      <p className="text-[12px] text-bw-ink-soft" aria-live="polite">
        {base !== null
          ? <>سعر القائمة <bdi className="tabular-nums text-bw-ink">{egp(base)}</bdi>{cost.finalUnitCost ? <> · بعد الخصم <bdi className="tabular-nums font-semibold text-bw-ink">{egp(Number(cost.finalUnitCost))}</bdi> للقطعة</> : null}</>
          : 'التكلفة لسه ماتسجّلتش. اكتب سعر القائمة والنسبة وهتتحفظ لوحدها.'}
      </p>
      <SaveStatus state={state} onRetry={() => { void save() }} />
    </div>
  )
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === 'idle') return <p className="sr-only" aria-live="polite" />
  if (state.kind === 'saving') return <p role="status" className="flex items-center gap-1.5 text-[12px] text-bw-ink-soft"><Loader2 className="size-3.5 animate-spin" aria-hidden />بيتحفظ…</p>
  if (state.kind === 'saved') return <p role="status" className="flex items-center gap-1.5 text-[12px] font-semibold text-bw-emerald"><Check className="size-3.5" aria-hidden />اتحفظ</p>
  if (state.kind === 'invalid') return <p role="alert" className="text-[12px] text-bw-danger">{state.text}</p>
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12px] text-bw-danger">
      ماتحفظش: <bdi>{state.text}</bdi>
      <button type="button" onClick={onRetry} className="inline-flex min-h-9 items-center gap-1 font-semibold underline underline-offset-4"><RefreshCw className="size-3.5" aria-hidden />حاول تاني</button>
    </p>
  )
}

/** One product of the order: what it is, how many are prepared (− / +), the supplier discount, and the rare actions behind ⋯. */
export function ProductCard({ line, order, hubId, lastCosts, plus, minus, busy, onPlus, onMinus, onOrder, onMore }: {
  line: DeskLine; order: DeskOrder; hubId: string; lastCosts: Desk['lastCosts']
  /** `null` = allowed; a string = why the control is off (shown as its tooltip). */
  plus: string | null; minus: string | null; busy: boolean
  onPlus: () => void; onMinus: () => void; onOrder: (order: DeskOrder) => void; onMore: () => void
}) {
  const done = line.received >= line.required
  return (
    <li className={cn('space-y-3 rounded-bw-card border p-3', done ? 'border-bw-emerald/40 bg-bw-emerald-soft/30' : 'border-bw-line bg-bw-surface')}>
      <div className="flex items-start gap-3">
        <Thumb line={line} />
        <div className="min-w-0 flex-1">
          <p className="text-bw-body font-semibold text-bw-ink"><bdi>{productTitle(line)}</bdi></p>
          <p className="text-bw-small text-bw-ink-soft"><bdi>{productMeta(line) || 'بدون بيانات إضافية'}</bdi></p>
          {!line.barcode ? <p className="mt-0.5 text-[12px] text-bw-amber">من غير باركود متسجّل</p> : null}
        </div>
        <button type="button" onClick={onMore} aria-label={`خيارات ${productTitle(line)}`} aria-haspopup="dialog"
          className="grid size-bw-touch shrink-0 place-items-center rounded-full text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink">
          <MoreHorizontal className="size-5" aria-hidden />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-bw-small text-bw-ink-soft">مطلوب <strong className="tabular-nums text-bw-ink" dir="ltr">{line.required}</strong></p>
        <div role="group" aria-label={`الكمية المجهزة من ${productTitle(line)}`} className="flex items-center gap-1">
          <button type="button" disabled={!!minus || busy} title={minus ?? undefined} aria-label="نقّص قطعة" onClick={onMinus}
            className="grid size-bw-touch place-items-center rounded-full border border-bw-line bg-bw-surface text-bw-ink hover:bg-bw-sunken disabled:cursor-not-allowed disabled:text-bw-ink-subtle disabled:opacity-60">
            <Minus className="size-5" aria-hidden />
          </button>
          <span className="min-w-14 text-center text-bw-heading font-semibold tabular-nums text-bw-ink" dir="ltr" aria-live="polite" aria-label={`${line.received} من ${line.required}`}>{line.received}<span className="text-bw-ink-subtle">/{line.required}</span></span>
          <button type="button" disabled={!!plus || busy} title={plus ?? undefined} aria-label="زوّد قطعة" onClick={onPlus}
            className="grid size-bw-touch place-items-center rounded-full bg-bw-action text-bw-on-action hover:bg-bw-action-hover disabled:cursor-not-allowed disabled:bg-bw-sunken disabled:text-bw-ink-subtle">
            <Plus className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      {plus && !done ? <p className="text-[12px] text-bw-ink-subtle">{plus}</p> : null}

      <DiscountField line={line} suggestedList={lastCosts[line.skuId]?.listUnitPrice ?? null} hubId={hubId} orderId={order.orderId} onOrder={onOrder} />
    </li>
  )
}
