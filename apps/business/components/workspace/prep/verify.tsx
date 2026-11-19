'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, Camera, CheckCircle2, ScanLine, X, XCircle } from 'lucide-react'
import { Button } from '@/components/bw/primitives'
import { Flash, Meter } from '@/components/bw/ops'
import { CameraScanner } from '@/components/workspace/camera-scanner'
import { useMe } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { useCommand } from '@/lib/use-api'
import { type Desk, type DeskLine, type DeskOrder, MANUAL_CHECKS, MANUAL_REASON, REJECT, type ScanResult, productTitle, receivedOf, unitsOf } from './model'
import { registerUnits } from './register'
import { ProductCard } from './card'
import { ActionsSheet, BarcodeSheet, ManualSheet, PriceSheet, type SheetKind } from './sheets'
import { StickyAction } from './steps'
import { UnitsPanel } from './units-panel'

type Feedback = { tone: 'ok' | 'warn' | 'danger'; text: string }
type Open = { kind: SheetKind; skuId: string } | null

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
export function PrepProducts({ order, hubId, lastCosts, onOrder, onChanged }: {
  order: DeskOrder; hubId: string; lastCosts: Desk['lastCosts']; onOrder: (order: DeskOrder) => void; onChanged: () => void
}) {
  const me = useMe()
  const isAdmin = me.roles.includes('ADMIN')
  const scanBox = React.useRef<HTMLDivElement>(null)
  const [code, setCode] = React.useState('')
  const [camera, setCamera] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const [sheet, setSheet] = React.useState<Open>(null)
  const [unknownCode, setUnknownCode] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const queue = React.useRef<Promise<unknown>>(Promise.resolve())
  const refocus = React.useCallback(() => window.setTimeout(() => scanBox.current?.querySelector<HTMLInputElement>('input')?.focus(), 0), [])
  React.useEffect(() => { if (window.matchMedia('(min-width: 1024px)').matches) refocus() }, [refocus, order.orderId])

  const confirmVerification = useCommand(() => api<ScanResult>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/verify`, { method: 'POST' }))
  const units = unitsOf(order)
  const inHand = receivedOf(order)
  const scanning = order.stage !== 'packing'
  const waitingOnly = order.stage === 'waiting_purchase'

  const apply = (result: ScanResult, barcode: string | null) => {
    if (result.order) onOrder(result.order)
    const updated = result.order?.lines.find((l) => l.skuId === result.skuId)
    if (result.outcome === 'received') {
      setFeedback({ tone: 'ok', text: `اتسجّلت ${updated ? productTitle(updated) : 'قطعة'} — ${updated?.received ?? ''} من ${updated?.required ?? ''}${result.order?.stage === 'packing' ? '. الطلب كامل.' : ''}`.trim() })
    } else {
      setFeedback({ tone: 'danger', text: REJECT[result.code ?? ''] ?? 'المسح اترفض.' })
      if (result.code === 'PRODUCT_IDENTITY_REVIEW_REQUIRED' && barcode) setUnknownCode(barcode)
    }
    onChanged()
  }

  // Scans are sent one after another so a fast scanner can never apply an older answer over a newer one.
  const enqueue = React.useCallback((barcode: string) => {
    queue.current = queue.current.then(async () => {
      setBusy(true)
      try {
        const result = await api<ScanResult>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/scan`, { body: { clientScanId: newKey(), barcodeScanned: barcode } })
        apply(result, barcode)
      } catch (error) {
        setFeedback({ tone: 'danger', text: (error as Error).message })
      } finally { setBusy(false); refocus() }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId, order.orderId, onOrder, onChanged, refocus])

  const onScan = (raw: string) => {
    const barcode = raw.trim()
    setCode('')
    if (barcode) enqueue(barcode)
  }

  const minusReason = (line: DeskLine) => {
    if (line.received <= 0) return 'مفيش قطع متسجّلة'
    return order.units.some((u) => u.skuId === line.skuId && u.correctable) ? null : 'اتطبع أو اتغلّف — مايتصحّحش'
  }
  const plusReason = (line: DeskLine) => {
    if (line.received >= line.required) return 'الكمية كملت'
    if (!scanning) return 'الطلب اتأكد خلاص'
    if (line.purchased <= line.received) return 'القطعة دي لسه ماتسجّلتش «اتشترت»'
    return null
  }
  const minus = async (line: DeskLine) => {
    const unit = [...order.units].reverse().find((u) => u.skuId === line.skuId && u.correctable)
    if (!unit) return
    setBusy(true)
    try {
      const result = await api<{ order: DeskOrder | null }>(`/fulfillment/locations/${hubId}/desk/receipts/${unit.receiptId}/reverse`, {
        body: { idempotencyKey: newKey(), reason: 'WRONG_UNIT_SCANNED', note: 'تراجع عن القطعة من شاشة التجهيز' },
      })
      if (result.order) onOrder(result.order)
      setFeedback({ tone: 'warn', text: `اتشالت قطعة من ${productTitle(line)}. الكمية رجعت تتمسح من جديد.` })
      onChanged()
    } catch (error) {
      setFeedback({ tone: 'danger', text: (error as Error).message })
    } finally { setBusy(false); if (window.matchMedia('(min-width: 1024px)').matches) refocus() }
  }

  // "+" fills the line in one tap, no window: the default quantity is what is still required (never more than was bought). Each unit is its own
  // manual-verification request, decided by the server one by one; whatever it did not confirm is simply not counted.
  const fill = async (line: DeskLine) => {
    const room = Math.min(line.required, line.purchased) - line.received
    if (room <= 0) return
    setBusy(true)
    let failure: string | null = null
    try {
      const outcome = await registerUnits<DeskOrder>(room, async () => {
        try {
          const result = await api<ScanResult>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/scan`, {
            body: { clientScanId: newKey(), skuId: line.skuId, manualReason: MANUAL_REASON, manualChecks: MANUAL_CHECKS },
          })
          return { refusal: result.outcome === 'rejected' ? REJECT[result.code ?? ''] ?? 'التسجيل اترفض.' : null, order: result.order }
        } catch (error) { failure = (error as Error).message; return undefined }
      })
      if (outcome.last) onOrder(outcome.last)
      const problem = outcome.refusal ?? failure
      // Silent when everything was recorded: the counter is the confirmation. A refusal or failure is always said, with what did get recorded.
      setFeedback(problem ? { tone: outcome.done > 0 ? 'warn' : 'danger', text: `${outcome.done > 0 ? `اتسجّل ${outcome.done} بس من ${room}. ` : ''}${problem}` } : null)
      onChanged()
    } finally { setBusy(false); if (window.matchMedia('(min-width: 1024px)').matches) refocus() }
  }

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
          <ProductCard key={line.orderItemId} line={line} order={order} hubId={hubId} lastCosts={lastCosts} busy={busy} canPrice={isAdmin}
            plus={plusReason(line)} minus={minusReason(line)} onPlus={() => { void fill(line) }} onMinus={() => { void minus(line) }}
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
            onDone={(next, recorded, requested) => {
              if (next) onOrder(next)
              const what = recorded > 1 ? `${recorded} قطع من ${productTitle(sheetLine)}` : productTitle(sheetLine)
              setFeedback(recorded < requested
                ? { tone: 'warn', text: `اتسجّل ${recorded} بس من ${requested}: ${what}. الباقي ماتسجّلش.` }
                : { tone: 'ok', text: `اتسجّلت ${what} بتحقق يدوي.` })
              onChanged()
            }} />
        ) : sheet.kind === 'barcode' ? (
          <BarcodeSheet line={sheetLine} hubId={hubId} orderId={order.orderId} canCorrect={isAdmin} initialCode={sheetLine.barcode ? '' : unknownCode} onClose={close}
            onDone={(next) => { if (next) onOrder(next); setUnknownCode(''); setFeedback({ tone: 'ok', text: 'اتسجّل الباركود للمنتج. امسح القطعة دلوقتي.' }); onChanged() }} />
        ) : (
          <PriceSheet line={sheetLine} onClose={close} />
        )
      ) : null}
    </div>
  )
}
