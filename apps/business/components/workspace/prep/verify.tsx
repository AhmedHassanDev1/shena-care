'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, Camera, CheckCircle2, ScanLine, X, XCircle } from 'lucide-react'
import { Button, Dialog, useDialog } from '@/components/bw/primitives'
import { Flash, Meter } from '@/components/bw/ops'
import { CameraScanner } from '@/components/workspace/camera-scanner'
import { useMe } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { useCommand } from '@/lib/use-api'
import { egp } from '@/components/workspace/buy-costs'
import { type Desk, type DeskLine, type DeskOrder, MANUAL_CHECKS, MANUAL_REASON, REJECT, type ScanResult, productTitle, receivedOf, unitsOf } from './model'
import type { Quantities } from './use-quantities'
import { ProductCard } from './card'
import { ActionsSheet, BarcodeSheet, ManualSheet, PriceSheet, type SheetKind } from './sheets'
import { StickyAction } from './steps'
import { UnitsPanel } from './units-panel'

type Feedback = { tone: 'ok' | 'warn' | 'danger'; text: string }
type Open = { kind: SheetKind; skuId: string } | null
/** How a product's identity was verified, until its quantity is confirmed. */
type Evidence = { barcode: string } | { manual: true }

const NOTE_TONE = {
  ok: { Icon: CheckCircle2, color: 'text-bw-emerald' },
  warn: { Icon: AlertTriangle, color: 'text-bw-amber' },
  danger: { Icon: XCircle, color: 'text-bw-danger' },
} as const

/**
 * The answer to the last scan or correction, as one quiet line under the scan field (never a box that pushes the cards down). A success fades
 * after a few seconds; a refusal stays until the next scan or until it is dismissed, so a wrong item is never missed. The live region stays
 * mounted so a screen reader announces each change.
 */
function ScanNote({ feedback, onDismiss }: { feedback: Feedback | null; onDismiss: () => void }) {
  const dismiss = React.useRef(onDismiss)
  dismiss.current = onDismiss
  React.useEffect(() => {
    if (feedback?.tone !== 'ok') return
    const timer = window.setTimeout(() => dismiss.current(), 4000)
    return () => window.clearTimeout(timer)
  }, [feedback])
  const tone = feedback ? NOTE_TONE[feedback.tone] : null
  return (
    <div className="min-h-5" role={feedback?.tone === 'danger' ? 'alert' : 'status'} aria-live={feedback?.tone === 'danger' ? 'assertive' : 'polite'}>
      {feedback && tone ? (
        <p className="flex items-start gap-1.5 text-bw-small text-bw-ink">
          <tone.Icon className={`mt-0.5 size-4 shrink-0 ${tone.color}`} aria-hidden />
          <span className="min-w-0 flex-1">{feedback.text}</span>
          {feedback.tone !== 'ok' ? (
            <button type="button" onClick={onDismiss} aria-label="إخفاء الرسالة" className="-my-1.5 grid size-9 shrink-0 place-items-center rounded-full text-bw-ink-subtle hover:bg-bw-sunken hover:text-bw-ink"><X className="size-4" aria-hidden /></button>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The preparation screen of one order: a card per product (photo, name, brand, size, required / prepared with − / +, the supplier discount,
 * and ⋯ for the rare actions) under one scan field. A scan counts at once and updates its card; nothing is asked per scan. The server decides
 * every scan (wrong, unknown, excess and not-yet-bought units change nothing). Cards stay on screen after verification so the discount can
 * still be completed before handoff.
 */
export function PrepProducts({ order, hubId, lastCosts, quantities, onOrder, onChanged }: {
  order: DeskOrder; hubId: string; lastCosts: Desk['lastCosts']; quantities: Quantities; onOrder: (order: DeskOrder) => void; onChanged: () => void
}) {
  const me = useMe()
  const isAdmin = me.roles.includes('ADMIN')
  const scanBox = React.useRef<HTMLDivElement>(null)
  const [code, setCode] = React.useState('')
  const [camera, setCamera] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const [sheet, setSheet] = React.useState<Open>(null)
  const [unknownCode, setUnknownCode] = React.useState('')
  const [identified, setIdentified] = React.useState<Record<string, Evidence>>({})
  const [confirming, setConfirming] = React.useState<string | null>(null)
  const queue = React.useRef<Promise<unknown>>(Promise.resolve())
  const refocus = React.useCallback(() => window.setTimeout(() => scanBox.current?.querySelector<HTMLInputElement>('input')?.focus(), 0), [])
  React.useEffect(() => { if (window.matchMedia('(min-width: 1024px)').matches) refocus() }, [refocus, order.orderId])

  const confirmVerification = useCommand(() => api<ScanResult>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/verify`, { method: 'POST' }))
  const units = unitsOf(order)
  const inHand = receivedOf(order)
  const scanning = order.stage !== 'packing'
  const waitingOnly = order.stage === 'waiting_purchase'

  // The identity evidence of a product, kept until its quantity is confirmed: the scanned code (the server re-checks it at confirmation) or a manual check.
  const identify = React.useCallback(async (barcode: string) => {
    try {
      const result = await api<ScanResult>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/identify`, { body: { clientScanId: newKey(), barcodeScanned: barcode } })
      if (result.order) onOrder(result.order)
      const line = result.order?.lines.find((l) => l.skuId === result.skuId)
      if (result.outcome === 'identified' && result.skuId) {
        setIdentified((all) => ({ ...all, [result.skuId as string]: { barcode } }))
        setFeedback({ tone: 'ok', text: `اتأكدت الهوية: ${line ? productTitle(line) : 'المنتج'}. راجع الكمية المتاحة وأكّد.` })
      } else {
        setFeedback({ tone: 'danger', text: REJECT[result.code ?? ''] ?? 'المسح اترفض.' })
        if (result.code === 'PRODUCT_IDENTITY_REVIEW_REQUIRED') setUnknownCode(barcode)
      }
      onChanged()
    } catch (error) {
      setFeedback({ tone: 'danger', text: (error as Error).message })
    } finally { refocus() }
  }, [hubId, order.orderId, onOrder, onChanged, refocus])

  // A scan identifies the product (once); it never counts a unit. Requests go one after another so an older answer can never land over a newer one.
  const onScan = (raw: string) => {
    const barcode = raw.trim()
    setCode('')
    if (!barcode) return
    queue.current = queue.current.then(() => identify(barcode))
  }

  // Confirms the available quantity of one product as ONE operation: the units not counted yet are received in a single request (the server checks the
  // identity evidence again), and any missing units are reported as a shortage for an Admin. Nothing is counted as received that was not confirmed.
  const confirmLine = async (line: DeskLine) => {
    const available = quantities.get(line)
    const toReceive = Math.max(available - line.received, 0)
    const missing = line.required - available
    const evidence = identified[line.skuId]
    if (toReceive > 0 && !evidence) return
    setConfirming(line.skuId)
    try {
      let latest: DeskOrder | null = null
      if (toReceive > 0 && evidence) {
        const result = await api<ScanResult>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/scan`, {
          body: { clientScanId: newKey(), quantity: toReceive, ...('barcode' in evidence ? { barcodeScanned: evidence.barcode } : { skuId: line.skuId, manualReason: MANUAL_REASON, manualChecks: MANUAL_CHECKS }) },
        })
        if (result.outcome === 'rejected') { setFeedback({ tone: 'danger', text: REJECT[result.code ?? ''] ?? 'التسجيل اترفض.' }); if (result.order) onOrder(result.order); return }
        latest = result.order
      }
      if (missing > 0) {
        const result = await api<{ order: DeskOrder | null }>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/lines/${line.orderItemId}/shortage`, { body: { clientRequestId: newKey(), missingQuantity: missing } })
        latest = result.order ?? latest
      }
      if (latest) onOrder(latest)
      setIdentified((all) => { const next = { ...all }; delete next[line.skuId]; return next })
      setFeedback(missing > 0
        ? { tone: 'warn', text: `${toReceive > 0 ? `اتسجّل ${toReceive}. ` : ''}اتسجّل نقص ${missing} من ${productTitle(line)} ومستني اعتماد الأدمن.` }
        : { tone: 'ok', text: `اتأكدت ${toReceive} من ${productTitle(line)}.` })
      onChanged()
    } catch (error) {
      setFeedback({ tone: 'danger', text: (error as Error).message })
    } finally { setConfirming(null); refocus() }
  }

  const decideShortage = useCommand((what: 'approve' | 'reject', line: DeskLine) => api<{ order: DeskOrder | null }>(
    `/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/shortages/${line.shortage!.adjustmentId}/${what}`, { body: {} }))
  const decideDialog = useDialog()
  const [deciding, setDeciding] = React.useState<{ what: 'approve' | 'reject'; line: DeskLine } | null>(null)
  const askDecision = (what: 'approve' | 'reject', line: DeskLine) => { setDeciding({ what, line }); decideDialog.open() }

  const sheetLine = sheet ? order.lines.find((l) => l.skuId === sheet.skuId) ?? null : null
  const close = () => { setSheet(null); refocus() }

  return (
    <div className="space-y-3 pb-16 lg:pb-0">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-bw-small font-semibold text-bw-ink-soft">{inHand >= units ? 'كل القطع اتجهزت' : 'اتجهز'}</p>
          <p className="text-bw-heading font-semibold tabular-nums text-bw-ink" dir="ltr" aria-label={`${inHand} من ${units} قطعة`}>{inHand}<span className="text-bw-ink-subtle">/{units}</span></p>
        </div>
        <Meter value={inHand} max={units} tone={inHand >= units ? 'emerald' : 'cobalt'} label={`اتجهز ${inHand} من ${units}`} />
      </div>

      {scanning ? (
        waitingOnly ? (
          <Flash tone="warn">الطلب ده مستني الشراء. أول ما المنتجات تتسجّل «اتشترت» تقدر تمسحها هنا. <Link href="/hub/buy-list" className="font-semibold underline underline-offset-4">المشتريات</Link></Flash>
        ) : (
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onScan(code) }}>
            <div ref={scanBox} className="relative min-w-0 flex-1">
              <label htmlFor="prep-scan" className="sr-only">امسح الباركود بالماسح أو اكتبه</label>
              <ScanLine className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-bw-ink-subtle" aria-hidden />
              <input id="prep-scan" dir="ltr" autoComplete="off" inputMode="numeric" value={code} placeholder="امسح الباركود أو اكتبه" onChange={(event) => setCode(event.target.value)}
                className="bw-control bw-code h-bw-touch w-full rounded-bw-field border border-bw-line-field bg-bw-surface ps-11 pe-3.5 text-start text-bw-heading text-bw-ink placeholder:text-bw-ink-subtle" />
            </div>
            <Button type="submit" size="touch" disabled={!code.trim()} aria-label="تسجيل القطعة">تسجيل</Button>
          </form>
        )
      ) : null}

      {camera && scanning ? <CameraScanner onClose={() => { setCamera(false); refocus() }} onCode={onScan} /> : null}
      <ScanNote feedback={feedback} onDismiss={() => setFeedback(null)} />

      <ul className="space-y-2" aria-label="منتجات الطلب">
        {[...order.lines].sort((a, b) => Number(a.received >= a.required) - Number(b.received >= b.required)).map((line) => (
          <ProductCard key={line.orderItemId} line={line} order={order} hubId={hubId} lastCosts={lastCosts} canPrice={isAdmin}
            quantity={quantities.get(line)} onQtyMinus={() => quantities.set(line, quantities.get(line) - 1)} onQtyPlus={() => quantities.set(line, quantities.get(line) + 1)}
            identified={!!identified[line.skuId]} confirming={confirming === line.skuId} onConfirm={() => { void confirmLine(line) }}
            onDecide={isAdmin && line.shortage ? (what) => askDecision(what, line) : null}
            onOrder={onOrder} onPick={(kind) => setSheet({ kind, skuId: line.skuId })} onMore={() => setSheet({ kind: 'menu', skuId: line.skuId })} />
        ))}
      </ul>

      <UnitsPanel order={order} hubId={hubId} onOrder={onOrder} onChanged={onChanged} />

      {order.stage === 'verifying' ? (
        <StickyAction>
          <Button size="touch" className="flex-1 sm:flex-none" loading={confirmVerification.pending} onClick={async () => { const r = await confirmVerification.execute(); if (r?.order) onOrder(r.order); onChanged() }}>تأكيد التجهيز</Button>
          {confirmVerification.error ? <Flash tone="danger">{confirmVerification.error.message}</Flash> : null}
        </StickyAction>
      ) : scanning && !waitingOnly ? (
        <StickyAction>
          <Button size="touch" variant={camera ? 'secondary' : 'primary'} className="flex-1 sm:flex-none" aria-pressed={camera} onClick={() => setCamera((on) => !on)}>
            <Camera className="size-5" aria-hidden />{camera ? 'اقفل الكاميرا' : 'امسح بالكاميرا'}
          </Button>
          {inHand < units ? <span className="text-bw-small text-bw-ink-soft sm:ms-2">فاضل <span className="tabular-nums text-bw-ink">{units - inHand}</span> قطعة</span> : null}
        </StickyAction>
      ) : !scanning ? (
        <p className="flex items-center gap-2 text-bw-small font-semibold text-bw-ink"><CheckCircle2 className="size-5 text-bw-emerald" aria-hidden />{units} قطعة اتجهزت. كمّل التغليف والطباعة والتسليم من الشريط اللي فوق.</p>
      ) : null}

      {sheet && sheetLine ? (
        sheet.kind === 'menu' ? (
          <ActionsSheet line={sheetLine} canPrice={isAdmin} onClose={close} onPick={(kind) => setSheet({ kind, skuId: sheetLine.skuId })} />
        ) : sheet.kind === 'manual' ? (
          <ManualSheet line={sheetLine} hubId={hubId} orderId={order.orderId} onClose={close}
            onIdentified={(next) => {
              if (next) onOrder(next)
              setIdentified((all) => ({ ...all, [sheetLine.skuId]: { manual: true } }))
              setFeedback({ tone: 'ok', text: `اتأكدت الهوية بالعين: ${productTitle(sheetLine)}. راجع الكمية المتاحة وأكّد.` })
              onChanged()
            }} />
        ) : sheet.kind === 'barcode' ? (
          <BarcodeSheet line={sheetLine} hubId={hubId} orderId={order.orderId} canCorrect={isAdmin} initialCode={sheetLine.barcode ? '' : unknownCode} onClose={close}
            onDone={(next) => { if (next) onOrder(next); setUnknownCode(''); setFeedback({ tone: 'ok', text: 'اتسجّل الباركود للمنتج. امسح القطعة دلوقتي.' }); onChanged() }} />
        ) : (
          <PriceSheet line={sheetLine} onClose={close} />
        )
      ) : null}

      <Dialog dialogRef={decideDialog.ref} title={deciding?.what === 'approve' ? 'اعتماد تعديل الكمية' : 'رفض تقرير النقص'}
        footer={<>
          <Button variant="secondary" onClick={decideDialog.close}>رجوع</Button>
          <Button variant={deciding?.what === 'approve' ? 'danger' : 'primary'} loading={decideShortage.pending} onClick={async () => {
            if (!deciding) return
            const result = await decideShortage.execute(deciding.what, deciding.line)
            if (result) {
              if (result.order) onOrder(result.order)
              setFeedback({ tone: 'ok', text: deciding.what === 'approve' ? 'اتعدّلت الكمية والمبالغ.' : 'اترفض تقرير النقص. الطلب زي ما هو.' })
              decideDialog.close(); onChanged()
            }
          }}>{deciding?.what === 'approve' ? 'اعتمد التعديل' : 'ارفض'}</Button>
        </>}>
        {deciding ? (
          <div className="space-y-3 text-bw-small">
            <p className="font-semibold text-bw-ink"><bdi>{productTitle(deciding.line)}</bdi></p>
            <p className="text-bw-ink-soft">اتطلب <bdi className="tabular-nums" dir="ltr">{deciding.line.ordered}</bdi> · ناقص <bdi className="tabular-nums" dir="ltr">{deciding.line.shortage?.missing}</bdi> · هتبقى <bdi className="tabular-nums" dir="ltr">{deciding.line.shortage?.newQuantity}</bdi></p>
            {deciding.what === 'approve' && deciding.line.shortage?.amounts.codBefore != null ? (
              <p className="rounded-bw-field bg-bw-sunken/60 px-3 py-2 text-bw-ink">المبلغ المطلوب تحصيله بيتغيّر من <bdi className="tabular-nums">{egp(deciding.line.shortage.amounts.codBefore)}</bdi> لـ <bdi className="font-semibold tabular-nums">{egp(deciding.line.shortage.amounts.codAfter ?? 0)}</bdi>. رسوم التوصيل والخصومات على مستوى الطلب مابتتحسبش من جديد. الطلب الأصلي بيتحفظ للمراجعة.</p>
            ) : deciding.what === 'reject' ? <p className="text-bw-ink-soft">الطلب هيفضل بكميته الأصلية، وتكمّل البحث عن القطع الناقصة.</p> : null}
            {decideShortage.error ? <Flash tone="danger">{decideShortage.error.message}</Flash> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
