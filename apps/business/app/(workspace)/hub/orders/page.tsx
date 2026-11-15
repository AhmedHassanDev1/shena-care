'use client'

import * as React from 'react'
import Link from 'next/link'
import { RefreshCw, ScanLine, Undo2 } from 'lucide-react'
import { Button, Code, Field, PageHeader, Select as BwSelect, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Flash, Meter } from '@/components/bw/ops'
import { HubShell, useHub } from '@/components/workspace/hub'
import { CommandError, Page, Status } from '@/components/workspace/kit'
import { PackCard, type PackagingCosts } from '@/components/workspace/pack-card'
import { PendingCosts, type PendingCost, costFrom, egp } from '@/components/workspace/buy-costs'
import { LoadError } from '@/components/workspace/role-shell'
import { ApiError, api, newKey } from '@/lib/api'
import { SHIPMENT_STATUS } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Stage = 'waiting_purchase' | 'receiving' | 'verifying' | 'packing'
interface DeskLine {
  orderItemId: string; skuId: string; productName: string | null; brandName: string | null; variantName: string | null
  skuCode: string | null; barcode: string | null; imageUrl: string | null
  required: number; purchased: number; received: number; verified: number
  /** The purchase the next unit belongs to and whether its actual cost is already recorded. */
  cost: { acquireKey: string; recorded: boolean; listUnitPrice: string | null; discountPerUnit: string | null; finalUnitCost: string | null } | null
}
interface DeskUnit { receiptId: string; skuId: string; quantity: number; lotNumber: string | null; expiryDate: string | null; receivedAt: string; correctable: boolean }
interface DeskCorrection { receiptId: string; reversesReceiptId: string; skuId: string; reason: string | null; note: string | null; at: string }
interface DeskOrder {
  orderId: string; orderNumber: string; orderStatus: string; placedAt: string; governorate: string | null; area: string | null
  shipment: { id: string; status: string } | null; stage: Stage; lines: DeskLine[]; printEvents: string[]
  units: DeskUnit[]; corrections: DeskCorrection[]; rejectedScans: number
}
interface Desk {
  orders: DeskOrder[]; lastLots: Record<string, { lotNumber: string | null; expiryDate: string; recordedAt: string }>
  lastCosts: Record<string, { listUnitPrice: string; discountPerUnit: string; recordedAt: string }>
}
interface ScanResult { outcome: 'received' | 'verified' | 'rejected'; code?: string; skuId?: string; order: DeskOrder | null }

const STAGE: Record<Stage, { label: string; tone: 'info' | 'warn' | 'ok' | 'neutral' }> = {
  receiving: { label: 'امسح البضاعة', tone: 'info' },
  verifying: { label: 'أكّد التجهيز', tone: 'warn' },
  packing: { label: 'طباعة وتغليف', tone: 'ok' },
  waiting_purchase: { label: 'مستني شراء', tone: 'neutral' },
}
const REJECT: Record<string, string> = {
  WRONG_ITEM: 'المنتج ده مش في الطلب ده. رجّعه مكانه.',
  PRODUCT_IDENTITY_REVIEW_REQUIRED: 'الباركود ده مش متسجّل لأي منتج متراجع. اتحقق يدوي أو اطلب مراجعة الكتالوج.',
  PRODUCT_IDENTITY_AMBIGUOUS: 'الباركود ده متسجّل لأكتر من منتج. اتحقق يدوي.',
  ALREADY_COMPLETE: 'الصنف ده وصل بالكامل للطلب. المسح ده اتكرر ومااتحسبش.',
  NOT_PURCHASED_YET: 'الكمية دي لسه ماتسجّلتش «اتشترت» في المشتريات. سجّلها هناك الأول.',
  ORDER_NOT_OPEN: 'الطلب ده اتلغى أو اتقفل. ماتجهزوش.',
  COST_MISMATCH: 'المشتريات دي ليها تكلفة مسجّلة بقيمة مختلفة. صحّح التكلفة المسجّلة بسبب موثّق، مش بتغيير هنا.',
  PACKING_STARTED: 'الطلب اتأكد خلاص. كمّل الطباعة والتغليف.',
}
const UNDO_MS = 4000
const CORRECTION_REASONS: Array<[string, string]> = [
  ['WRONG_UNIT_SCANNED', 'مسحت قطعة غلط'], ['DUPLICATE_SCAN', 'اتمسحت مرتين'], ['DAMAGED_ON_INSPECTION', 'لقيتها تالفة'],
  ['WRONG_ORDER', 'اتحسبت على طلب غلط'], ['OTHER', 'سبب تاني'],
]
const CHECKS = [['brand', 'الماركة'], ['variant', 'النوع'], ['size', 'الحجم'], ['pack', 'العبوة']] as const

/**
 * Orders & Preparation (GLO-315): the one primary Hub screen. One scan of each unit receives it against its exact order line and,
 * through that same scan, verifies it for the order; then print, packaging choice and packed, all here. Purchases recorded on the
 * Purchases checklist are never treated as receipt: only a scan here is.
 */
export default function HubOrders() {
  return <HubShell active="orders"><Body /></HubShell>
}

function Body() {
  const hub = useHub()
  const desk = useApi<Desk>(`/fulfillment/locations/${hub.id}/desk`, { pollMs: 20000 })
  const costs = useApi<{ packagingCosts: PackagingCosts }>('/order-costs/pending?take=1')
  const pendingCosts = useApi<{ pending: number; items: PendingCost[] }>('/buy-list/costs?pending=true&take=50', { pollMs: 30000 })
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [override, setOverride] = React.useState<DeskOrder | null>(null)
  // Expiry/lot the operator confirmed per SKU in this sitting (kept across orders); the last recorded value is only offered, never applied silently.
  const [packInfo, setPackInfo] = React.useState<PackInfo>({})
  const orders = desk.data?.orders ?? []
  React.useEffect(() => { setOverride(null) }, [desk.data])
  React.useEffect(() => {
    if (!orders.length) return
    if (!selectedId || !orders.some((o) => o.orderId === selectedId)) setSelectedId(orders[0].orderId)
  }, [orders, selectedId])
  const listed = orders.find((o) => o.orderId === selectedId) ?? null
  const selected = override && override.orderId === selectedId ? override : listed

  return (
    <Page>
      <PageHeader
        title="الطلبات والتجهيز"
        meta="امسح كل قطعة مرة واحدة: المسح بيسجّل إنها وصلت فعلاً ويأكدها للطلب في نفس الوقت. بعدها اطبع وغلّف من نفس الشاشة."
        actions={<Button variant="secondary" size="sm" onClick={desk.reload} loading={desk.loading && !!desk.data}>{!(desk.loading && !!desk.data) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>}
      />
      {desk.error ? <LoadError message={desk.error.message} onRetry={desk.reload} /> : null}
      {!desk.data && desk.loading ? <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div> : null}
      {desk.data && orders.length === 0 ? (
        <div className="bw-panel"><StateBlock kind="empty" title="مافيش طلبات مستنية تجهيز" body="أول ما حاجة تتسجّل «اتشترت» في المشتريات، الطلب بتاعها بيظهر هنا عشان تمسح بضاعته." /></div>
      ) : null}
      {orders.length ? (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
          <nav aria-label="الطلبات المفتوحة" className="bw-panel overflow-hidden">
            <ul className="divide-y divide-bw-line">
              {orders.map((order) => {
                const units = order.lines.reduce((sum, l) => sum + l.required, 0)
                const inHand = order.lines.reduce((sum, l) => sum + l.received, 0)
                const on = order.orderId === selectedId
                return (
                  <li key={order.orderId}>
                    <button type="button" aria-current={on ? 'true' : undefined} onClick={() => setSelectedId(order.orderId)}
                      className={cn('flex w-full flex-col gap-1 px-4 py-3 text-start transition-colors', on ? 'bg-bw-cobalt-soft' : 'hover:bg-bw-veil-1')}>
                      <span className="flex items-center justify-between gap-2">
                        <strong className="text-bw-body text-bw-ink"><Code>{order.orderNumber.replace(/^ORD-/, '#')}</Code></strong>
                        <StatusLabel tone={STAGE[order.stage].tone}>{STAGE[order.stage].label}</StatusLabel>
                      </span>
                      <span className="text-[12px] text-bw-ink-soft">وصل <Code>{inHand}</Code> من <Code>{units}</Code> قطعة{order.area ? <> · <bdi>{order.area}</bdi></> : null}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
          {selected ? <OrderPanel key={selected.orderId} order={selected} lastLots={desk.data?.lastLots ?? {}} packagingCosts={costs.data?.packagingCosts ?? null}
            onOrder={setOverride} onChanged={() => { desk.reload(); pendingCosts.reload() }} packInfo={packInfo} setPackInfo={setPackInfo} lastCosts={desk.data?.lastCosts ?? {}} /> : null}
        </div>
      ) : null}
      {pendingCosts.data && pendingCosts.data.items.length > 0 ? <PendingCosts items={pendingCosts.data.items} onSaved={() => { pendingCosts.reload(); desk.reload() }} /> : null}
    </Page>
  )
}

type Pending = { id: string; barcode: string; line: DeskLine; timer: number }
/** What the operator confirmed for a SKU in this sitting. `deferKey` = the purchase whose cost was knowingly left for later. */
type PackInfo = Record<string, { expiryDate: string; lotNumber: string; listPrice: string; discount: string; deferKey?: string }>
/** Expiry is always needed once per SKU; the cost is asked while the next unit's purchase has none recorded (unless deferred). */
const needsInfo = (line: DeskLine, info: PackInfo[string] | undefined) => !info || (!!line.cost && !line.cost.recorded && info.deferKey !== line.cost.acquireKey && !costFrom(info.listPrice, info.discount))
const costBody = (line: DeskLine | null, info: PackInfo[string] | undefined) => {
  const typed = info && line?.cost && !line.cost.recorded && info.deferKey !== line.cost.acquireKey ? costFrom(info.listPrice, info.discount) : null
  return typed ? { cost: { listUnitPrice: typed.listUnitPrice, discountPerUnit: typed.discountPerUnit } } : {}
}
type Feedback = { tone: 'ok' | 'warn' | 'danger'; text: string }

function OrderPanel({ order, lastLots, lastCosts, packagingCosts, onOrder, onChanged, packInfo, setPackInfo }: {
  order: DeskOrder; lastLots: Desk['lastLots']; lastCosts: Desk['lastCosts']; packagingCosts: PackagingCosts | null
  onOrder: (order: DeskOrder) => void; onChanged: () => void
  packInfo: PackInfo; setPackInfo: React.Dispatch<React.SetStateAction<PackInfo>>
}) {
  const hub = useHub()
  const scanBox = React.useRef<HTMLDivElement>(null)
  const [code, setCode] = React.useState('')
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const [askFor, setAskFor] = React.useState<{ line: DeskLine; barcode: string | null; manual?: ManualCheck } | null>(null)
  const [manualLine, setManualLine] = React.useState<DeskLine | null>(null)
  const lastBarcode = React.useRef<string | null>(null)
  const pendingRef = React.useRef<Pending | null>(null)
  pendingRef.current = pending
  const refocus = React.useCallback(() => window.setTimeout(() => scanBox.current?.querySelector<HTMLInputElement>('input')?.focus(), 0), [])
  React.useEffect(() => { refocus() }, [refocus, order.stage])

  const send = useCommand((body: Record<string, unknown>) => api<ScanResult>(`/fulfillment/locations/${hub.id}/desk/orders/${order.orderId}/scan`, { body }))
  const verify = useCommand(() => api<ScanResult>(`/fulfillment/locations/${hub.id}/desk/orders/${order.orderId}/verify`, { method: 'POST' }))

  const commit = React.useCallback(async (barcode: string | null, line: DeskLine | null, manual?: ManualCheck) => {
    const info = line ? packInfo[line.skuId] : undefined
    const result = await send.execute({
      clientScanId: newKey(),
      ...(barcode ? { barcodeScanned: barcode } : { skuId: manual!.skuId, manualReason: manual!.reason, manualChecks: CHECKS.map(([v]) => v) }),
      ...(info ? { expiryDate: info.expiryDate, ...(info.lotNumber ? { lotNumber: info.lotNumber } : {}), ...costBody(line, info) } : {}),
    })
    if (result) {
      if (result.order) onOrder(result.order)
      const name = result.order?.lines.find((l) => l.skuId === result.skuId)
      if (result.outcome === 'received') {
        setFeedback({ tone: 'ok', text: `اتسجّلت قطعة ${name?.productName ?? ''} ${name?.variantName ?? ''} — وصل ${name?.received ?? ''} من ${name?.required ?? ''}${result.order?.stage === 'packing' ? '. الطلب كامل واتأكد: اطبع وغلّف.' : ''}` })
      } else {
        setFeedback({ tone: 'danger', text: REJECT[result.code ?? ''] ?? 'المسح اترفض.' })
      }
      onChanged()
    }
    refocus()
    return result
  }, [packInfo, send, onOrder, onChanged, refocus])

  // The API's EXPIRY_REQUIRED (e.g. an alias barcode) asks for that SKU's expiry, then the scan is retried.
  React.useEffect(() => {
    const error = send.error as ApiError | null
    if (error?.code === 'EXPIRY_REQUIRED') {
      const skuId = (error.details?.skuId as string | undefined) ?? null
      const line = order.lines.find((l) => l.skuId === skuId)
      if (line) setAskFor({ line, barcode: lastBarcode.current })
    } else if (error) {
      setFeedback({ tone: 'danger', text: error.message })
    }
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
    if (line && line.received < line.purchased && needsInfo(line, packInfo[line.skuId])) {
      setAskFor({ line, barcode })
      return
    }
    if (line && line.received < line.purchased) {
      // A recognised unit is held for a few seconds so a double read or a slip can be undone before it counts.
      const id = newKey()
      const timer = window.setTimeout(() => { void flush() }, UNDO_MS)
      setPending({ id, barcode, line, timer })
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

  const units = order.lines.reduce((sum, l) => sum + l.required, 0)
  const pendingFor = (line: DeskLine) => (pending?.line.skuId === line.skuId ? 1 : 0)

  return (
    <section className="space-y-4" aria-label={`طلب ${order.orderNumber}`}>
      <div className="bw-panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-bw-line px-4 py-3">
          <h2 className="text-bw-body font-semibold text-bw-ink">طلب <Code>{order.orderNumber.replace(/^ORD-/, '#')}</Code></h2>
          <span className="text-bw-small text-bw-ink-soft"><Code>{units}</Code> قطعة</span>
          {order.shipment ? <Status map={SHIPMENT_STATUS} value={order.shipment.status} /> : <StatusLabel tone="neutral">لسه ماوصلش حاجة</StatusLabel>}
        </div>
        <ul className="divide-y divide-bw-line">
          {order.lines.map((line) => {
            const waiting = line.required - line.purchased
            const toScan = line.purchased - line.received - pendingFor(line)
            return (
              <li key={line.orderItemId} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center">
                <div className="min-w-0">
                  <p className="font-semibold text-bw-ink"><bdi>{line.productName ?? line.skuCode}</bdi></p>
                  <p className="text-bw-small text-bw-ink-soft"><bdi>{line.brandName}</bdi> · <bdi>{line.variantName}</bdi> · <Code>{line.skuCode ?? '—'}</Code>{line.barcode ? <> · <Code>{line.barcode}</Code></> : <> · <span className="text-bw-amber">مفيش باركود مسجّل</span></>}</p>
                  <p className="mt-1 text-[12px] text-bw-ink-soft">
                    مطلوب <Code>{line.required}</Code> · اتشترى <Code>{line.purchased}</Code> · وصل <Code>{line.received}</Code>{pendingFor(line) ? <> (+<Code>1</Code> لسه بيتسجّل)</> : null}{order.stage === 'packing' ? <> · اتأكد <Code>{line.verified}</Code></> : null}
                  </p>
                  {line.cost?.recorded ? <p className="text-[12px] text-bw-ink-soft">تكلفة الشراء المسجّلة <Code>{egp(Number(line.cost.finalUnitCost))}</Code> للقطعة</p> : line.cost ? <p className="text-[12px] text-bw-amber">تكلفة الشراء لسه مش مسجّلة — بتتسجّل مع أول قطعة بتتمسح</p> : null}
                  {waiting > 0 ? <p className="text-[12px] text-bw-amber">مستني شراء <Code>{waiting}</Code> — <Link href="/hub/buy-list" className="font-semibold underline-offset-4 hover:underline">المشتريات</Link></p> : null}
                  {toScan > 0 && order.stage === 'receiving' ? (
                    <button type="button" className="text-[12px] font-semibold text-bw-cobalt underline-offset-4 hover:underline" onClick={() => setManualLine(line)}>الباركود مش بيتقري؟ تحقق يدوي</button>
                  ) : null}
                </div>
                <Meter value={line.received + pendingFor(line)} max={line.required} tone={line.received >= line.required ? 'emerald' : 'cobalt'} label={`وصل ${line.received} من ${line.required}`} />
              </li>
            )
          })}
        </ul>
      </div>

      {order.stage === 'receiving' || order.stage === 'waiting_purchase' ? (
        <div className="bw-panel space-y-3 p-4">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void onScan(code) }}>
            <div ref={scanBox} className="min-w-0 flex-1"><Field label="امسح باركود القطعة" ltr autoComplete="off" autoFocus value={code}
              onChange={(event) => setCode(event.target.value)} disabled={!!askFor} hint="الماسح بيضغط Enter لوحده. كل قطعة مرة واحدة." /></div>
            <Button type="submit" loading={send.pending} disabled={!code.trim() || !!askFor}><ScanLine className="size-4" aria-hidden />تسجيل</Button>
          </form>
          {pending ? (
            <div className="flex flex-wrap items-center gap-3" role="status">
              <Flash tone="ok">قطعة <bdi>{pending.line.productName}</bdi> <bdi>{pending.line.variantName}</bdi> — بتتسجّل خلال ثواني</Flash>
              <Button variant="secondary" size="sm" onClick={undo}><Undo2 className="size-4" aria-hidden />تراجع</Button>
            </div>
          ) : null}
          {feedback ? <Flash tone={feedback.tone}>{feedback.text}</Flash> : null}
          {askFor ? (
            <PackInfoForm line={askFor.line} suggestion={lastLots[askFor.line.skuId] ?? null} costSuggestion={lastCosts[askFor.line.skuId] ?? null} current={packInfo[askFor.line.skuId] ?? null}
              onCancel={() => { setAskFor(null); refocus() }}
              onConfirm={async (info) => {
                const { line, barcode, manual } = askFor
                setPackInfo((all) => ({ ...all, [line.skuId]: info }))
                setAskFor(null)
                // State updates are async; send this one scan with the confirmed values directly.
                const result = await send.execute({ clientScanId: newKey(), expiryDate: info.expiryDate, ...(info.lotNumber ? { lotNumber: info.lotNumber } : {}), ...costBody(line, info),
                  ...(barcode ? { barcodeScanned: barcode } : { skuId: manual!.skuId, manualReason: manual!.reason, manualChecks: CHECKS.map(([v]) => v) }) })
                if (result) {
                  if (result.order) onOrder(result.order)
                  const updated = result.order?.lines.find((l) => l.skuId === line.skuId)
                  setFeedback(result.outcome === 'received'
                    ? { tone: 'ok', text: `اتسجّلت قطعة ${line.productName ?? ''} — وصل ${updated?.received ?? ''} من ${updated?.required ?? ''}` }
                    : { tone: 'danger', text: REJECT[result.code ?? ''] ?? 'المسح اترفض.' })
                  onChanged()
                }
                refocus()
              }} />
          ) : null}
          {Object.entries(packInfo).length ? (
            <ul className="flex flex-wrap gap-2 text-[12px] text-bw-ink-soft">
              {order.lines.filter((l) => packInfo[l.skuId]).map((l) => (
                <li key={l.skuId} className="rounded-bw-pill border border-bw-line px-2 py-0.5">
                  <bdi>{l.variantName}</bdi>: صلاحية <Code>{packInfo[l.skuId].expiryDate}</Code>{packInfo[l.skuId].lotNumber ? <> · تشغيلة <Code>{packInfo[l.skuId].lotNumber}</Code></> : null}{costFrom(packInfo[l.skuId].listPrice, packInfo[l.skuId].discount) ? <> · تكلفة <Code>{egp(costFrom(packInfo[l.skuId].listPrice, packInfo[l.skuId].discount)!.final)}</Code></> : null}
                  {' '}<button type="button" className="font-semibold text-bw-cobalt underline-offset-4 hover:underline" onClick={() => setPackInfo((all) => { const next = { ...all }; delete next[l.skuId]; return next })}>تغيير</button>
                </li>
              ))}
            </ul>
          ) : null}
          {manualLine ? (
            <ManualForm line={manualLine} onCancel={() => { setManualLine(null); refocus() }} onConfirm={async (reason) => {
              const manual = { skuId: manualLine.skuId, reason }
              setManualLine(null)
              if (needsInfo(manualLine, packInfo[manualLine.skuId])) { setAskFor({ line: manualLine, barcode: null, manual }); return }
              await commit(null, manualLine, manual)
            }} />
          ) : null}
        </div>
      ) : null}

      <UnitsPanel order={order} onOrder={onOrder} onChanged={onChanged} />

      {order.stage === 'verifying' ? (
        <div className="bw-panel space-y-3 p-4">
          <p className="text-bw-small text-bw-ink">كل البضاعة وصلت. مسح الاستلام بيتحسب تأكيد للطلب، مش محتاج تمسح تاني.</p>
          <Button loading={verify.pending} onClick={async () => { const r = await verify.execute(); if (r?.order) onOrder(r.order); onChanged() }}>تأكيد التجهيز</Button>
          <CommandError error={verify.error} />
        </div>
      ) : null}

      {order.stage === 'packing' && order.shipment ? (
        <PackCard s={{ shipmentId: order.shipment.id, orderId: order.orderId, orderNumber: order.orderNumber, status: order.shipment.status, itemCount: units, printEvents: order.printEvents }}
          onChanged={onChanged} packagingCosts={packagingCosts} />
      ) : null}
    </section>
  )
}

type ManualCheck = { skuId: string; reason: string }

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
    <form className="space-y-3 rounded-bw-field border border-bw-line p-3" onSubmit={(event) => {
      event.preventDefault()
      if (!expiry || costInvalid) return
      onConfirm({ expiryDate: expiry, lotNumber: lot.trim(), listPrice: needsCost && !defer ? listPrice : '', discount: needsCost && !defer ? discount : '', ...(needsCost && defer ? { deferKey: line.cost!.acquireKey } : {}) })
    }}>
      <p className="text-bw-small font-semibold text-bw-ink">بيانات <bdi>{line.productName}</bdi> <bdi>{line.variantName}</bdi> زي ما هي على العبوة والفاتورة</p>
      {suggestion || costSuggestion ? <p className="text-[12px] text-bw-ink-soft">آخر قيم اتسجّلت للصنف ده متعبّية تحت؛ قارنها بالعبوة والفاتورة قبل التأكيد.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="تاريخ الصلاحية (٦ شهور على الأقل)" type="date" ltr value={expiry} onChange={(event) => setExpiry(event.target.value)} autoFocus />
        <Field label="رقم التشغيلة (اختياري)" ltr value={lot} onChange={(event) => setLot(event.target.value)} />
      </div>
      {needsCost ? (
        <fieldset className="space-y-2" disabled={defer}>
          <legend className="mb-1 text-bw-small font-semibold text-bw-ink">تكلفة الشراء الفعلية للقطعة (من الفاتورة)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="سعر القائمة · ج.م" ltr inputMode="decimal" value={listPrice} onChange={(event) => setListPrice(event.target.value.replace(/[^\d.]/g, ''))} />
            <Field label="الخصم للقطعة · ج.م" ltr inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value.replace(/[^\d.]/g, ''))}
              error={(listPrice !== '' || discount !== '') && !typed && !defer ? 'الخصم لازم يكون أقل من سعر القائمة' : undefined} />
          </div>
          {typed ? <p className="text-[12px] text-bw-ink-soft" aria-live="polite">التكلفة النهائية <strong className="text-bw-ink tabular-nums">{egp(typed.final)}</strong> للقطعة. بتتسجّل مرة واحدة لكل عملية شراء.</p> : null}
        </fieldset>
      ) : null}
      {needsCost ? <label className="flex items-center gap-2 text-bw-small"><input type="checkbox" checked={defer} onChange={(event) => setDefer(event.target.checked)} />مش معايا الفاتورة دلوقتي — هسجّل التكلفة بعدين (الربح هيفضل ناقص لحد ما تتسجّل)</label> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!expiry || costInvalid}>تأكيد وتسجيل القطعة</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>إلغاء</Button>
      </div>
      <p className="text-[12px] text-bw-ink-subtle">القيم دي بتتكرر لباقي قطع نفس الصنف في الجلسة دي؛ تقدر تغيّرها في أي وقت.</p>
    </form>
  )
}

/** Units counted as received so far, each correctable with an audited compensating event until the parcel is printed or packed. */
function UnitsPanel({ order, onOrder, onChanged }: { order: DeskOrder; onOrder: (order: DeskOrder) => void; onChanged: () => void }) {
  const hub = useHub()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('WRONG_UNIT_SCANNED')
  const [note, setNote] = React.useState('')
  const [done, setDone] = React.useState<string | null>(null)
  const key = React.useRef(newKey())
  const reverse = useCommand((receiptId: string) => api<{ order: DeskOrder | null }>(`/fulfillment/locations/${hub.id}/desk/receipts/${receiptId}/reverse`, { body: { idempotencyKey: key.current, reason, note: note.trim() } }))
  const nameOf = (skuId: string) => { const l = order.lines.find((x) => x.skuId === skuId); return [l?.productName, l?.variantName].filter(Boolean).join(' · ') }
  if (!order.units.length && !order.corrections.length && !order.rejectedScans) return null
  return (
    <details className="bw-panel" open={!!openId}>
      <summary className="cursor-pointer px-4 py-3 text-bw-small font-semibold text-bw-ink">
        القطع اللي اتمسحت وتصحيحها <span className="font-normal text-bw-ink-soft">· <Code>{order.units.length}</Code> مسجّلة{order.corrections.length ? <> · <Code>{order.corrections.length}</Code> تصحيح</> : null}{order.rejectedScans ? <> · <Code>{order.rejectedScans}</Code> مسح مرفوض</> : null}</span>
      </summary>
      <div className="space-y-3 border-t border-bw-line p-4">
        {done ? <Flash tone="ok">{done}</Flash> : null}
        <ul className="divide-y divide-bw-line">
          {order.units.map((unit) => (
            <li key={unit.receiptId} className="space-y-2 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-bw-small">
                <span className="font-semibold text-bw-ink"><bdi>{nameOf(unit.skuId)}</bdi></span>
                {unit.quantity > 1 ? <span><Code>{unit.quantity}</Code> قطعة</span> : null}
                {unit.lotNumber ? <span className="text-bw-ink-soft">تشغيلة <Code>{unit.lotNumber}</Code></span> : null}
                {unit.expiryDate ? <span className="text-bw-ink-soft">صلاحية <Code>{unit.expiryDate}</Code></span> : null}
                {unit.correctable
                  ? <button type="button" className="ms-auto text-[12px] font-semibold text-bw-cobalt underline-offset-4 hover:underline" onClick={() => { setOpenId(openId === unit.receiptId ? null : unit.receiptId); key.current = newKey(); setDone(null) }}>تصحيح</button>
                  : <span className="ms-auto text-[12px] text-bw-ink-subtle">اتطبع أو اتغلّف — مايتصحّحش من هنا</span>}
              </div>
              {openId === unit.receiptId ? (
                <form className="grid gap-3 rounded-bw-field border border-bw-line p-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-end" onSubmit={async (event) => {
                  event.preventDefault()
                  const result = await reverse.execute(unit.receiptId)
                  if (result) { if (result.order) onOrder(result.order); setOpenId(null); setNote(''); setDone('اتصحّحت القطعة: رجعت تتمسح من جديد، والتأكيد اتلغى لحد ما الطلب يكمل.'); onChanged() }
                }}>
                  <BwSelect label="سبب التصحيح" value={reason} onChange={(event) => { setReason(event.target.value); key.current = newKey() }} options={CORRECTION_REASONS.map(([value, label]) => ({ value, label }))} />
                  <Field label="اشرح اللي حصل (٥ حروف على الأقل)" value={note} onChange={(event) => { setNote(event.target.value); key.current = newKey() }} />
                  <Button type="submit" variant="danger" loading={reverse.pending} disabled={note.trim().length < 5}>تأكيد التصحيح</Button>
                  <div className="sm:col-span-3"><CommandError error={reverse.error} /></div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {order.corrections.length ? (
          <div>
            <p className="mb-1 text-[12px] font-semibold text-bw-ink-soft">سجل التصحيحات (مش بيتمسح)</p>
            <ul className="space-y-1 text-[12px] text-bw-ink-soft">
              {order.corrections.map((c) => <li key={c.receiptId}><bdi>{nameOf(c.skuId)}</bdi> — {CORRECTION_REASONS.find(([v]) => v === c.reason)?.[1] ?? c.reason}{c.note ? <> · <bdi>{c.note}</bdi></> : null}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  )
}

function ManualForm({ line, onConfirm, onCancel }: { line: DeskLine; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = React.useState('')
  const [checks, setChecks] = React.useState<string[]>([])
  return (
    <form className="space-y-3 rounded-bw-field border border-bw-line p-3" onSubmit={(event) => { event.preventDefault(); onConfirm(reason.trim()) }}>
      <p className="text-bw-small font-semibold text-bw-ink">تحقق يدوي لقطعة واحدة من <bdi>{line.productName}</bdi> <bdi>{line.variantName}</bdi></p>
      <Field label="ليه مفيش باركود مقروء؟" value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />
      <fieldset className="flex flex-wrap gap-3 text-bw-small">
        <legend className="mb-1 font-semibold">اتأكدت من:</legend>
        {CHECKS.map(([value, text]) => (
          <label key={value} className="flex items-center gap-1">
            <input type="checkbox" checked={checks.includes(value)} onChange={(event) => setChecks(event.target.checked ? [...checks, value] : checks.filter((c) => c !== value))} />
            {text}
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={!reason.trim() || checks.length !== CHECKS.length}>تسجيل القطعة</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>إلغاء</Button>
      </div>
    </form>
  )
}
