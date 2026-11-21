'use client'

import * as React from 'react'
import { Check, Loader2, Minus, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/bw/primitives'
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
/** "12.50" → "12.5", "0.00" → "0": how the percentage is typed back to the operator. */
const trimPercent = (value: string | null | undefined) => (value == null ? '' : String(Number(value)))

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'invalid'; text: string } | { kind: 'error'; text: string }

/**
 * The supplier discount of one line, as a percentage of the supplier's list price. Prefilled from the recorded purchase, saved on its own
 * shortly after typing stops (or on leaving the field) with visible saving / saved / error states; a failed save keeps what was typed and
 * offers a retry. The price arithmetic is the server's: this only shows the figures it returns.
 */
function DiscountField({ line, hubId, orderId, onOrder }: {
  line: DeskLine; hubId: string; orderId: string; onOrder: (order: DeskOrder) => void
}) {
  const cost = line.cost
  const serverPercent = trimPercent(cost?.discountPercent)
  const [percent, setPercent] = React.useState(serverPercent)
  const [state, setState] = React.useState<SaveState>({ kind: 'idle' })
  const dirty = React.useRef(false)
  const timer = React.useRef<number | null>(null)
  const seq = React.useRef(0)
  const latest = React.useRef({ percent })
  latest.current = { percent }
  const id = React.useId()

  // A poll or another save refreshes the server value; it never overwrites what the operator is typing.
  React.useEffect(() => { if (!dirty.current) setPercent(serverPercent) }, [serverPercent])
  React.useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const save = React.useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    const { percent: p } = latest.current
    if (!PERCENT.test(p) || Number(p) > 99.99) { setState({ kind: 'invalid', text: 'اكتب نسبة من 0 لـ 99.99' }); return }
    const mine = ++seq.current
    setState({ kind: 'saving' })
    try {
      const result = await api<{ order: DeskOrder | null }>(`/fulfillment/locations/${hubId}/desk/orders/${orderId}/lines/${line.orderItemId}/discount`, {
        method: 'PUT', body: { discountPercent: Number(p) },
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

  const touch = (nextPercent: string) => {
    dirty.current = true
    latest.current = { percent: nextPercent }
    setState({ kind: 'idle' })
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void save() }, SAVE_DELAY_MS)
  }

  if (!cost) {
    return <p className="text-[12px] text-bw-ink-soft">خصم المورّد بيتسجّل بعد «اتشترت».</p>
  }
  // There is no list-price field. The list price is the product's price on the order; the server resolves it.
  const field = 'bw-control h-9 rounded-bw-field border bg-bw-surface px-2 text-center text-bw-small tabular-nums text-bw-ink'
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor={`${id}-p`} className="text-[12px] text-bw-ink-soft">خصم المورّد</label>
        <input id={`${id}-p`} dir="ltr" inputMode="decimal" autoComplete="off" value={percent} aria-invalid={state.kind === 'invalid' || undefined}
          onChange={(event) => { const next = event.target.value.replace(/[^\d.]/g, ''); setPercent(next); touch(next) }}
          onBlur={() => { if (dirty.current) void save() }}
          className={cn(field, 'w-14 disabled:cursor-not-allowed disabled:opacity-50', state.kind === 'invalid' || state.kind === 'error' ? 'border-bw-danger' : 'border-bw-line-field')} />
        <span aria-hidden className="text-[12px] text-bw-ink-soft">%</span>
      </div>
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



/**
 * One product of the order, in the same structure as the purchases lists.
 * Top row: photo · brand + name with its tags (category, texture, size) and the selling price (text only) · ⋯.
 * Bottom row, under a hairline: scan progress (server) · supplier discount · the quantity available with − / +.
 * Three numbers are never mixed: what the customer ordered, what the server counted as scanned in, and the quantity the operator says is available.
 * The operator scans the product ONCE (identity), adjusts the quantity only if units are missing, and confirms it as one operation.
 */
export function ProductCard({ line, order, hubId, canPrice, quantity, onQtyMinus, onQtyPlus, identified, confirming, onConfirm, onDecide, onOrder, onPick, onMore }: {
  line: DeskLine; order: DeskOrder; hubId: string; lastCosts: Desk['lastCosts']; canPrice: boolean
  /** Units the operator says are available (default: the required quantity). A draft until confirmed. */
  quantity: number; onQtyMinus: () => void; onQtyPlus: () => void
  /** The product's identity was verified (scan or manual check) and not yet confirmed. */
  identified: boolean
  confirming: boolean
  /** Confirm the available quantity: receives the units not counted yet and reports any missing ones. */
  onConfirm: () => void
  /** Only for an Admin: decide an open shortage report. */
  onDecide: ((what: 'approve' | 'reject') => void) | null
  onOrder: (order: DeskOrder) => void
  /** An action chosen from the popover (desktop). */
  onPick: (kind: ActionKind) => void
  /** Open the bottom sheet with the same actions (phone). */
  onMore: () => void
}) {
  const done = line.received >= line.required && !line.shortage
  // The desk sends the pack size as printed ("200 ml"); it is always one of the tags, next to the category (the type: cleanser, serum…) and the texture.
  const name = purchaseLineName({ productName: line.productName, brandName: line.brandName, variantName: line.variantName, size: null, sizeUnit: null, packCount: null })
  const full = [name.brand, name.name].filter(Boolean).join(' ') || productTitle(line)
  const category = categoryLabel(line.categoryName)
  const texture = textureLabel(line.texture)
  const size = line.size ?? ''
  const step = 'grid size-bw-control shrink-0 place-items-center rounded-full disabled:cursor-not-allowed'
  const open = line.shortage
  const toReceive = Math.max(quantity - line.received, 0)
  const missing = line.required - quantity
  const canConfirm = !open && (toReceive > 0 || missing > 0)
  return (
    <li className={cn('space-y-2 rounded-bw-card border p-3', open ? 'border-bw-amber/50 bg-bw-amber-soft/20' : done ? 'border-bw-emerald/40 bg-bw-emerald-soft/25' : 'border-bw-line bg-bw-surface')}>
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
            {identified ? <Tag tone="emerald">اتأكدت الهوية</Tag> : null}
          </div>
        </div>
        <ActionsMenu line={line} canPrice={canPrice} onPick={onPick} onOpenSheet={onMore} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-bw-line/60 pt-2">
        <div className="flex flex-col gap-0.5 text-[12px]">
          <p className={cn(done ? 'font-semibold text-bw-emerald' : 'text-bw-ink-soft')}>اتمسح <bdi className="tabular-nums" dir="ltr">{line.received}/{line.required}</bdi></p>
          {line.ordered !== line.required ? <p className="text-bw-amber">اتطلب <bdi className="tabular-nums" dir="ltr">{line.ordered}</bdi> · اتعدّل لـ <bdi className="tabular-nums" dir="ltr">{line.required}</bdi></p> : null}
        </div>

        <div className="min-w-0 text-[12px] text-bw-ink-soft">
          <DiscountField line={line} hubId={hubId} orderId={order.orderId} onOrder={onOrder} />
        </div>

        <div role="group" aria-label={`الكمية المتاحة من ${productTitle(line)}`} className="flex shrink-0 items-center gap-1">
          <span className="me-1 text-[12px] text-bw-ink-soft">المتاح</span>
          <button type="button" disabled={!!open || quantity <= line.received} aria-label="نقّص الكمية المتاحة" onClick={onQtyMinus}
            className={cn(step, 'border border-bw-line-field text-bw-ink hover:bg-bw-sunken disabled:border-bw-line disabled:text-bw-ink-subtle disabled:opacity-50')}>
            <Minus className="size-4" aria-hidden />
          </button>
          <span className={cn('min-w-10 text-center text-bw-heading font-semibold tabular-nums', (open ? open.newQuantity : quantity) < line.required ? 'text-bw-amber' : 'text-bw-ink')} dir="ltr" aria-live="polite"
            aria-label={`المتاح ${open ? open.newQuantity : quantity} من ${line.required}`}>{open ? open.newQuantity : quantity}</span>
          <button type="button" disabled={!!open || quantity >= line.required} aria-label="زوّد الكمية المتاحة" onClick={onQtyPlus}
            className={cn(step, 'bg-bw-action text-bw-on-action hover:bg-bw-action-hover disabled:bg-bw-sunken disabled:text-bw-ink-subtle')}>
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {open ? (
        <div className="space-y-2 rounded-bw-field border border-bw-amber/30 bg-bw-amber-soft/40 p-2.5 text-bw-small">
          <p className="text-bw-ink">ناقص <bdi className="font-semibold tabular-nums" dir="ltr">{open.missing}</bdi> — مستني اعتماد الأدمن. مفيش حاجة اتغيّرت في الطلب لسه.</p>
          {onDecide ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onDecide('approve')}>اعتماد تعديل الكمية</Button>
              <Button size="sm" variant="secondary" onClick={() => onDecide('reject')}>رفض</Button>
            </div>
          ) : <p className="text-[12px] text-bw-ink-soft">الأدمن هو اللي بيعتمد التعديل.</p>}
        </div>
      ) : canConfirm ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-bw-ink-soft">
            {toReceive > 0 && !identified ? 'امسح باركود المنتج مرة واحدة الأول.' : missing > 0 ? <>هيتسجّل نقص <bdi className="tabular-nums" dir="ltr">{missing}</bdi> لحد ما الأدمن يعتمد.</> : null}
          </p>
          <Button size="sm" loading={confirming} disabled={toReceive > 0 && !identified} onClick={onConfirm}>
            {toReceive > 0 ? `تأكيد ${toReceive}${missing > 0 ? ` وتسجيل نقص ${missing}` : ''}` : `سجّل نقص ${missing}`}
          </Button>
        </div>
      ) : null}
    </li>
  )
}
