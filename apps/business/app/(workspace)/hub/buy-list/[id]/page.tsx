'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowRight, Check, ChevronDown, Copy, MessageCircle, Printer, RefreshCw, Undo2 } from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Flash } from '@/components/bw/ops'
import { ProductIdentity } from '@/components/bw/product-card'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import {
  batchPrintHtml, fromLocalInput, openLines, orderedLines, purchaseLineName, purchaseListText, purchaseTotals, STATUS_LABEL, toLocalInput,
  tomorrowMidday, whatsappUrl,
  type BatchDetail, type BatchLine,
} from '@/lib/purchase-batch'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

export default function BatchPage() {
  return (
    <RoleShell role="hub" active="buy-list" mode="desktop">
      <BatchBody />
    </RoleShell>
  )
}

// `received` is the stored event type of a purchase count (history keeps it); the screen words it as what it is: a purchase.
const EVENT_LABEL: Record<string, string> = {
  created: 'اتقفلت الدفعة', sent: 'اتأكد إن الدفعة اتطلبت', details: 'اتعدّل الموعد أو الملاحظة', received: 'اتسجّل شراء',
  unavailable: 'اتسجّل إنه مش متاح', closed: 'اتقفلت',
}

const batchTone = (batch: BatchDetail) => (batch.status === 'closed' ? (batch.closeReason === 'cancelled' ? 'neutral' : 'ok') : batch.status === 'sent' ? 'info' : 'warn') as 'neutral' | 'ok' | 'info' | 'warn'

/** Clipboard API first; a hidden textarea when the page is not a secure context (e.g. opened over the LAN). */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.cssText = 'position:fixed;opacity:0;inset-block-start:0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch { return false }
  }
}

function BatchBody() {
  const { id } = useParams<{ id: string }>()
  const { data, error, loading, reload } = useApi<BatchDetail>(id ? `/purchase-batches/${id}` : null, { pollMs: 20000 })
  const [copied, setCopied] = React.useState<'ok' | 'failed' | null>(null)

  // `rows` are the lines still to buy (what is copied, shared, printed and bulk-selected); `lines` is every line of the batch, open ones first,
  // so what was bought, closed out or parked as unavailable stays on the same list instead of a second one.
  const rows = React.useMemo(() => (data ? openLines(data) : []), [data])
  const lines = React.useMemo(() => (data ? [...rows, ...orderedLines(data).filter((line) => line.remaining === 0)] : []), [data, rows])
  const hasOpen = rows.length > 0
  const totals = data ? purchaseTotals(data) : null

  // Selection lives only on the purchase list's rows; a line that is bought or closed out drops out of it on the next refresh.
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  React.useEffect(() => {
    setSelected((current) => {
      const live = new Set(rows.map((line) => line.id))
      const kept = [...current].filter((id) => live.has(id))
      return kept.length === current.size ? current : new Set(kept)
    })
  }, [rows])
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleAll = () => setSelected((current) => (current.size === rows.length ? new Set() : new Set(rows.map((line) => line.id))))

  const copyText = async (text: string) => {
    setCopied((await writeClipboard(text)) ? 'ok' : 'failed')
    window.setTimeout(() => setCopied(null), 2500)
  }
  const copy = async () => { if (data) await copyText(purchaseListText(data)) }
  const print = () => {
    if (!data) return
    // A self-contained document in its own window, so the app chrome and controls never reach the paper.
    const url = URL.createObjectURL(new Blob([batchPrintHtml(data)], { type: 'text/html' }))
    const win = window.open(url, 'batch-print', 'width=900,height=700')
    if (!win) { URL.revokeObjectURL(url); return }
    win.addEventListener('load', () => { win.focus(); win.print(); URL.revokeObjectURL(url) })
  }

  const secondary = 'inline-flex h-9 items-center gap-2 rounded-bw-field border border-bw-line bg-bw-surface px-3 text-bw-small font-semibold text-bw-ink shadow-bw-sheen transition-colors hover:bg-bw-sunken'

  return (
    <Page>
      <PageHeader
        title={data ? `قائمة المشتريات · دفعة ${data.number}` : 'قائمة المشتريات'}
        meta={data && totals ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusLabel tone={batchTone(data)}>{STATUS_LABEL[data.status]}</StatusLabel>
            <span>{formatDateTime(data.cutoffAt)}</span>
            <span><Code>{totals.products}</Code> منتج</span>
            <span><Code>{totals.units}</Code> قطعة</span>
            {data.status !== 'ready' ? <span>اتشترى <Code>{data.received}/{data.units}</Code></span> : null}
            {data.expectedAt && data.status !== 'closed' ? <span>وصول متوقع {formatDateTime(data.expectedAt)}</span> : null}
          </span>
        ) : undefined}
        actions={<>
          <Button size="sm" disabled={!data || !hasOpen} onClick={copy}>
            {copied === 'ok' ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied === 'ok' ? 'اتنسخت' : 'نسخ قائمة المشتريات'}
          </Button>
          {data && hasOpen
            ? <a href={whatsappUrl(purchaseListText(data))} target="_blank" rel="noopener noreferrer" className={secondary}><MessageCircle className="size-4" aria-hidden />واتساب</a>
            : <Button variant="secondary" size="sm" disabled><MessageCircle className="size-4" aria-hidden />واتساب</Button>}
          <Button variant="secondary" size="sm" disabled={!data || !hasOpen} onClick={print}><Printer className="size-4" aria-hidden />طباعة</Button>
          <Button variant="ghost" size="sm" onClick={reload} loading={loading && !!data} aria-label="تحديث">{!(loading && !!data) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>
          <Link href="/hub/buy-list" className="inline-flex h-9 items-center gap-1.5 rounded-bw-field px-3 text-bw-small font-semibold text-bw-ink-soft transition-colors hover:bg-bw-sunken hover:text-bw-ink"><ArrowRight className="size-4" aria-hidden />كل الدفعات</Link>
        </>}
      />
      <p role="status" className="sr-only">{copied === 'ok' ? 'اتنسخت قائمة المشتريات' : ''}</p>
      {copied === 'failed' ? <Flash tone="warn">المتصفح منع النسخ. افتح الصفحة من localhost أو من اتصال آمن، أو استخدم واتساب.</Flash> : null}

      {error ? (error.status === 404
        ? <div className="bw-panel"><StateBlock kind="empty" title="الدفعة مش موجودة" action={<Link href="/hub/buy-list" className="text-bw-small font-semibold text-bw-cobalt">رجوع للدفعات</Link>} /></div>
        : <LoadError message={error.message} onRetry={reload} />) : null}
      {!data && loading ? <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : null}

      {data ? (
        <>
          {data.status === 'closed' ? (
            <Notice tone={data.closeReason === 'cancelled' ? 'info' : 'ok'} title={data.closeReason === 'cancelled' ? 'الدفعة اتقفلت من غير شراء' : 'الدفعة اتقفلت'}>
              {data.closeReason === 'cancelled' ? 'طلباتها اتلغت أو اتسجّلت مش متاحة، فمفيش حاجة مستنية.' : `اتشترى ${data.received} من ${data.units} قطعة، والباقي اتحسم.`}
              {data.closedAt ? <> · {formatDateTime(data.closedAt)}</> : null}
            </Notice>
          ) : null}

          <section aria-label="قائمة المشتريات" className="bw-panel overflow-hidden">
            {lines.length ? (
              <>
                {hasOpen ? <SelectionBar batch={data} rows={rows} selected={selected} onToggleAll={toggleAll} onCopy={(text) => void copyText(text)} onChanged={reload} /> : null}
                <ul className="divide-y divide-bw-line">
                  {lines.map((line) => <PurchaseRow key={line.id} batch={data} line={line} checked={selected.has(line.id)} onToggle={() => toggle(line.id)} onChanged={reload} />)}
                </ul>
                {data.status === 'sent' ? (
                  <p className="border-t border-bw-line px-4 py-2 text-[12px] text-bw-ink-subtle">
                    «تم الشراء» بيسجّل إنك اشتريت بس. الوصول الفعلي للمخزن والتكلفة النهائية بيتأكدوا في «الطلبات والتجهيز» بمسح الباركود.
                  </p>
                ) : null}
              </>
            ) : (
              <StateBlock kind="empty" title="مفيش حاجة للشراء في الدفعة دي" />
            )}
          </section>

          {data.status === 'ready' ? <SendBar batch={data} onChanged={reload} /> : null}

          <BatchDetails batch={data} onChanged={reload} />
        </>
      ) : null}
    </Page>
  )
}

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2)
const AMOUNT = /^\d+(\.\d{1,2})?$/

/**
 * One product on the purchase list: select box, the product, the numbers (required / bought / left / orders) and, while there is
 * something left to buy on a confirmed batch, the actions. Buying records what staff hold in hand (a partial count is fine; «مش متاح»
 * parks what is left for the customer decision flow) and may carry the price paid and the supplier discount. A line that is done
 * shows how it ended; a parked one offers «لقيته». Nothing here marks a unit as physically received: that is the desk's barcode scan.
 */
function PurchaseRow({ batch, line, checked, onToggle, onChanged }: { batch: BatchDetail; line: BatchLine; checked: boolean; onToggle: () => void; onChanged: () => void }) {
  const open = line.remaining > 0
  const canAct = batch.status === 'sent' && open
  const parked = line.orders.some((order) => order.state === 'unavailable')
  const [quantity, setQuantity] = React.useState(String(line.remaining))
  const [listPrice, setListPrice] = React.useState('')
  const [discountPercent, setDiscountPercent] = React.useState('')
  const [showCost, setShowCost] = React.useState(false)
  const [showOrders, setShowOrders] = React.useState(false)
  const [confirmUnavailable, setConfirmUnavailable] = React.useState(false)
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  // One key per physical count: a retry after a lost response replays instead of counting twice; a new number or price is a new count.
  const key = React.useRef(newKey())
  React.useEffect(() => { setQuantity(String(line.remaining)); key.current = newKey() }, [line.remaining])

  const qty = Number(quantity)
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= line.remaining
  const over = Number.isInteger(qty) && qty > line.remaining
  const priceGiven = listPrice !== ''
  const priceOk = !priceGiven || (AMOUNT.test(listPrice) && Number(listPrice) >= 0.01 && Number(listPrice) <= 100000)
  const percent = discountPercent === '' ? 0 : Number(discountPercent)
  const percentOk = discountPercent === '' || (AMOUNT.test(discountPercent) && percent < 100)
  const discountPerUnit = priceGiven && priceOk && percentOk ? Math.round(Number(listPrice) * percent) / 100 : 0
  const finalCost = priceGiven && priceOk && percentOk ? Number(listPrice) - discountPerUnit : null
  const costOk = priceOk && percentOk && (finalCost === null || finalCost > 0)

  const receive = useCommand(() => api<{ replayed: boolean }>(`/purchase-batches/${batch.id}/lines/${line.id}/receive`, {
    body: { quantity: qty, idempotencyKey: key.current, ...(priceGiven && finalCost !== null ? { cost: { listUnitPrice: Number(listPrice), discountPerUnit } } : {}) },
  }))
  const unavailable = useCommand(() => api(`/purchase-batches/${batch.id}/lines/${line.id}/unavailable`, { body: {} }))
  const reopen = useCommand(() => api('/buy-list/reopen', { body: { skuId: line.skuId, orderIds: line.orders.filter((o) => o.state === 'unavailable').map((o) => o.orderId) } }))
  const busy = receive.pending || unavailable.pending || reopen.pending
  const stale = receive.error?.code === 'EXCEEDS_OUTSTANDING' || receive.error?.code === 'NOTHING_OUTSTANDING'
    ? 'الكمية المتبقية اتغيّرت (طلب اتلغى أو اتعدّل). اتحدّثت بالأرقام الحالية.' : null

  const submit = async () => {
    setMessage(null)
    const result = await receive.execute()
    if (result) {
      key.current = newKey()
      setShowCost(false); setListPrice(''); setDiscountPercent('')
      setMessage({ tone: 'ok', text: `اتسجّل شراء ${qty} قطعة.` })
    }
    onChanged() // a stale count (cancelled order, another purchase) is refreshed so the next try uses the fresh numbers
  }

  return (
    <li className={cn('px-3 py-2 sm:px-4', (checked || !open) && 'bg-bw-veil-1')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {open
          ? <input type="checkbox" className="size-4 shrink-0 accent-bw-action" checked={checked} onChange={onToggle} aria-label={`تحديد ${purchaseLineName(line).full}`} />
          : <span className="size-4 shrink-0" aria-hidden />}
        <div className="min-w-0 flex-1 basis-52"><ProductIdentity item={line} size="sm" /></div>

        <div className="flex shrink-0 items-center gap-3.5 text-center">
          <Stat label="مطلوب" value={line.required} />
          <Stat label="اتشترى" value={line.received} tone={line.received > 0 ? 'ok' : undefined} />
          <Stat label="فاضل" value={line.remaining} tone={line.remaining > 0 ? 'warn' : undefined} />
          <button type="button" aria-expanded={showOrders} aria-label={`الطلبات (${line.orders.length})`} onClick={() => setShowOrders((v) => !v)}
            className="flex flex-col items-center gap-0.5 rounded-bw-field px-1 hover:bg-bw-sunken">
            <span className="text-[11px] leading-4 text-bw-ink-subtle">طلبات</span>
            <span className="flex items-center gap-0.5 text-bw-body font-semibold leading-5 text-bw-ink"><Code>{line.orders.length}</Code><ChevronDown className={cn('size-3 text-bw-ink-subtle transition-transform duration-200', showOrders && 'rotate-180')} aria-hidden /></span>
          </button>
        </div>

        <div className="flex basis-full flex-wrap items-center gap-2 md:basis-auto md:min-w-[18.5rem] md:justify-end">
          {canAct ? (
            <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <input
                aria-label="الكمية اللي اتشترت" dir="ltr" inputMode="numeric" autoComplete="off" value={quantity} aria-invalid={over || undefined}
                onChange={(event) => { setQuantity(event.target.value.replace(/[^\d]/g, '')); key.current = newKey() }}
                className={cn('bw-control h-9 w-14 rounded-bw-field border bg-bw-page/60 text-center text-bw-body font-semibold tabular-nums text-bw-ink', over ? 'border-bw-danger' : 'border-bw-line-field')}
              />
              <Button type="submit" size="sm" loading={receive.pending} disabled={!valid || !costOk || busy}>تم الشراء</Button>
              <button type="button" aria-expanded={showCost} onClick={() => setShowCost((v) => !v)}
                className="h-9 rounded-bw-field px-2 text-[12px] font-semibold text-bw-ink-soft transition-colors hover:bg-bw-sunken hover:text-bw-ink">
                السعر والخصم
              </button>
              {confirmUnavailable ? (
                <span className="flex items-center gap-1.5">
                  <Button type="button" variant="danger" size="sm" loading={unavailable.pending} disabled={busy} onClick={async () => { if (await unavailable.execute()) { setConfirmUnavailable(false); onChanged() } }}>تأكيد: <Code>{line.remaining}</Code> مش متاح</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmUnavailable(false)} disabled={busy}>رجوع</Button>
                </span>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirmUnavailable(true)} className="h-9 rounded-bw-field px-2 text-[12px] font-semibold text-bw-danger transition-colors hover:bg-bw-danger-soft">مش متاح</button>
              )}
              {showCost ? (
                <div className="flex basis-full flex-wrap items-end gap-x-3 gap-y-1.5 rounded-bw-field border border-bw-line bg-bw-surface px-2.5 py-2">
                  <label className="flex flex-col gap-0.5 text-[11px] text-bw-ink-subtle">
                    سعر القائمة للوحدة (ج.م)
                    <input dir="ltr" inputMode="decimal" autoComplete="off" value={listPrice} aria-invalid={!priceOk || undefined}
                      onChange={(event) => { setListPrice(event.target.value.replace(/[^\d.]/g, '')); key.current = newKey() }}
                      className={cn('bw-control h-9 w-28 rounded-bw-field border bg-bw-page/60 text-center text-bw-body font-semibold tabular-nums text-bw-ink', priceOk ? 'border-bw-line-field' : 'border-bw-danger')} />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[11px] text-bw-ink-subtle">
                    خصم المورد %
                    <input dir="ltr" inputMode="decimal" autoComplete="off" value={discountPercent} disabled={!priceGiven} aria-invalid={!percentOk || undefined}
                      onChange={(event) => { setDiscountPercent(event.target.value.replace(/[^\d.]/g, '')); key.current = newKey() }}
                      className={cn('bw-control h-9 w-20 rounded-bw-field border bg-bw-page/60 text-center text-bw-body font-semibold tabular-nums text-bw-ink disabled:opacity-50', percentOk ? 'border-bw-line-field' : 'border-bw-danger')} />
                  </label>
                  <p className="pb-2 text-[12px] text-bw-ink-soft" aria-live="polite">
                    {finalCost !== null && costOk ? <>التكلفة بعد الخصم <Code className="font-semibold text-bw-ink">{money(finalCost)}</Code> ج.م للوحدة</> : priceGiven && !costOk ? 'السعر أو الخصم مش مظبوط' : 'اختياري: ممكن يتسجّل بعدين وقت المسح'}
                  </p>
                </div>
              ) : null}
              {over ? <p role="alert" className="basis-full text-[12px] text-bw-danger">أكتر من المتبقي (<Code>{line.remaining}</Code>)</p> : null}
            </form>
          ) : open ? null : (
            <>
              {parked
                ? <StatusLabel tone="warn">مش متاح — العميل هيتسأل</StatusLabel>
                : line.closedOut > 0
                  ? <StatusLabel tone="warn">مش هيوصل <Code>{line.closedOut}</Code> قطعة</StatusLabel>
                  : <StatusLabel tone="ok">اتشترى بالكامل</StatusLabel>}
              {parked ? (
                <button type="button" disabled={busy} onClick={async () => { if (await reopen.execute()) { setMessage({ tone: 'ok', text: 'رجع للقائمة — هيدخل في الدفعة الجاية' }); onChanged() } }}
                  className="inline-flex h-9 items-center gap-1 rounded-bw-field px-2 text-[12px] font-semibold text-bw-cobalt hover:bg-bw-sunken">
                  <Undo2 className="size-3.5" aria-hidden />لقيته — رجّعه للقائمة
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {message || stale || receive.error || unavailable.error || reopen.error ? (
        <div className="mt-2 space-y-2">
          {message ? <Flash tone={message.tone}>{message.text}</Flash> : null}
          {stale ? <Flash tone="warn">{stale}</Flash> : <CommandError error={receive.error ?? unavailable.error ?? reopen.error} />}
        </div>
      ) : null}

      {showOrders ? (
        <ul className="mt-2 divide-y divide-bw-line rounded-bw-field border border-bw-line bg-bw-surface">
          {line.orders.map((order) => (
            <li key={order.orderItemId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-bw-small">
              <Code className="font-semibold text-bw-ink">{order.orderNumber.replace(/^ORD-/, '#')}</Code>
              <span className="text-bw-ink-soft">مطلوب <Code>{order.quantity}</Code></span>
              <span className="text-bw-ink-soft">اتشترى <Code>{order.received}</Code></span>
              <span className="ms-auto">
                <StatusLabel tone={order.state === 'received' ? 'ok' : order.state === 'pending' ? 'pending' : 'warn'}>{orderStateLabel[order.state]}</StatusLabel>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

// Per order line: «اتشترى» only means the units were bought and are on their way; the desk's barcode scan is what receives them.
const orderStateLabel = { received: 'اتشترى', pending: 'مستني', unavailable: 'مش متاح', cancelled: 'اتلغى' } as const

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  return (
    <p className="flex min-w-9 flex-col items-center gap-0.5">
      <span className="text-[11px] leading-4 text-bw-ink-subtle">{label}</span>
      <span className={cn('text-bw-body font-semibold leading-5 tabular-nums', tone === 'ok' ? 'text-bw-emerald' : tone === 'warn' ? 'text-bw-amber' : 'text-bw-ink')}><bdi className="bw-code">{value}</bdi></span>
    </p>
  )
}

/**
 * Select all / pick some, then act on just those: copy or share their text, or (once the order is confirmed) record each as bought at
 * its remaining quantity through the same per-line purchase call the row uses. Nothing is selected by default, so the header's copy
 * button keeps copying the whole list.
 */
function SelectionBar({ batch, rows, selected, onToggleAll, onCopy, onChanged }: {
  batch: BatchDetail; rows: BatchLine[]; selected: ReadonlySet<string>; onToggleAll: () => void; onCopy: (text: string) => void; onChanged: () => void
}) {
  const all = selected.size === rows.length
  const some = selected.size > 0 && !all
  const boxRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { if (boxRef.current) boxRef.current.indeterminate = some }, [some])
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const chosen = rows.filter((line) => selected.has(line.id))
  const units = chosen.reduce((sum, line) => sum + line.remaining, 0)
  React.useEffect(() => { if (selected.size === 0) setConfirming(false) }, [selected])

  const markBought = async () => {
    setBusy(true); setResult(null)
    let done = 0; const failed: string[] = []
    for (const line of chosen) {
      try {
        await api(`/purchase-batches/${batch.id}/lines/${line.id}/receive`, { body: { quantity: line.remaining, idempotencyKey: newKey() } })
        done += 1
      } catch { failed.push(purchaseLineName(line).full) }
    }
    setBusy(false); setConfirming(false)
    setResult(failed.length
      ? { tone: 'warn', text: `اتسجّل ${done} من ${chosen.length}. مااتسجّلش: ${failed.join('، ')}. الأرقام اتحدّثت، جرّب تاني.` }
      : { tone: 'ok', text: `اتسجّل شراء ${units} قطعة لـ ${done} منتج.` })
    onChanged()
  }

  return (
    <div className="border-b border-bw-line px-4 py-1.5">
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-3 text-bw-small font-semibold text-bw-ink-soft">
          <input ref={boxRef} type="checkbox" className="size-4 accent-bw-action" checked={all} onChange={onToggleAll} />
          {selected.size ? <>تم تحديد <Code>{selected.size}</Code> من <Code>{rows.length}</Code></> : 'تحديد الكل'}
        </label>
        {selected.size ? (
          <span className="ms-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => onCopy(purchaseListText(batch, selected))}><Copy className="size-4" aria-hidden />نسخ المحدد</Button>
            <a href={whatsappUrl(purchaseListText(batch, selected))} target="_blank" rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-bw-field border border-bw-line bg-bw-surface px-3 text-bw-small font-semibold text-bw-ink shadow-bw-sheen transition-colors hover:bg-bw-sunken"><MessageCircle className="size-4" aria-hidden />واتساب</a>
            {batch.status === 'sent' ? (
              confirming ? (
                <>
                  <Button size="sm" loading={busy} onClick={() => void markBought()}>تأكيد: اتشترى <Code>{units}</Code> قطعة</Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>رجوع</Button>
                </>
              ) : <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}><Check className="size-4" aria-hidden />تم الشراء للمحدد</Button>
            ) : null}
          </span>
        ) : null}
      </div>
      {result ? <div className="mt-2"><Flash tone={result.tone}>{result.text}</Flash></div> : null}
    </div>
  )
}

/**
 * The one step on a ready batch: staff confirm they ordered it themselves. It records who and when; nothing is sent to anyone.
 * The expected arrival (default tomorrow midday, as before) and the note are optional and stay folded away.
 */
function SendBar({ batch, onChanged }: { batch: BatchDetail; onChanged: () => void }) {
  const [eta, setEta] = React.useState(() => toLocalInput(tomorrowMidday()))
  const [note, setNote] = React.useState('')
  const send = useCommand(() => api('/purchase-batches/' + batch.id + '/send', { body: { ...(fromLocalInput(eta) ? { expectedAt: fromLocalInput(eta) } : {}), ...(note.trim() ? { note: note.trim() } : {}) } }))
  const noneLeft = batch.remaining === 0
  return (
    <section aria-label="تأكيد الطلب" className="bw-panel px-4 py-3">
      <form onSubmit={async (event) => { event.preventDefault(); if (await send.execute()) onChanged() }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1 text-bw-small text-bw-ink-soft">بعد ما تبعت القائمة للمورد، سجّل إنك طلبتها. ده تسجيل بس: النظام مابيبعتش حاجة لأي حد.</p>
          <Button type="submit" variant="secondary" loading={send.pending} disabled={noneLeft}>تأكيد إني طلبت الدفعة</Button>
        </div>
        <details className="group mt-2">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-[12px] font-semibold text-bw-ink-soft hover:text-bw-ink [&::-webkit-details-marker]:hidden">
            الوصول المتوقع وملاحظة (اختياري)
            <ChevronDown className="size-3.5 transition-transform duration-200 group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
            <Field label="الوصول المتوقع" type="datetime-local" value={eta} onChange={(event) => setEta(event.target.value)} ltr hint="الافتراضي بكرة الضهر" />
            <Field label="ملاحظة (اختياري)" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="مثلًا: اتطلبت تليفون من…" />
          </div>
        </details>
        {send.error ? <div className="mt-2"><CommandError error={send.error} /></div> : null}
      </form>
    </section>
  )
}

/** Who confirmed the order, the expected arrival and note (editable until the batch closes) and the audit log: all optional reading. */
function BatchDetails({ batch, onChanged }: { batch: BatchDetail; onChanged: () => void }) {
  const [editing, setEditing] = React.useState(false)
  const [eta, setEta] = React.useState('')
  const [note, setNote] = React.useState('')
  const save = useCommand(() => api('/purchase-batches/' + batch.id, { method: 'PATCH', body: { expectedAt: fromLocalInput(eta), note: note.trim() || null } }))
  const open = () => { setEta(batch.expectedAt ? toLocalInput(new Date(batch.expectedAt)) : ''); setNote(batch.note ?? ''); setEditing(true) }

  return (
    <details className="group bw-panel">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-bw-small font-semibold text-bw-ink-soft hover:text-bw-ink [&::-webkit-details-marker]:hidden">
        تفاصيل الدفعة وسجلها
        <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-bw-line px-4 py-3">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[12px] text-bw-ink-soft">اتأكد الطلب</dt>
            <dd className="mt-1 text-bw-small text-bw-ink">{batch.sentAt ? <>{formatDateTime(batch.sentAt)}{batch.sentBy ? <> · <Code className="text-bw-ink-subtle">{shortId(batch.sentBy)}</Code></> : null}</> : 'لسه'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-bw-ink-soft">الوصول المتوقع</dt>
            <dd className="mt-1 flex items-center gap-2 text-bw-small text-bw-ink">
              {batch.expectedAt ? formatDateTime(batch.expectedAt) : 'مش محدد'}
              {batch.status !== 'closed' && !editing ? <button type="button" onClick={open} className="text-[12px] font-semibold text-bw-cobalt hover:underline">تعديل</button> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-bw-ink-soft">ملاحظة</dt>
            <dd className="mt-1 text-bw-small text-bw-ink">{batch.note ? <bdi>{batch.note}</bdi> : 'مفيش'}</dd>
          </div>
        </dl>
        {editing ? (
          <form className="grid gap-3 border-t border-bw-line pt-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-end" onSubmit={async (event) => { event.preventDefault(); if (await save.execute()) { setEditing(false); onChanged() } }}>
            <Field label="الوصول المتوقع" type="datetime-local" value={eta} onChange={(event) => setEta(event.target.value)} ltr />
            <Field label="ملاحظة (اختياري)" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={save.pending}>حفظ</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={save.pending}>إلغاء</Button>
            </div>
            {save.error ? <div className="sm:col-span-3"><CommandError error={save.error} /></div> : null}
          </form>
        ) : null}
        <ul className="divide-y divide-bw-line border-t border-bw-line">
          {batch.events.map((event, index) => (
            <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-bw-small">
              <span className="text-bw-ink">{EVENT_LABEL[event.type] ?? event.type}</span>
              {event.actorId ? <Code className="text-bw-ink-subtle">{shortId(event.actorId)}</Code> : <span className="text-bw-ink-subtle">تلقائي</span>}
              <span className="ms-auto text-bw-ink-subtle">{formatDateTime(event.createdAt)}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
