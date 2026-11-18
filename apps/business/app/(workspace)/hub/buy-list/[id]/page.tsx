'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, MessageCircle, Package, Printer, RefreshCw, Undo2 } from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Flash, Meter } from '@/components/bw/ops'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import {
  batchPrintHtml, categoryLabel, fromLocalInput, openLines, orderedLines, productUrl, purchaseLineName, purchaseListText, purchaseTotals, STATUS_LABEL, textureLabel, toLocalInput,
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

const EVENT_LABEL: Record<string, string> = {
  created: 'اتقفلت الدفعة', sent: 'اتأكد إن الدفعة اتطلبت', details: 'اتعدّل الموعد أو الملاحظة', received: 'اتسجّل استلام',
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

  const rows = React.useMemo(() => (data ? openLines(data) : []), [data])
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
            <Notice tone={data.closeReason === 'cancelled' ? 'info' : 'ok'} title={data.closeReason === 'cancelled' ? 'الدفعة اتقفلت من غير استلام' : 'الدفعة اتقفلت'}>
              {data.closeReason === 'cancelled' ? 'طلباتها اتلغت أو اتسجّلت مش متاحة، فمفيش حاجة مستنية.' : `اتستلم ${data.received} من ${data.units} قطعة، والباقي اتحسم.`}
              {data.closedAt ? <> · {formatDateTime(data.closedAt)}</> : null}
            </Notice>
          ) : null}

          <section aria-label="قائمة المشتريات" className="bw-panel overflow-hidden">
            {hasOpen ? (
              <>
                <SelectionBar batch={data} rows={rows} selected={selected} onToggleAll={toggleAll} onCopy={(text) => void copyText(text)} onChanged={reload} />
                <ul className="divide-y divide-bw-line">
                  {rows.map((line) => <PurchaseRow key={line.id} line={line} checked={selected.has(line.id)} onToggle={() => toggle(line.id)} />)}
                </ul>
              </>
            ) : (
              <StateBlock kind="empty" title={data.status === 'closed' ? 'مفيش حاجة للشراء في الدفعة دي' : 'كل أصناف الدفعة اتشترت أو اتحسمت'}
                body={data.status === 'closed' ? undefined : 'التفاصيل في «تسجيل الاستلام» تحت.'} />
            )}
          </section>

          {data.status === 'ready' ? <SendBar batch={data} onChanged={reload} /> : null}

          <ReceivingSection batch={data} onChanged={reload} />
          <BatchDetails batch={data} onChanged={reload} />
        </>
      ) : null}
    </Page>
  )
}

const tagTone = {
  violet: 'bg-bw-violet-soft text-bw-violet border-bw-violet/25',
  amber: 'bg-bw-amber-soft text-bw-amber border-bw-amber/25',
  cobalt: 'bg-bw-cobalt-soft text-bw-cobalt border-bw-cobalt/25',
} as const

/** A small colored label: category (violet), texture (amber), size (cobalt). Colour is never the only carrier: each tag has its own words. */
function Tag({ tone, children }: { tone: keyof typeof tagTone; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2 text-[11px] font-semibold leading-5', tagTone[tone])}>{children}</span>
}

const imageSrc = (url: string) => (url.startsWith('/') ? `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')}${url}` : url)

/**
 * How one product is shown everywhere on this page: photo, the brand right beside the name, size and texture as small tags, and a link
 * to its storefront page. Tags carry the size only when the name does not already say it.
 */
function ProductCell({ line }: { line: BatchLine }) {
  const name = purchaseLineName(line)
  const texture = textureLabel(line.texture)
  const category = categoryLabel(line.categoryName)
  const href = productUrl(line)
  const [broken, setBroken] = React.useState(false)
  // An image that failed before React attached its handler never fires onError again, so look at it once on mount.
  const imageRef = React.useCallback((node: HTMLImageElement | null) => { if (node && node.complete && node.naturalWidth === 0) setBroken(true) }, [])
  const title = (
    <bdi>{name.brand ? <><strong className="font-bold">{name.brand}</strong>{' '}</> : null}{name.name || shortId(line.skuId)}</bdi>
  )
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
      {line.imageUrl && !broken ? (
        <img ref={imageRef} src={imageSrc(line.imageUrl)} alt={name.full} width={48} height={48} loading="lazy" onError={() => setBroken(true)}
          className="size-11 shrink-0 rounded-bw-field border border-bw-line bg-bw-surface object-cover sm:size-12" />
      ) : (
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-bw-field border border-bw-line bg-bw-veil-1 text-bw-ink-subtle sm:size-12"><Package className="size-5" /></span>
      )}
      <div className="min-w-0 flex-1">
        {/* One isolate, so the brand reads first even inside the RTL page; the whole name opens the product page. */}
        <h3 className="text-bw-body font-medium leading-6 text-bw-ink">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`فتح صفحة ${name.full}`} title="فتح صفحة المنتج" className="group/link hover:underline hover:underline-offset-4">
              {title}<ExternalLink className="ms-1.5 inline size-3.5 align-[-1px] text-bw-ink-subtle transition-colors group-hover/link:text-bw-ink" aria-hidden />
            </a>
          ) : title}
        </h3>
        {category || texture || name.tags.length ? (
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            {category ? <Tag tone="violet"><bdi>{category}</bdi></Tag> : null}
            {texture ? <Tag tone="amber"><bdi>{texture}</bdi></Tag> : null}
            {name.tags.map((tag) => <Tag key={tag} tone="cobalt"><bdi>{tag}</bdi></Tag>)}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** One product to buy: a checkbox, the quantity as the loudest thing on the row, then the product. */
function PurchaseRow({ line, checked, onToggle }: { line: BatchLine; checked: boolean; onToggle: () => void }) {
  return (
    <li className={cn('flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4', checked && 'bg-bw-veil-1')}>
      <input type="checkbox" className="size-4 shrink-0 accent-bw-action" checked={checked} onChange={onToggle} aria-label={`تحديد ${purchaseLineName(line).full}`} />
      <p className="flex w-10 shrink-0 items-baseline justify-center gap-0.5 text-bw-ink sm:w-12" aria-label={`الكمية ${line.remaining}`}>
        <bdi className="bw-code text-[1.5rem] font-semibold leading-none tabular-nums">{line.remaining}</bdi>
        <span className="text-bw-small text-bw-ink-subtle" aria-hidden>×</span>
      </p>
      <ProductCell line={line} />
    </li>
  )
}

/**
 * Select all / pick some, then act on just those: copy or share their text, or (once the order is confirmed) record each as bought at
 * its remaining quantity through the same per-line receive call the receiving section uses. Nothing is selected by default, so the
 * header's copy button keeps copying the whole list.
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
      : { tone: 'ok', text: `اتسجّل شراء ${units} قطعة لـ ${done} منتج. الوصول الفعلي والتكلفة بيتسجّلوا في «الطلبات والتجهيز» وقت المسح.` })
    onChanged()
  }

  return (
    <div className="border-b border-bw-line px-4 py-2">
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

/**
 * Recording what was physically bought belongs after the order is confirmed, so the section only exists then (plus a ready batch
 * that holds a line parked as unavailable, whose «لقيته» action must stay reachable). It is open while a batch is being received.
 */
function ReceivingSection({ batch, onChanged }: { batch: BatchDetail; onChanged: () => void }) {
  const parked = batch.lines.some((line) => line.orders.some((order) => order.state === 'unavailable'))
  if (batch.status === 'ready' && !parked) return null
  const lines = orderedLines(batch).filter((line) => batch.status !== 'ready' || line.orders.some((order) => order.state === 'unavailable'))
  return (
    <details className="group bw-panel" open={batch.status === 'sent'}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-bw-body font-semibold text-bw-ink">تسجيل الاستلام</span>
          <span className="block text-[12px] text-bw-ink-soft">اتشترى <Code>{batch.received}/{batch.units}</Code> قطعة</span>
        </span>
        <span className="flex items-center gap-3">
          <Meter className="hidden w-28 sm:block" value={batch.received} max={batch.units} tone={batch.remaining === 0 ? 'emerald' : 'cobalt'} label={`اتستلم ${batch.received} من ${batch.units}`} />
          <ChevronDown className="size-4 text-bw-ink-soft transition-transform duration-200 group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      <div className="border-t border-bw-line">
        <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_minmax(0,19rem)] gap-x-4 border-b border-bw-line px-4 py-2 text-[12px] font-semibold text-bw-ink-soft md:grid">
          <span>الصنف</span><span className="text-center">مطلوب</span><span className="text-center">اتشترى</span><span className="text-center">فاضل</span><span />
        </div>
        <ul className="divide-y divide-bw-line">
          {lines.map((line) => <LineRow key={line.id} batch={batch} line={line} onChanged={onChanged} />)}
        </ul>
      </div>
    </details>
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

const orderStateLabel = { received: 'اتستلم', pending: 'مستني', unavailable: 'مش متاح', cancelled: 'اتلغى' } as const

function LineRow({ batch, line, onChanged }: { batch: BatchDetail; line: BatchLine; onChanged: () => void }) {
  const [quantity, setQuantity] = React.useState(String(line.remaining))
  const [confirmUnavailable, setConfirmUnavailable] = React.useState(false)
  const [showOrders, setShowOrders] = React.useState(false)
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const inputId = React.useId()
  // One key per physical count: a retry after a lost response replays instead of counting twice; a new number is a new count.
  const key = React.useRef(newKey())
  React.useEffect(() => { setQuantity(String(line.remaining)); key.current = newKey() }, [line.remaining])

  const receive = useCommand(() => api<{ replayed: boolean }>(`/purchase-batches/${batch.id}/lines/${line.id}/receive`, {
    body: { quantity: Number(quantity), idempotencyKey: key.current },
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
      setMessage({ tone: 'ok', text: `اتسجّل شراء ${qty} قطعة. الوصول الفعلي والتكلفة بيتسجّلوا في «الطلبات والتجهيز» وقت المسح.` })
      onChanged()
    } else onChanged() // a stale count (cancelled order, another receipt) is refreshed so the next try uses the fresh numbers
  }

  return (
    <li className={cn('px-4 py-3.5', done && 'bg-bw-veil-1')}>
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_minmax(0,19rem)] md:items-center">
        <div className="min-w-0">
          <ProductCell line={line} />
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-bw-ink-subtle">
            <Code>{line.skuCode ?? shortId(line.skuId)}</Code>
            {line.barcode ? <Code>{line.barcode}</Code> : null}
            <button type="button" aria-expanded={showOrders} onClick={() => setShowOrders((v) => !v)} className="inline-flex items-center gap-1 font-semibold text-bw-ink-soft hover:text-bw-ink">
              <Code>{line.orders.length}</Code> طلب<ChevronDown className={cn('size-3.5 transition-transform duration-200', showOrders && 'rotate-180')} aria-hidden />
            </button>
          </p>
        </div>

        <Qty label="مطلوب" value={line.required} />
        <Qty label="اتشترى" value={line.received} tone={line.received > 0 ? 'ok' : undefined} />
        <Qty label="فاضل" value={line.remaining} tone={line.remaining > 0 ? 'warn' : undefined} />

        <div className="min-w-0">
          {canReceive ? (
            <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <label htmlFor={inputId} className="sr-only">الكمية اللي اتشترت</label>
              <input
                id={inputId} dir="ltr" inputMode="numeric" autoComplete="off" value={quantity} aria-invalid={over || undefined}
                onChange={(event) => { setQuantity(event.target.value.replace(/[^\d]/g, '')); key.current = newKey() }}
                className={cn('bw-control h-bw-control w-16 rounded-bw-field border bg-bw-page/60 text-center text-bw-body font-semibold tabular-nums text-bw-ink', over ? 'border-bw-danger' : 'border-bw-line-field')}
              />
              <Button type="submit" loading={receive.pending} disabled={!valid || busy} className="flex-1 sm:flex-none">تم الشراء</Button>
              {confirmUnavailable ? (
                <span className="flex items-center gap-1.5">
                  <Button type="button" variant="danger" size="sm" loading={unavailable.pending} disabled={busy} onClick={async () => { if (await unavailable.execute()) { setConfirmUnavailable(false); onChanged() } }}>تأكيد: العميل هيتسأل</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmUnavailable(false)} disabled={busy}>رجوع</Button>
                </span>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirmUnavailable(true)} className="h-9 rounded-bw-field px-2 text-[12px] font-semibold text-bw-danger transition-colors hover:bg-bw-danger-soft">مش متاح</button>
              )}
              {over ? <p role="alert" className="basis-full text-[12px] text-bw-danger">أكتر من المتبقي (<Code>{line.remaining}</Code>)</p> : null}
            </form>
          ) : (
            <p className="text-[12px] text-bw-ink-subtle md:text-end">
              {line.remaining > 0 ? '' : line.closedOut > 0
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
