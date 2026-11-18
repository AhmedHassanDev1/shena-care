'use client'

import * as React from 'react'
import Link from 'next/link'
import { Camera, CheckCircle2, ScanLine } from 'lucide-react'
import { Button, Field } from '@/components/bw/primitives'
import { Flash, Meter } from '@/components/bw/ops'
import { CameraScanner } from '@/components/workspace/camera-scanner'
import { useMe } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { useCommand } from '@/lib/use-api'
import { type Desk, type DeskLine, type DeskOrder, REJECT, type ScanResult, productTitle, receivedOf, unitsOf } from './model'
import { ProductCard } from './card'
import { ActionsSheet, BarcodeSheet, ManualSheet, PriceSheet, type SheetKind } from './sheets'
import { StickyAction } from './steps'
import { UnitsPanel } from './units-panel'

type Feedback = { tone: 'ok' | 'warn' | 'danger'; text: string }
type Open = { kind: SheetKind; skuId: string } | null

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
    } finally { setBusy(false) }
  }

  const sheetLine = sheet ? order.lines.find((l) => l.skuId === sheet.skuId) ?? null : null
  const close = () => { setSheet(null); refocus() }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <p className="text-bw-heading font-semibold text-bw-ink">{inHand >= units ? 'كل القطع اتجهزت' : 'امسح كل قطعة'}</p>
          <p className="text-bw-heading font-semibold tabular-nums text-bw-ink" dir="ltr" aria-label={`${inHand} من ${units} قطعة`}>{inHand}<span className="text-bw-ink-subtle">/{units}</span></p>
        </div>
        <Meter value={inHand} max={units} tone={inHand >= units ? 'emerald' : 'cobalt'} label={`اتجهز ${inHand} من ${units}`} className="h-2" />
      </div>

      {scanning ? (
        waitingOnly ? (
          <Flash tone="warn">الطلب ده مستني الشراء. أول ما المنتجات تتسجّل «اتشترت» تقدر تمسحها هنا. <Link href="/hub/buy-list" className="font-semibold underline underline-offset-4">المشتريات</Link></Flash>
        ) : (
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onScan(code) }}>
            <div ref={scanBox} className="min-w-0 flex-1">
              <Field label="امسح الباركود بالماسح أو اكتبه" ltr autoComplete="off" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} className="[&_input]:h-bw-touch [&_input]:text-bw-body" />
            </div>
            <Button type="submit" size="touch" className="self-end" disabled={!code.trim()} aria-label="تسجيل القطعة"><ScanLine className="size-5" aria-hidden /><span className="hidden sm:inline">تسجيل</span></Button>
          </form>
        )
      ) : null}

      {camera && scanning ? <CameraScanner onClose={() => { setCamera(false); refocus() }} onCode={onScan} /> : null}
      {feedback ? <Flash tone={feedback.tone}>{feedback.text}</Flash> : null}
      {unknownCode && feedback?.tone === 'danger' ? (
        <p className="text-[12px] text-bw-ink-soft">لو القطعة فعلًا من الطلب، افتح <strong>⋯</strong> على المنتج واختار «إضافة باركود» والرقم هيتعبّى لوحده.</p>
      ) : null}

      <ul className="space-y-3" aria-label="منتجات الطلب">
        {[...order.lines].sort((a, b) => Number(a.received >= a.required) - Number(b.received >= b.required)).map((line) => (
          <ProductCard key={line.orderItemId} line={line} order={order} hubId={hubId} lastCosts={lastCosts} busy={busy}
            plus={plusReason(line)} minus={minusReason(line)} onPlus={() => setSheet({ kind: 'manual', skuId: line.skuId })} onMinus={() => { void minus(line) }}
            onOrder={onOrder} onMore={() => setSheet({ kind: 'menu', skuId: line.skuId })} />
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
            onDone={(next) => { if (next) onOrder(next); setFeedback({ tone: 'ok', text: `اتسجّلت ${productTitle(sheetLine)} بتحقق يدوي.` }); onChanged() }} />
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
