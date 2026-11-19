'use client'

import * as React from 'react'
import { Check, Loader2, Minus, Plus, RefreshCw } from 'lucide-react'
import { Tag } from '@/components/bw/product-card'
import { egp } from '@/components/workspace/buy-costs'
import { api } from '@/lib/api'
import { categoryLabel, purchaseLineName, textureLabel } from '@/lib/purchase-batch'
import { cn } from '@/lib/utils'
import { ActionsMenu } from './actions-menu'
import { type Desk, type DeskLine, type DeskOrder, productTitle } from './model'
import { Thumb } from './product'
import type { ActionKind } from './sheets'

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
    return <p className="text-[12px] text-bw-ink-soft">خصم المورّد بيتسجّل بعد «اتشترت».</p>
  }
  // The supplier's list price is not shown as text. It is typed only when the server has none to start from (a first purchase record);
  // otherwise the recorded / suggested one is used as it is.
  const showListInput = !cost.recorded && !MONEY.test(list)
  const field = 'bw-control h-9 rounded-bw-field border bg-bw-surface px-2 text-center text-bw-small tabular-nums text-bw-ink'
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor={`${id}-p`} className="text-[12px] text-bw-ink-soft">خصم المورّد</label>
        <input id={`${id}-p`} dir="ltr" inputMode="decimal" autoComplete="off" value={percent} aria-invalid={state.kind === 'invalid' || undefined}
          onChange={(event) => { const next = event.target.value.replace(/[^\d.]/g, ''); setPercent(next); touch(next, latest.current.list) }}
          onBlur={() => { if (dirty.current) void save() }}
          className={cn(field, 'w-14', state.kind === 'invalid' || state.kind === 'error' ? 'border-bw-danger' : 'border-bw-line-field')} />
        <span aria-hidden className="text-[12px] text-bw-ink-soft">%</span>
      </div>
      {showListInput ? (
        <div className="flex items-center gap-1.5">
          <label htmlFor={`${id}-l`} className="text-[12px] text-bw-ink-soft">سعر القائمة · ج.م</label>
          <input id={`${id}-l`} dir="ltr" inputMode="decimal" autoComplete="off" value={list}
            onChange={(event) => { const next = event.target.value.replace(/[^\d.]/g, ''); setList(next); touch(latest.current.percent, next) }}
            onBlur={() => { if (dirty.current) void save() }}
            className={cn(field, 'w-20 border-bw-line-field')} />
        </div>
      ) : null}
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


const squash = (text: string) => text.toLowerCase().replace(/\s+/g, '')

/**
 * One product of the order, in the same structure as the purchases lists.
 * Top row: photo · brand + name (one line) with its tags (category, texture, size) · selling price (text only) · ⋯.
 * Bottom row, under a hairline: required · supplier discount · − prepared/required +.
 * The rare actions live behind ⋯ (a popover on desktop, a bottom sheet on a phone).
 */
export function ProductCard({ line, order, hubId, lastCosts, canPrice, plus, minus, busy, onPlus, onMinus, onOrder, onPick, onMore }: {
  line: DeskLine; order: DeskOrder; hubId: string; lastCosts: Desk['lastCosts']; canPrice: boolean
  /** `null` = allowed; a string = why the control is off (shown as its tooltip). */
  plus: string | null; minus: string | null; busy: boolean
  onPlus: () => void; onMinus: () => void; onOrder: (order: DeskOrder) => void
  /** An action chosen from the popover (desktop). */
  onPick: (kind: ActionKind) => void
  /** Open the bottom sheet with the same actions (phone). */
  onMore: () => void
}) {
  const done = line.received >= line.required
  // The desk sends the size as printed ("200 ml"); it is a tag only when the name does not already say it.
  const name = purchaseLineName({ productName: line.productName, brandName: line.brandName, variantName: line.variantName, size: null, sizeUnit: null, packCount: null })
  const full = [name.brand, name.name].filter(Boolean).join(' ') || productTitle(line)
  const category = categoryLabel(line.categoryName)
  const texture = textureLabel(line.texture)
  const size = line.size && !squash(full).includes(squash(line.size)) ? line.size : ''
  const step = 'grid size-bw-control shrink-0 place-items-center rounded-full disabled:cursor-not-allowed'
  return (
    <li className={cn('space-y-2 rounded-bw-card border p-3', done ? 'border-bw-emerald/40 bg-bw-emerald-soft/25' : 'border-bw-line bg-bw-surface')}>
      <div className="flex items-center gap-3">
        <Thumb line={line} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="line-clamp-2 min-w-0 text-bw-body leading-5 text-bw-ink sm:line-clamp-1" title={full}>
              <bdi>{name.brand ? <strong className="font-bold">{name.brand} </strong> : null}<span className="font-medium">{name.name || productTitle(line)}</span></bdi>
            </p>
            {line.unitPrice != null ? (
              <p className="shrink-0 text-bw-body font-semibold leading-5 tabular-nums text-bw-emerald"><span className="sr-only">سعر البيع </span><bdi>{egp(line.unitPrice)}</bdi></p>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {category ? <Tag tone="cobalt"><bdi>{category}</bdi></Tag> : null}
            {texture ? <Tag tone="violet"><bdi>{texture}</bdi></Tag> : null}
            {size ? <Tag tone="amber"><bdi>{size}</bdi></Tag> : null}
            {!line.barcode ? <Tag tone="neutral">ملوش باركود</Tag> : null}
          </div>
        </div>
        <ActionsMenu line={line} canPrice={canPrice} onPick={onPick} onOpenSheet={onMore} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-bw-line/60 pt-2">
        <div className="min-w-0 text-[12px] text-bw-ink-soft">
          <DiscountField line={line} suggestedList={lastCosts[line.skuId]?.listUnitPrice ?? null} hubId={hubId} orderId={order.orderId} onOrder={onOrder} />
        </div>

        <div role="group" aria-label={`الكمية المجهزة من ${productTitle(line)}`} className="flex shrink-0 items-center gap-1">
          <button type="button" disabled={!!minus || busy} title={minus ?? undefined} aria-label="نقّص قطعة" onClick={onMinus}
            className={cn(step, 'border border-bw-line-field text-bw-ink hover:bg-bw-sunken disabled:border-bw-line disabled:text-bw-ink-subtle disabled:opacity-50')}>
            <Minus className="size-4" aria-hidden />
          </button>
          <span className={cn('min-w-12 text-center text-bw-heading font-semibold tabular-nums', done ? 'text-bw-emerald' : 'text-bw-ink')} dir="ltr" aria-live="polite" aria-label={`${line.received} من ${line.required}`}>
            {line.received}<span className="text-bw-ink-subtle">/{line.required}</span>
          </span>
          <button type="button" disabled={!!plus || busy} title={plus ?? undefined} aria-label="زوّد قطعة" onClick={onPlus}
            className={cn(step, 'bg-bw-action text-bw-on-action hover:bg-bw-action-hover disabled:bg-bw-sunken disabled:text-bw-ink-subtle')}>
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {plus && !done ? <p className="text-[12px] text-bw-ink-subtle">{plus}</p> : null}
    </li>
  )
}
