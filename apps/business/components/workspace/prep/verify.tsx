'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, Camera, ScanLine, Undo2 } from 'lucide-react'
import { Button, Field } from '@/components/bw/primitives'
import { Flash, Meter } from '@/components/bw/ops'
import { CameraScanner } from '@/components/workspace/camera-scanner'
import { costFrom, egp } from '@/components/workspace/buy-costs'
import { ApiError, api, newKey } from '@/lib/api'
import { useCommand } from '@/lib/use-api'
import { type Desk, type DeskLine, type DeskOrder, REJECT, type ScanResult, productMeta, productTitle, receivedOf, unitsOf } from './model'
import { ProductRow, Thumb } from './product'
import { StickyAction } from './steps'
import { UnitsPanel } from './units-panel'

const UNDO_MS = 4000
const ALL_CHECKS = ['brand', 'variant', 'size', 'pack']
/** What the operator confirmed for a SKU in this sitting. `deferKey` = the purchase whose cost was knowingly left for later. */
export type PackInfo = Record<string, { expiryDate: string; lotNumber: string; listPrice: string; discount: string; deferKey?: string }>
type Pending = { id: string; barcode: string; line: DeskLine; timer: number }
type Feedback = { tone: 'ok' | 'warn' | 'danger'; text: string }
type Mode =
  | { kind: 'scan' }
  | { kind: 'info'; line: DeskLine; barcode: string | null; manual?: { skuId: string; reason: string } }
  | { kind: 'exception'; line: DeskLine | null; code: string }

/** Expiry is always needed once per SKU; the cost is asked while the next unit's purchase has none recorded (unless deferred). */
const needsInfo = (line: DeskLine, info: PackInfo[string] | undefined) => !info || (!!line.cost && !line.cost.recorded && info.deferKey !== line.cost.acquireKey && !costFrom(info.listPrice, info.discount))
const costBody = (line: DeskLine | null, info: PackInfo[string] | undefined) => {
  const typed = info && line?.cost && !line.cost.recorded && info.deferKey !== line.cost.acquireKey ? costFrom(info.listPrice, info.discount) : null
  return typed ? { cost: { listUnitPrice: typed.listUnitPrice, discountPerUnit: typed.discountPerUnit } } : {}
}

/**
 * Step 1 — verify the products. Scanning is the one primary action: a hardware scanner types into the focused field, the camera
 * (phone) feeds the same path, and the server decides every scan (wrong, unknown, excess and not-yet-bought units change nothing).
 * Anything the scan cannot do goes through one guided exception flow instead of a form.
 */
export function VerifyStep({ order, hubId, lastLots, lastCosts, packInfo, setPackInfo, onOrder, onChanged }: {
  order: DeskOrder; hubId: string; lastLots: Desk['lastLots']; lastCosts: Desk['lastCosts']
  packInfo: PackInfo; setPackInfo: React.Dispatch<React.SetStateAction<PackInfo>>
  onOrder: (order: DeskOrder) => void; onChanged: () => void
}) {
  const scanBox = React.useRef<HTMLDivElement>(null)
  const [code, setCode] = React.useState('')
  const [mode, setMode] = React.useState<Mode>({ kind: 'scan' })
  const [camera, setCamera] = React.useState(false)
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const lastBarcode = React.useRef<string | null>(null)
  const pendingRef = React.useRef<Pending | null>(null)
  pendingRef.current = pending
  const refocus = React.useCallback(() => window.setTimeout(() => scanBox.current?.querySelector<HTMLInputElement>('input')?.focus(), 0), [])
  React.useEffect(() => { if (window.matchMedia('(min-width: 1024px)').matches) refocus() }, [refocus, order.orderId])

  const send = useCommand((body: Record<string, unknown>) => api<ScanResult>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/scan`, { body }))
  const confirmVerification = useCommand(() => api<ScanResult>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/verify`, { method: 'POST' }))

  const units = unitsOf(order)
  const inHand = receivedOf(order)
  const incomplete = order.lines.filter((line) => line.received < line.required)

  const apply = (result: ScanResult | undefined, line: DeskLine | null, barcode: string | null) => {
    if (!result) return
    if (result.order) onOrder(result.order)
    const updated = result.order?.lines.find((l) => l.skuId === (result.skuId ?? line?.skuId))
    if (result.outcome === 'received') {
      setFeedback({ tone: 'ok', text: `اتسجّلت قطعة ${updated ? productTitle(updated) : ''} — ${updated?.received ?? ''} من ${updated?.required ?? ''}${result.order?.stage === 'packing' ? '. الطلب كامل.' : ''}`.trim() })
    } else {
      setFeedback({ tone: 'danger', text: REJECT[result.code ?? ''] ?? 'المسح اترفض.' })
      if (result.code === 'PRODUCT_IDENTITY_REVIEW_REQUIRED' && barcode) setMode({ kind: 'exception', line: null, code: barcode })
    }
    onChanged()
  }

  const commit = React.useCallback(async (barcode: string | null, line: DeskLine | null, manual?: { skuId: string; reason: string }) => {
    const info = line ? packInfo[line.skuId] : undefined
    const result = await send.execute({
      clientScanId: newKey(),
      ...(barcode ? { barcodeScanned: barcode } : { skuId: manual!.skuId, manualReason: manual!.reason, manualChecks: ALL_CHECKS }),
      ...(info ? { expiryDate: info.expiryDate, ...(info.lotNumber ? { lotNumber: info.lotNumber } : {}), ...costBody(line, info) } : {}),
    })
    apply(result, line, barcode)
    refocus()
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packInfo, send, onOrder, onChanged, refocus])

  // The API's EXPIRY_REQUIRED (e.g. an alias barcode) asks for that SKU's expiry, then the scan is retried.
  React.useEffect(() => {
    const error = send.error as ApiError | null
    if (!error) return
    if (error.code === 'EXPIRY_REQUIRED') {
      const line = order.lines.find((l) => l.skuId === ((error.details?.skuId as string | undefined) ?? null))
      if (line) setMode({ kind: 'info', line, barcode: lastBarcode.current })
    } else setFeedback({ tone: 'danger', text: error.message })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send.error])

  const flush = React.useCallback(async () => {
    const held = pendingRef.current
    if (!held) return
    window.clearTimeout(held.timer)
    setPending(null)
    await commit(held.barcode, held.line)
  }, [commit])

  const onScan = async (raw: string) => {
    const barcode = raw.trim()
    setCode('')
    if (!barcode) return
    lastBarcode.current = barcode
    await flush()
    const line = order.lines.find((l) => l.barcode === barcode) ?? null
    if (line && line.received < line.purchased && needsInfo(line, packInfo[line.skuId])) { setMode({ kind: 'info', line, barcode }); return }
    if (line && line.received < line.purchased) {
      // A recognised unit is held for a few seconds so a double read or a slip can be undone before it counts.
      const timer = window.setTimeout(() => { void flush() }, UNDO_MS)
      setPending({ id: newKey(), barcode, line, timer })
      setFeedback(null)
      refocus()
      return
    }
    // Anything else (complete line, not bought, unknown or alias code) is decided by the API at once; nothing is counted if it refuses.
    await commit(barcode, line)
  }
  const undo = () => {
    if (!pending) return
    window.clearTimeout(pending.timer)
    setPending(null)
    setFeedback({ tone: 'warn', text: 'اتلغى المسح الأخير، مااتحسبش.' })
    refocus()
  }
  React.useEffect(() => () => { if (pendingRef.current) window.clearTimeout(pendingRef.current.timer) }, [])

  const waitingOnly = order.stage === 'waiting_purchase'

  // ── Guided exception and per-SKU info replace the scan area: one thing on screen at a time ──
  if (mode.kind === 'info') {
    const { line, barcode, manual } = mode
    return (
      <PackInfoForm line={line} suggestion={lastLots[line.skuId] ?? null} costSuggestion={lastCosts[line.skuId] ?? null} current={packInfo[line.skuId] ?? null}
        onCancel={() => { setMode({ kind: 'scan' }); refocus() }}
        onConfirm={async (info) => {
          setPackInfo((all) => ({ ...all, [line.skuId]: info }))
          setMode({ kind: 'scan' })
          // State updates are async; send this one scan with the confirmed values directly.
          const result = await send.execute({ clientScanId: newKey(), expiryDate: info.expiryDate, ...(info.lotNumber ? { lotNumber: info.lotNumber } : {}), ...costBody(line, info),
            ...(barcode ? { barcodeScanned: barcode } : { skuId: manual!.skuId, manualReason: manual!.reason, manualChecks: ALL_CHECKS }) })
          apply(result, line, barcode)
          refocus()
        }} />
    )
  }
  if (mode.kind === 'exception') {
    return (
      <ExceptionFlow order={order} hubId={hubId} initialLine={mode.line} initialCode={mode.code}
        onCancel={() => { setMode({ kind: 'scan' }); refocus() }}
        onManual={async (line, reason) => {
          const manual = { skuId: line.skuId, reason }
          if (needsInfo(line, packInfo[line.skuId])) { setMode({ kind: 'info', line, barcode: null, manual }); return }
          setMode({ kind: 'scan' })
          await commit(null, line, manual)
        }}
        onRegistered={async (barcode, updated) => {
          setMode({ kind: 'scan' })
          if (updated) onOrder(updated)
          setFeedback({ tone: 'ok', text: 'اتسجّل الباركود للمنتج. امسح القطعة دلوقتي.' })
          onChanged()
          await onScan(barcode)
        }} />
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <p className="text-bw-heading font-semibold text-bw-ink">امسح كل قطعة</p>
          <p className="text-bw-heading font-semibold tabular-nums text-bw-ink" dir="ltr" aria-label={`${inHand} من ${units} قطعة`}>{inHand}<span className="text-bw-ink-subtle">/{units}</span></p>
        </div>
        <Meter value={inHand + (pending ? 1 : 0)} max={units} tone={inHand >= units ? 'emerald' : 'cobalt'} label={`اتمسح ${inHand} من ${units}`} className="h-2" />
      </div>

      {waitingOnly ? (
        <Flash tone="warn">الطلب ده مستني الشراء. أول ما المنتجات تتسجّل «اتشترت» تقدر تمسحها هنا. <Link href="/hub/buy-list" className="font-semibold underline underline-offset-4">المشتريات</Link></Flash>
      ) : (
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void onScan(code) }}>
          <div ref={scanBox} className="min-w-0 flex-1">
            <Field label="امسح الباركود بالماسح أو اكتبه" ltr autoComplete="off" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} className="[&_input]:h-bw-touch [&_input]:text-bw-body" />
          </div>
          <Button type="submit" size="touch" className="self-end" loading={send.pending} disabled={!code.trim()} aria-label="تسجيل القطعة"><ScanLine className="size-5" aria-hidden /><span className="hidden sm:inline">تسجيل</span></Button>
        </form>
      )}

      {camera ? <CameraScanner onClose={() => { setCamera(false); refocus() }} onCode={(scanned) => { void onScan(scanned) }} /> : null}
      {pending ? (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <Flash tone="ok">قطعة <bdi>{productTitle(pending.line)}</bdi> بتتسجّل خلال ثواني</Flash>
          <Button variant="secondary" size="sm" onClick={undo}><Undo2 className="size-4" aria-hidden />تراجع</Button>
        </div>
      ) : null}
      {feedback ? <Flash tone={feedback.tone}>{feedback.text}</Flash> : null}

      <ul className="divide-y divide-bw-line overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface" aria-label="منتجات الطلب">
        {[...order.lines].sort((a, b) => Number(a.received >= a.required) - Number(b.received >= b.required)).map((line) => (
          <ProductRow key={line.orderItemId} line={line} pending={pending?.line.skuId === line.skuId ? 1 : 0}>
            {line.received < line.required && !waitingOnly && line.purchased > line.received
              ? <button type="button" className="mt-1 min-h-8 text-[12px] font-semibold text-bw-cobalt underline-offset-4 hover:underline" onClick={() => setMode({ kind: 'exception', line, code: '' })}>مش بيتمسح؟</button> : null}
          </ProductRow>
        ))}
      </ul>

      <UnitsPanel order={order} hubId={hubId} onOrder={onOrder} onChanged={onChanged} />

      {order.stage === 'verifying' ? (
        <StickyAction>
          <Button size="touch" className="flex-1 sm:flex-none" loading={confirmVerification.pending} onClick={async () => { const r = await confirmVerification.execute(); if (r?.order) onOrder(r.order); onChanged() }}>تأكيد التجهيز</Button>
          {confirmVerification.error ? <Flash tone="danger">{confirmVerification.error.message}</Flash> : null}
        </StickyAction>
      ) : !waitingOnly ? (
        <StickyAction>
          <Button size="touch" variant={camera ? 'secondary' : 'primary'} className="flex-1 sm:flex-none" aria-pressed={camera} onClick={() => setCamera((on) => !on)}>
            <Camera className="size-5" aria-hidden />{camera ? 'اقفل الكاميرا' : 'امسح بالكاميرا'}
          </Button>
          {incomplete.length === 0 ? null : <span className="text-bw-small text-bw-ink-soft sm:ms-2">فاضل <span className="tabular-nums text-bw-ink">{units - inHand}</span> قطعة</span>}
        </StickyAction>
      ) : null}
    </div>
  )
}

/* ── Guided exception: pick the product → say what is wrong → confirm the pack → done ─────────────── */

type Problem = 'unreadable' | 'nocode'

function ExceptionFlow({ order, hubId, initialLine, initialCode, onCancel, onManual, onRegistered }: {
  order: DeskOrder; hubId: string; initialLine: DeskLine | null; initialCode: string; onCancel: () => void
  onManual: (line: DeskLine, reason: string) => void; onRegistered: (barcode: string, order: DeskOrder | null) => void
}) {
  const open = order.lines.filter((l) => l.received < l.required && l.purchased > l.received)
  const [line, setLine] = React.useState<DeskLine | null>(initialLine ?? (open.length === 1 ? open[0] : null))
  const [problem, setProblem] = React.useState<Problem | null>(initialCode ? 'nocode' : null)
  const [same, setSame] = React.useState(false)
  const [code, setCode] = React.useState(initialCode)
  const key = React.useRef(newKey())
  const register = useCommand((body: Record<string, unknown>) => api<{ registered: boolean; barcode: string; order: DeskOrder | null }>(`/fulfillment/locations/${hubId}/desk/orders/${order.orderId}/register-barcode`, { body }))
  const regError = register.error as ApiError | null
  const regMessage = regError ? ({
    INVALID_BARCODE: 'الرقم ده مش باركود صحيح. اقراه تاني من العبوة.',
    BARCODE_ALREADY_USED: 'الباركود ده تابع لمنتج تاني. رجّع القطعة واطلب مراجعة الكتالوج.',
    SKU_ALREADY_HAS_BARCODE: 'المنتج ده ليه باركود متسجّل. باركود مختلف بيتراجع من الكتالوج.',
    WRONG_ITEM: 'المنتج ده مش في الطلب.',
  } as Record<string, string>)[regError.code ?? ''] ?? regError.message : null
  const eligibleForCode = !!line && !line.barcode

  const title = !line ? 'أنهي منتج المشكلة فيه؟' : !problem ? 'إيه المشكلة؟' : 'قارن العبوة بالصورة'
  return (
    <section aria-label="مشكلة في المسح" className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="رجوع" onClick={() => { if (problem && !initialCode) setProblem(null); else if (line && !initialLine && open.length > 1) setLine(null); else onCancel() }}
          className="grid size-bw-control place-items-center rounded-full text-bw-ink-soft hover:bg-bw-sunken"><ArrowRight className="size-5" aria-hidden /></button>
        <h3 className="text-bw-heading font-semibold text-bw-ink">{title}</h3>
      </div>

      {!line ? (
        <ul className="divide-y divide-bw-line overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface">
          {(initialCode ? order.lines.filter((l) => !l.barcode && l.received < l.required) : open).map((l) => (
            <li key={l.orderItemId}>
              <button type="button" onClick={() => setLine(l)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-bw-sunken">
                <Thumb line={l} /><span className="min-w-0"><span className="block truncate text-bw-body font-semibold text-bw-ink"><bdi>{productTitle(l)}</bdi></span><span className="block truncate text-bw-small text-bw-ink-soft"><bdi>{productMeta(l)}</bdi></span></span>
              </button>
            </li>
          ))}
          {(initialCode ? order.lines.filter((l) => !l.barcode && l.received < l.required) : open).length === 0 ? <li className="px-4 py-4 text-bw-small text-bw-ink-soft">كل منتجات الطلب ليها باركود متسجّل، فالباركود ده مش بتاع أي منتج هنا. رجّع القطعة مكانها.</li> : null}
        </ul>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-3">
            <Thumb line={line} size="lg" />
            <div className="min-w-0"><p className="text-bw-body font-semibold text-bw-ink"><bdi>{productTitle(line)}</bdi></p><p className="text-bw-small text-bw-ink-soft"><bdi>{productMeta(line)}</bdi></p></div>
          </div>

          {!problem ? (
            <div className="grid gap-2">
              <Button size="touch" variant="secondary" className="justify-start" onClick={() => setProblem('unreadable')}>الباركود مش بيتقري أو مطموس</Button>
              {eligibleForCode ? <Button size="touch" variant="secondary" className="justify-start" onClick={() => setProblem('nocode')}>المنتج ملوش باركود متسجّل — هسجّله</Button> : null}
            </div>
          ) : (
            <form className="space-y-4" onSubmit={async (event) => {
              event.preventDefault()
              if (problem === 'unreadable') { onManual(line, 'الباركود مش بيتقري أو مطموس'); return }
              const result = await register.execute({ clientScanId: key.current, skuId: line.skuId, barcode: code.trim(), checks: ALL_CHECKS,
                note: 'المنتج من غير باركود في الكتالوج؛ العبوة اتقارنت بالصنف في الطلب' })
              if (result?.registered) onRegistered(result.barcode, result.order)
            }}>
              {problem === 'nocode' ? (
                <Field label="الباركود المطبوع على العبوة" ltr inputMode="numeric" autoComplete="off" autoFocus value={code} onChange={(e) => { setCode(e.target.value.replace(/\s/g, '')); key.current = newKey() }}
                  hint="٨ أو ١٢ أو ١٣ أو ١٤ رقم. بيتسجّل للمنتج ده بس وبيتحفظ باسمك." className="[&_input]:h-bw-touch" />
              ) : null}
              <label className="flex cursor-pointer items-start gap-3 rounded-bw-card border border-bw-line-field p-3 text-bw-body text-bw-ink">
                <input type="checkbox" className="mt-1 size-5" checked={same} onChange={(e) => setSame(e.target.checked)} />
                <span>العبوة اللي في إيدي هي نفس المنتج ده بالظبط: الماركة والنوع والحجم والعبوة.</span>
              </label>
              {regMessage ? <Flash tone="danger">{regMessage}</Flash> : null}
              <StickyAction>
                <Button type="submit" size="touch" className="flex-1 sm:flex-none" loading={register.pending} disabled={!same || (problem === 'nocode' && code.trim().length < 8)}>
                  {problem === 'nocode' ? 'سجّل الباركود وكمّل' : 'أكّد وسجّل القطعة'}
                </Button>
                <Button type="button" size="touch" variant="secondary" onClick={onCancel}>إلغاء</Button>
              </StickyAction>
            </form>
          )}
        </>
      )}
    </section>
  )
}

/* ── First unit of a product: expiry on the pack, optional lot, and the actual purchase cost ─────── */

function PackInfoForm({ line, suggestion, costSuggestion, current, onConfirm, onCancel }: {
  line: DeskLine; suggestion: Desk['lastLots'][string] | null; costSuggestion: Desk['lastCosts'][string] | null; current: PackInfo[string] | null
  onConfirm: (info: PackInfo[string]) => void; onCancel: () => void
}) {
  const needsCost = !!line.cost && !line.cost.recorded
  const [expiry, setExpiry] = React.useState(current?.expiryDate ?? suggestion?.expiryDate ?? '')
  const [lot, setLot] = React.useState(current?.lotNumber ?? suggestion?.lotNumber ?? '')
  const [listPrice, setListPrice] = React.useState(current?.listPrice ?? costSuggestion?.listUnitPrice ?? '')
  const [discount, setDiscount] = React.useState(current?.discount ?? (costSuggestion && Number(costSuggestion.discountPerUnit) > 0 ? costSuggestion.discountPerUnit : ''))
  const [defer, setDefer] = React.useState(false)
  const typed = costFrom(listPrice, discount)
  const costInvalid = needsCost && !defer && !typed
  return (
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      if (!expiry || costInvalid) return
      onConfirm({ expiryDate: expiry, lotNumber: lot.trim(), listPrice: needsCost && !defer ? listPrice : '', discount: needsCost && !defer ? discount : '', ...(needsCost && defer ? { deferKey: line.cost!.acquireKey } : {}) })
    }}>
      <div className="flex items-center gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-3">
        <Thumb line={line} size="lg" />
        <div className="min-w-0"><p className="text-bw-body font-semibold text-bw-ink"><bdi>{productTitle(line)}</bdi></p><p className="text-bw-small text-bw-ink-soft"><bdi>{productMeta(line)}</bdi></p></div>
      </div>
      <p className="text-bw-heading font-semibold text-bw-ink">بيانات العبوة</p>
      {suggestion || costSuggestion ? <p className="text-[12px] text-bw-ink-soft">آخر قيم اتسجّلت للمنتج ده متعبّية؛ قارنها بالعبوة والفاتورة قبل التأكيد.</p> : null}
      <Field label="تاريخ الصلاحية (٦ شهور على الأقل)" type="date" ltr value={expiry} onChange={(event) => setExpiry(event.target.value)} autoFocus className="[&_input]:h-bw-touch" />
      <Field label="رقم التشغيلة (اختياري)" ltr value={lot} onChange={(event) => setLot(event.target.value)} className="[&_input]:h-bw-touch" />
      {needsCost ? (
        <fieldset className="space-y-3" disabled={defer}>
          <legend className="mb-1 text-bw-small font-semibold text-bw-ink">تكلفة الشراء الفعلية للقطعة (من الفاتورة)</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="سعر القائمة · ج.م" ltr inputMode="decimal" value={listPrice} onChange={(event) => setListPrice(event.target.value.replace(/[^\d.]/g, ''))} className="[&_input]:h-bw-touch" />
            <Field label="الخصم للقطعة · ج.م" ltr inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value.replace(/[^\d.]/g, ''))} className="[&_input]:h-bw-touch"
              error={(listPrice !== '' || discount !== '') && !typed && !defer ? 'الخصم لازم يكون أقل من سعر القائمة' : undefined} />
          </div>
          {typed ? <p className="text-[12px] text-bw-ink-soft" aria-live="polite">التكلفة النهائية <strong className="tabular-nums text-bw-ink">{egp(typed.final)}</strong> للقطعة. بتتسجّل مرة واحدة لكل عملية شراء.</p> : null}
        </fieldset>
      ) : null}
      {needsCost ? <label className="flex items-start gap-2 text-bw-small text-bw-ink-soft"><input type="checkbox" className="mt-0.5 size-4" checked={defer} onChange={(event) => setDefer(event.target.checked)} />مش معايا الفاتورة دلوقتي — هسجّل التكلفة بعدين (الربح هيفضل ناقص لحد ما تتسجّل)</label> : null}
      <StickyAction>
        <Button type="submit" size="touch" className="flex-1 sm:flex-none" disabled={!expiry || costInvalid}>تأكيد وتسجيل القطعة</Button>
        <Button type="button" size="touch" variant="secondary" onClick={onCancel}>إلغاء</Button>
      </StickyAction>
    </form>
  )
}

