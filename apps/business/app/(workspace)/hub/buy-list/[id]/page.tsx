'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowRight, ChevronDown, Copy, MessageCircle, Printer, RefreshCw, Undo2 } from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Flash, Meter } from '@/components/bw/ops'
import { CostInput, costFrom, egp } from '@/components/workspace/buy-costs'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import {
  batchPrintHtml, batchText, fromLocalInput, lineVariant, STATUS_LABEL, toLocalInput, tomorrowMidday, whatsappUrl,
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

const EVENT_LABEL: Record<string, string> = {
  created: 'اتقفلت الدفعة', sent: 'اتأكد إن الدفعة اتطلبت', details: 'اتعدّل الموعد أو الملاحظة', received: 'اتسجّل استلام',
  unavailable: 'اتسجّل إنه مش متاح', closed: 'اتقفلت',
}

function BatchBody() {
  const { id } = useParams<{ id: string }>()
  const { data, error, loading, reload } = useApi<BatchDetail>(id ? `/purchase-batches/${id}` : null, { pollMs: 20000 })
  const [copied, setCopied] = React.useState(false)

  const copy = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(batchText(data))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch { setCopied(false) }
  }
  const print = () => {
    if (!data) return
    // A self-contained document in its own window, so the app chrome and controls never reach the paper.
    const url = URL.createObjectURL(new Blob([batchPrintHtml(data)], { type: 'text/html' }))
    const win = window.open(url, 'batch-print', 'width=900,height=700')
    if (!win) { URL.revokeObjectURL(url); return }
    win.addEventListener('load', () => { win.focus(); win.print(); URL.revokeObjectURL(url) })
  }

  const hasOpen = !!data && data.lines.some((line) => line.remaining > 0)

  return (
    <Page>
      <PageHeader
        title={data ? `دفعة شراء #${data.number}` : 'دفعة شراء'}
        meta={data ? <>اتقفلت {formatDateTime(data.cutoffAt)} · <Code>{data.skus}</Code> صنف · <Code>{data.units}</Code> قطعة</> : undefined}
        actions={<>
          <Link href="/hub/buy-list" className="inline-flex h-9 items-center gap-1.5 rounded-bw-field px-3 text-bw-small font-semibold text-bw-ink-soft transition-colors hover:bg-bw-sunken hover:text-bw-ink"><ArrowRight className="size-4" aria-hidden />كل الدفعات</Link>
          <Button variant="secondary" size="sm" onClick={reload} loading={loading && !!data}>{!(loading && !!data) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>
          <Button variant="secondary" size="sm" disabled={!data || !hasOpen} onClick={copy}><Copy className="size-4" aria-hidden />{copied ? 'اتنسخت' : 'نسخ'}</Button>
          {data && hasOpen
            ? <a href={whatsappUrl(batchText(data))} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-bw-field border border-bw-line bg-bw-surface px-3 text-bw-small font-semibold text-bw-ink shadow-bw-sheen transition-colors hover:bg-bw-sunken"><MessageCircle className="size-4" aria-hidden />واتساب</a>
            : <Button variant="secondary" size="sm" disabled><MessageCircle className="size-4" aria-hidden />واتساب</Button>}
          <Button variant="secondary" size="sm" disabled={!data || !hasOpen} onClick={print}><Printer className="size-4" aria-hidden />طباعة</Button>
        </>}
      />
      {error ? (error.status === 404
        ? <div className="bw-panel"><StateBlock kind="empty" title="الدفعة مش موجودة" action={<Link href="/hub/buy-list" className="text-bw-small font-semibold text-bw-cobalt">رجوع للدفعات</Link>} /></div>
        : <LoadError message={error.message} onRetry={reload} />) : null}
      {!data && loading ? <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : null}

      {data ? (
        <>
          <Summary batch={data} onChanged={reload} />
          {data.status === 'ready' ? <SendPanel batch={data} onChanged={reload} /> : null}
          {data.status === 'closed' ? (
            <Notice tone={data.closeReason === 'cancelled' ? 'info' : 'ok'} title={data.closeReason === 'cancelled' ? 'الدفعة اتقفلت من غير استلام' : 'الدفعة اتقفلت'}>
              {data.closeReason === 'cancelled' ? 'طلباتها اتلغت أو اتسجّلت مش متاحة، فمفيش حاجة مستنية.' : `اتستلم ${data.received} من ${data.units} قطعة، والباقي اتحسم.`}
              {data.closedAt ? <> · {formatDateTime(data.closedAt)}</> : null}
            </Notice>
          ) : null}

          <section aria-label="قائمة الدفعة" className="bw-panel overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_minmax(0,19rem)] gap-x-4 border-b border-bw-line px-4 py-2 text-[12px] font-semibold text-bw-ink-soft md:grid">
              <span>الصنف</span><span className="text-center">مطلوب</span><span className="text-center">وصل</span><span className="text-center">فاضل</span><span />
            </div>
            <ul className="divide-y divide-bw-line">
              {data.lines.map((line) => <LineRow key={line.id} batch={data} line={line} onChanged={reload} />)}
            </ul>
          </section>

          <details className="group bw-panel">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-bw-small font-semibold text-bw-ink-soft hover:text-bw-ink [&::-webkit-details-marker]:hidden">
              سجل الدفعة
              <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="divide-y divide-bw-line border-t border-bw-line">
              {data.events.map((event, index) => (
                <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-bw-small">
                  <span className="text-bw-ink">{EVENT_LABEL[event.type] ?? event.type}</span>
                  {event.actorId ? <Code className="text-bw-ink-subtle">{shortId(event.actorId)}</Code> : <span className="text-bw-ink-subtle">تلقائي</span>}
                  <span className="ms-auto text-bw-ink-subtle">{formatDateTime(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </Page>
  )
}

/** Who confirmed the order and when, the expected arrival (editable until the batch closes) and the received progress. */
function Summary({ batch, onChanged }: { batch: BatchDetail; onChanged: () => void }) {
  const tone = batch.status === 'closed' ? (batch.closeReason === 'cancelled' ? 'neutral' : 'ok') : batch.status === 'sent' ? 'info' : 'warn'
  const [editing, setEditing] = React.useState(false)
  const [eta, setEta] = React.useState('')
  const [note, setNote] = React.useState('')
  const save = useCommand(() => api('/purchase-batches/' + batch.id, { method: 'PATCH', body: { expectedAt: fromLocalInput(eta), note: note.trim() || null } }))
  const open = () => { setEta(batch.expectedAt ? toLocalInput(new Date(batch.expectedAt)) : ''); setNote(batch.note ?? ''); setEditing(true) }

  return (
    <section aria-label="ملخص الدفعة" className="bw-panel px-4 py-3.5">
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[12px] text-bw-ink-soft">الحالة</dt>
          <dd className="mt-1"><StatusLabel tone={tone}>{STATUS_LABEL[batch.status]}</StatusLabel></dd>
        </div>
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
          <dt className="text-[12px] text-bw-ink-soft">اتستلم</dt>
          <dd className="mt-1">
            <p className="text-bw-small text-bw-ink"><Code>{batch.received}/{batch.units}</Code> قطعة</p>
            <Meter className="mt-1.5" value={batch.received} max={batch.units} tone={batch.remaining === 0 ? 'emerald' : 'cobalt'} label={`اتستلم ${batch.received} من ${batch.units}`} />
          </dd>
        </div>
      </dl>
      {batch.note && !editing ? <p className="mt-3 border-t border-bw-line pt-3 text-bw-small text-bw-ink-soft">ملاحظة: <bdi>{batch.note}</bdi></p> : null}
      {editing ? (
        <form className="mt-3 grid gap-3 border-t border-bw-line pt-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-end" onSubmit={async (event) => { event.preventDefault(); if (await save.execute()) { setEditing(false); onChanged() } }}>
          <Field label="الوصول المتوقع" type="datetime-local" value={eta} onChange={(event) => setEta(event.target.value)} ltr />
          <Field label="ملاحظة (اختياري)" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={save.pending}>حفظ</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={save.pending}>إلغاء</Button>
          </div>
          {save.error ? <div className="sm:col-span-3"><CommandError error={save.error} /></div> : null}
        </form>
      ) : null}
    </section>
  )
}

/** The one step on a ready batch: staff confirm they ordered it themselves. It records who and when; nothing is sent to anyone. */
function SendPanel({ batch, onChanged }: { batch: BatchDetail; onChanged: () => void }) {
  const [eta, setEta] = React.useState(() => toLocalInput(tomorrowMidday()))
  const [note, setNote] = React.useState('')
  const send = useCommand(() => api('/purchase-batches/' + batch.id + '/send', { body: { ...(fromLocalInput(eta) ? { expectedAt: fromLocalInput(eta) } : {}), ...(note.trim() ? { note: note.trim() } : {}) } }))
  const noneLeft = batch.remaining === 0
  return (
    <section aria-label="تأكيد الطلب" className="bw-panel px-4 py-4">
      <form className="grid gap-x-4 gap-y-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-end" onSubmit={async (event) => { event.preventDefault(); if (await send.execute()) onChanged() }}>
        <Field label="الوصول المتوقع" type="datetime-local" value={eta} onChange={(event) => setEta(event.target.value)} ltr hint="الافتراضي بكرة الضهر" />
        <Field label="ملاحظة (اختياري)" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="مثلًا: اتطلبت تليفون من…" />
        <Button type="submit" loading={send.pending} disabled={noneLeft}>تأكيد إني طلبت الدفعة</Button>
        <p className="text-[12px] text-bw-ink-subtle sm:col-span-3">ده تسجيل بس: النظام مابيبعتش حاجة لأي مورد. انسخ القائمة أو ابعتها بنفسك، وبعدين أكّد هنا.</p>
        {send.error ? <div className="sm:col-span-3"><CommandError error={send.error} /></div> : null}
      </form>
    </section>
  )
}

const orderStateLabel = { received: 'اتستلم', pending: 'مستني', unavailable: 'مش متاح', cancelled: 'اتلغى' } as const

function LineRow({ batch, line, onChanged }: { batch: BatchDetail; line: BatchLine; onChanged: () => void }) {
  const [quantity, setQuantity] = React.useState(String(line.remaining))
  const [showCost, setShowCost] = React.useState(false)
  const [listPrice, setListPrice] = React.useState('')
  const [discount, setDiscount] = React.useState('')
  const [confirmUnavailable, setConfirmUnavailable] = React.useState(false)
  const [showOrders, setShowOrders] = React.useState(false)
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const inputId = React.useId()
  // One key per physical count: a retry after a lost response replays instead of counting twice; a new number is a new count.
  const key = React.useRef(newKey())
  React.useEffect(() => { setQuantity(String(line.remaining)); key.current = newKey() }, [line.remaining])

  const typedCost = costFrom(listPrice, discount)
  const costInvalid = (listPrice !== '' || discount !== '') && !typedCost
  const receive = useCommand(() => api<{ replayed: boolean }>(`/purchase-batches/${batch.id}/lines/${line.id}/receive`, {
    body: { quantity: Number(quantity), idempotencyKey: key.current, ...(typedCost ? { cost: { listUnitPrice: typedCost.listUnitPrice, discountPerUnit: typedCost.discountPerUnit } } : {}) },
  }))
  const unavailable = useCommand(() => api(`/purchase-batches/${batch.id}/lines/${line.id}/unavailable`, { body: {} }))
  const reopen = useCommand(() => api('/buy-list/reopen', { body: { skuId: line.skuId, orderIds: line.orders.filter((o) => o.state === 'unavailable').map((o) => o.orderId) } }))

  const qty = Number(quantity)
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= line.remaining
  const over = Number.isInteger(qty) && qty > line.remaining
  const busy = receive.pending || unavailable.pending || reopen.pending
  const canReceive = batch.status === 'sent' && line.remaining > 0
  const parked = line.orders.some((order) => order.state === 'unavailable')
  const stale = receive.error?.code === 'EXCEEDS_OUTSTANDING' || receive.error?.code === 'NOTHING_OUTSTANDING'
    ? 'الكمية المتبقية اتغيّرت (طلب اتلغى أو اتعدّل). اتحدّثت بالأرقام الحالية.' : null
  const done = line.remaining === 0

  const submit = async () => {
    setMessage(null)
    const result = await receive.execute()
    if (result) {
      key.current = newKey()
      setMessage({ tone: 'ok', text: `اتسجّل استلام ${qty} قطعة${typedCost ? ' بتكلفتها' : ' — التكلفة لسه مش مسجّلة'}` })
      setListPrice(''); setDiscount('')
      onChanged()
    } else onChanged() // a stale count (cancelled order, another receipt) is refreshed so the next try uses the fresh numbers
  }

  return (
    <li className={cn('px-4 py-3.5', done && 'bg-bw-veil-1')}>
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_minmax(0,19rem)] md:items-center">
        <div className="min-w-0">
          <h3 className="text-bw-body font-semibold text-bw-ink"><bdi>{line.productName ?? shortId(line.skuId)}</bdi></h3>
          {lineVariant(line) ? <p className="mt-0.5 text-bw-small text-bw-ink-soft"><bdi>{lineVariant(line)}</bdi></p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-bw-ink-subtle">
            <Code>{line.skuCode ?? shortId(line.skuId)}</Code>
            {line.barcode ? <Code>{line.barcode}</Code> : null}
            <button type="button" aria-expanded={showOrders} onClick={() => setShowOrders((v) => !v)} className="inline-flex items-center gap-1 font-semibold text-bw-ink-soft hover:text-bw-ink">
              <Code>{line.orders.length}</Code> طلب<ChevronDown className={cn('size-3.5 transition-transform duration-200', showOrders && 'rotate-180')} aria-hidden />
            </button>
          </p>
        </div>

        <Qty label="مطلوب" value={line.required} />
        <Qty label="وصل" value={line.received} tone={line.received > 0 ? 'ok' : undefined} />
        <Qty label="فاضل" value={line.remaining} tone={line.remaining > 0 ? 'warn' : undefined} />

        <div className="min-w-0">
          {canReceive ? (
            <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <label htmlFor={inputId} className="sr-only">الكمية اللي وصلت فعلًا</label>
              <input
                id={inputId} dir="ltr" inputMode="numeric" autoComplete="off" value={quantity} aria-invalid={over || undefined}
                onChange={(event) => { setQuantity(event.target.value.replace(/[^\d]/g, '')); key.current = newKey() }}
                className={cn('bw-control h-bw-control w-16 rounded-bw-field border bg-bw-page/60 text-center text-bw-body font-semibold tabular-nums text-bw-ink', over ? 'border-bw-danger' : 'border-bw-line-field')}
              />
              <Button type="submit" loading={receive.pending} disabled={!valid || busy || costInvalid} className="flex-1 sm:flex-none">استلمت</Button>
              <button type="button" aria-expanded={showCost} onClick={() => setShowCost((v) => !v)} className="h-9 rounded-bw-field px-2 text-[12px] font-semibold text-bw-cobalt transition-colors hover:bg-bw-veil-3">{showCost ? 'من غير تكلفة' : '+ تكلفة'}</button>
              {confirmUnavailable ? (
                <span className="flex items-center gap-1.5">
                  <Button type="button" variant="danger" size="sm" loading={unavailable.pending} disabled={busy} onClick={async () => { if (await unavailable.execute()) { setConfirmUnavailable(false); onChanged() } }}>تأكيد: العميل هيتسأل</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmUnavailable(false)} disabled={busy}>رجوع</Button>
                </span>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirmUnavailable(true)} className="h-9 rounded-bw-field px-2 text-[12px] font-semibold text-bw-danger transition-colors hover:bg-bw-danger-soft">مش متاح</button>
              )}
              {showCost ? (
                <span className="flex basis-full flex-wrap items-center gap-1.5">
                  <CostInput id={`${inputId}-l`} label="سعر القائمة للقطعة" placeholder="سعر القطعة" value={listPrice} onChange={setListPrice} invalid={costInvalid} />
                  <CostInput id={`${inputId}-d`} label="الخصم للقطعة" placeholder="خصم" value={discount} onChange={setDiscount} invalid={costInvalid} />
                  {typedCost ? <span className="text-[12px] text-bw-ink-soft" aria-live="polite">التكلفة <strong className="text-bw-ink tabular-nums">{egp(typedCost.final)}</strong> للقطعة</span> : null}
                </span>
              ) : null}
              {over ? <p role="alert" className="basis-full text-[12px] text-bw-danger">أكتر من المتبقي (<Code>{line.remaining}</Code>)</p> : null}
              {costInvalid ? <p role="alert" className="basis-full text-[12px] text-bw-danger">الخصم لازم يكون أقل من سعر القائمة، والاتنين أرقام.</p> : null}
            </form>
          ) : (
            <p className="text-[12px] text-bw-ink-subtle md:text-end">
              {line.remaining > 0 ? (batch.status === 'ready' ? 'سجّل الاستلام بعد تأكيد الطلب' : '') : line.closedOut > 0
                ? <>مش هيوصل: <Code>{line.closedOut}</Code> قطعة</> : 'اكتمل'}
            </p>
          )}
          {parked ? (
            <button type="button" disabled={busy} onClick={async () => { if (await reopen.execute()) { setMessage({ tone: 'ok', text: 'رجع للقائمة — هيدخل في الدفعة الجاية' }); onChanged() } }}
              className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-bw-cobalt hover:underline md:float-end">
              <Undo2 className="size-3.5" aria-hidden />لقيته — رجّعه للقائمة
            </button>
          ) : null}
        </div>
      </div>

      {message || stale || receive.error || unavailable.error || reopen.error ? (
        <div className="mt-3 space-y-2">
          {message ? <Flash tone={message.tone}>{message.text}</Flash> : null}
          {stale ? <Flash tone="warn">{stale}</Flash> : <CommandError error={receive.error ?? unavailable.error ?? reopen.error} />}
        </div>
      ) : null}

      {showOrders ? (
        <ul className="mt-3 divide-y divide-bw-line rounded-bw-field border border-bw-line bg-bw-veil-1">
          {line.orders.map((order) => (
            <li key={order.orderItemId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-bw-small">
              <Code className="font-semibold text-bw-ink">{order.orderNumber.replace(/^ORD-/, '#')}</Code>
              <span className="text-bw-ink-soft">مطلوب <Code>{order.quantity}</Code></span>
              <span className="text-bw-ink-soft">وصل <Code>{order.received}</Code></span>
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

function Qty({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  return (
    <p className="flex items-baseline justify-between gap-2 md:block md:text-center">
      <span className="text-[12px] text-bw-ink-subtle md:hidden">{label}</span>
      <span className={cn('text-[1.25rem] font-semibold leading-none tabular-nums', tone === 'ok' ? 'text-bw-emerald' : tone === 'warn' ? 'text-bw-amber' : 'text-bw-ink')}><bdi className="bw-code">{value}</bdi></span>
    </p>
  )
}
