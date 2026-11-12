'use client'

import * as React from 'react'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { HubShell, useHub } from '@/components/workspace/hub'
import { CommandError, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { PO_STATUS, SHORTFALL_REASONS, formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

interface Receivable {
  allocationId: string; orderId: string; orderItemId: string; skuId: string; orderNumber: string
  confirmedQuantity: number; receivedQuantity: number; shortQuantity: number; remainingQuantity: number
  purchaseOrderId: string; purchaseOrderStatus: string; supplierName: string; readyAt: string | null
  skuCode: string | null; variantName: string | null; barcode: string | null
}

interface StaffRfqList { items: Array<{ id: string; batchRef: string; status: string; requiredQuantity: number; awardedQuantity: number }> }
interface StaffRfqDetail {
  id: string; batchRef: string; status: string
  lines: Array<{ id: string; skuId: string; remainingQuantity: number; sku: { productName: string; variantName: string; skuCode: string } | null;
    responseLines: Array<{ supplierId: string }> }>
  recipients: Array<{ supplierId: string; status: string; supplier: { name: string } }>
  purchaseOrders: Array<{ id: string; supplierId: string; version: number; status: string }>
}

const CHECKS = [['brand', 'الماركة'], ['variant', 'النوع'], ['size', 'الحجم'], ['pack', 'العبوة']] as const

/** Supplier receiving (W4): actual quantity against the PO→order lineage, with identity evidence. */
export default function HubReceive() {
  return (
    <HubShell active="receive">
      <ReceiveBody />
    </HubShell>
  )
}

function ReceiveBody() {
  const hub = useHub()
  const { data, error, loading, reload } = useApi<Receivable[]>(`/fulfillment/locations/${hub.id}/receivables`, { pollMs: 30000 })
  const byPo = React.useMemo(() => {
    const groups = new Map<string, Receivable[]>()
    for (const r of data ?? []) groups.set(r.purchaseOrderId, [...(groups.get(r.purchaseOrderId) ?? []), r])
    return [...groups.entries()]
  }, [data])

  return (
    <Page>
      <PageHeader title="استلام بضاعة الموردين" meta={`${hub.name} — الكميات المؤكدة من الموردين لكل طلب عميل`} />
      <OfflineProcurement />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
      {data && data.length === 0 ? <StateBlock kind="empty" title="مافيش بضاعة متوقعة دلوقتي" body="أوامر الشراء المؤكدة من الموردين بتظهر هنا لحد ما تتستلم." /> : null}
      {byPo.map(([poId, rows]) => (
        <Section key={poId} title={<span className="flex flex-wrap items-center gap-2">أمر شراء <Code>{shortId(poId)}</Code> · {rows[0].supplierName} <Status map={PO_STATUS} value={rows[0].purchaseOrderStatus} /></span>}
          aside={rows[0].readyAt ? <span className="text-bw-small text-bw-ink-soft">المورد جهّزه {formatDateTime(rows[0].readyAt)}</span> : <span className="text-bw-small text-bw-warn">المورد لسه ماقالش إنه جاهز</span>}>
          <div className="space-y-4">{rows.map((r) => <ReceiveRow key={r.allocationId} r={r} hubId={hub.id} onDone={reload} />)}</div>
        </Section>
      ))}
    </Page>
  )
}

/** Phone/WhatsApp answers stay on the Hub's existing procurement and receiving desk. */
function OfflineProcurement() {
  const requests = useApi<StaffRfqList>('/rfq/staff?take=30', { pollMs: 30000 })
  const [selectedId, setSelectedId] = React.useState('')
  const detail = useApi<StaffRfqDetail>(selectedId ? `/rfq/staff/${selectedId}` : null, { pollMs: 30000 })
  // Keep the just-answered request selectable after it fills, so its final POs stay on screen.
  const open = (requests.data?.items ?? []).filter((item) => item.status === 'open' || item.id === selectedId)
  React.useEffect(() => {
    if (!selectedId && open.length) setSelectedId(open[0].id)
  }, [selectedId, open.length])
  return (
    <Section title="طلبات الموردين المفتوحة" aside={<Button variant="secondary" onClick={() => { requests.reload(); detail.reload() }}>تحديث</Button>}>
      {requests.error ? <LoadError message={requests.error.message} onRetry={requests.reload} /> : null}
      {!requests.data && requests.loading ? <Skeleton className="h-20 w-full" /> : null}
      {requests.data && open.length === 0 ? <StateBlock kind="empty" title="مافيش طلبات موردين مفتوحة" body="الطلبات الجديدة بتظهر هنا بعد تجميع طلبات العملاء." /> : null}
      {open.length ? <Select label="طلب الموردين" value={selectedId} onChange={setSelectedId}
        options={open.map((item) => [item.id, `${item.batchRef} · باقي ${item.requiredQuantity - item.awardedQuantity}`])} /> : null}
      {detail.error ? <LoadError message={detail.error.message} onRetry={detail.reload} /> : null}
      {selectedId && !detail.data && detail.loading ? <Skeleton className="h-24 w-full" /> : null}
      {detail.data && detail.data.id === selectedId ? (
        <div className="space-y-3">
          {detail.data.lines.map((line) => <OfflineRfqLine key={line.id} rfq={detail.data!} line={line}
            onDone={() => { detail.reload(); requests.reload() }} />)}
          {detail.data.purchaseOrders.length ? <div className="border-t border-bw-line pt-3 text-bw-small">
            <p className="font-semibold">أوامر الشراء النهائية</p>
            {detail.data.purchaseOrders.map((po) => <p key={po.id}><Code>{shortId(po.id)}</Code> · إصدار <Code>{po.version}</Code> · <Status map={PO_STATUS} value={po.status} /></p>)}
          </div> : null}
        </div>
      ) : null}
    </Section>
  )
}

function OfflineRfqLine({ rfq, line, onDone }: { rfq: StaffRfqDetail; line: StaffRfqDetail['lines'][number]; onDone: () => void }) {
  const available = rfq.recipients.filter((recipient) => !line.responseLines.some((answer) => answer.supplierId === recipient.supplierId))
  const [supplierId, setSupplierId] = React.useState('')
  const [quantity, setQuantity] = React.useState('')
  const [rejected, setRejected] = React.useState(false)
  const [source, setSource] = React.useState<'PHONE' | 'WHATSAPP'>('PHONE')
  const [allocated, setAllocated] = React.useState<number | null>(null)
  const intent = React.useRef<{ key: string; at: string } | null>(null)
  const qty = Number(quantity)
  const submit = useCommand(() => {
    intent.current ??= { key: newKey(), at: new Date().toISOString() }
    return api<{ lines: Array<{ awardedQuantity: number }> }>(`/rfq/staff/${rfq.id}/responses`, { body: {
      supplierId, confirmationSource: source, confirmedAt: intent.current.at, idempotencyKey: intent.current.key,
      lines: [{ demandLineId: line.id, answer: rejected ? 'REJECT' : qty >= line.remainingQuantity ? 'FULL' : 'PARTIAL',
        ...(!rejected ? { availableQuantity: qty } : {}) }],
    } })
  })
  return (
    <div className="space-y-2 rounded-bw-field border border-bw-line p-3">
      <p className="font-semibold"><bdi>{line.sku?.productName ?? shortId(line.skuId)}</bdi> · <Code>{line.sku?.skuCode ?? shortId(line.skuId)}</Code> · مطلوب <Code>{line.remainingQuantity}</Code></p>
      {allocated !== null ? <Notice tone="ok" title={`اتخصص ${allocated} قطعة. ${allocated ? 'أمر الشراء النهائي ظاهر أدناه.' : 'مافيش أمر شراء بدون تخصيص.'}`} /> : null}
      {line.remainingQuantity > 0 && available.length ? <form className="grid gap-2 md:grid-cols-5 md:items-end" onSubmit={async (event) => {
        event.preventDefault()
        const result = await submit.execute()
        if (result) { setAllocated(result.lines[0].awardedQuantity); intent.current = null; setQuantity(''); onDone() }
      }}>
        <Select label="المورد" value={supplierId} onChange={(value) => { setSupplierId(value); intent.current = null }}
          options={[['', 'اختر المورد'], ...available.map((recipient): [string, string] => [recipient.supplierId, recipient.supplier.name])]} />
        <Select label="الرد" value={rejected ? 'REJECT' : 'CONFIRMED'} onChange={(value) => { setRejected(value === 'REJECT'); intent.current = null }}
          options={[["CONFIRMED", "تأكيد كمية"], ["REJECT", "رفض / غير متاح"]]} />
        {!rejected ? <Field label="الكمية المؤكدة" ltr inputMode="numeric" value={quantity} onChange={(event) => { setQuantity(event.target.value); intent.current = null }} /> : <span />}
        <Select label="مصدر التأكيد" value={source} onChange={(value) => { setSource(value as 'PHONE' | 'WHATSAPP'); intent.current = null }}
          options={[["PHONE", "هاتف"], ["WHATSAPP", "واتساب"]]} />
        <Button type="submit" loading={submit.pending} disabled={!supplierId || (!rejected && (!Number.isInteger(qty) || qty < 1))}>تسجيل رد المورد</Button>
      </form> : line.remainingQuantity > 0 ? <Notice tone="info" title="مافيش مورد متاح للرد هنا؛ راجع الاستثناءات أو التسجيل." /> : null}
      <CommandError error={submit.error} />
    </div>
  )
}

function ReceiveRow({ r, hubId, onDone }: { r: Receivable; hubId: string; onDone: () => void }) {
  const [barcode, setBarcode] = React.useState('')
  const [manual, setManual] = React.useState(false)
  const [manualReason, setManualReason] = React.useState('')
  const [checks, setChecks] = React.useState<string[]>([])
  const [quantity, setQuantity] = React.useState(String(r.remainingQuantity))
  const [condition, setCondition] = React.useState('ACCEPTABLE')
  const [lot, setLot] = React.useState('')
  const [expiry, setExpiry] = React.useState('')
  const [shortQty, setShortQty] = React.useState('')
  const [shortReason, setShortReason] = React.useState('SHORT_SHIPPED')
  const [done, setDone] = React.useState<string | null>(null)
  // One key per receiving intent: a retry after a lost response replays instead of double-counting stock.
  const key = React.useRef(newKey())

  const receive = useCommand(() => api('/fulfillment/receipts', { body: {
    locationId: hubId, allocationId: r.allocationId, orderId: r.orderId, orderItemId: r.orderItemId, skuId: r.skuId,
    variantName: r.variantName ?? '-', quantity: Number(quantity), condition, idempotencyKey: key.current,
    ...(manual ? { manualReason: manualReason.trim(), manualChecks: checks } : { barcodeScanned: barcode.trim() }),
    ...(lot.trim() ? { lotNumber: lot.trim() } : {}), expiryDate: expiry,
  } }))
  const shortfall = useCommand(() => api(`/purchase-orders/${r.purchaseOrderId}/shortfalls`, { body: {
    sourceAllocationId: r.allocationId, quantity: Number(shortQty), reasonCode: shortReason,
  } }))

  const qty = Number(quantity)
  const evidenceOk = manual ? manualReason.trim().length > 0 && checks.length === CHECKS.length : barcode.trim().length > 0
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= r.remainingQuantity && evidenceOk && expiry.length > 0

  return (
    <div className="space-y-3 rounded-bw-field border border-bw-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">طلب <Code>{r.orderNumber}</Code></span>
        <span>· <Code>{r.skuCode ?? shortId(r.skuId)}</Code> <bdi>{r.variantName}</bdi></span>
        <span className="text-bw-small">مؤكد <Code>{r.confirmedQuantity}</Code> · وصل <Code>{r.receivedQuantity}</Code> · ناقص <Code>{r.shortQuantity}</Code> · <strong>باقي <Code>{r.remainingQuantity}</Code></strong></span>
      </div>
      {done ? <Notice tone="ok" title={done} /> : null}
      <form className="grid gap-3 md:grid-cols-4 md:items-end" onSubmit={async (e) => {
        e.preventDefault()
        if (await receive.execute()) { key.current = newKey(); setDone(`اتسجّل استلام ${qty} قطعة`); setBarcode(''); onDone() }
      }}>
        {manual ? (
          <div className="space-y-2 md:col-span-2">
            <Field label="سبب التحقق اليدوي (مفيش باركود مقروء)" value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
            <fieldset className="flex flex-wrap gap-3 text-bw-small">
              <legend className="mb-1 font-semibold">اتأكدت من:</legend>
              {CHECKS.map(([value, text]) => (
                <label key={value} className="flex items-center gap-1">
                  <input type="checkbox" checked={checks.includes(value)} onChange={(e) => setChecks(e.target.checked ? [...checks, value] : checks.filter((c) => c !== value))} />
                  {text}
                </label>
              ))}
            </fieldset>
          </div>
        ) : (
          <Field className="md:col-span-2" label={`امسح باركود المنتج${r.barcode ? '' : ' (مفيش باركود مسجّل)'}`} ltr autoComplete="off" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        )}
        <Field label="الكمية اللي وصلت فعلاً" ltr inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)}
          error={qty > r.remainingQuantity ? `أكتر من الباقي (${r.remainingQuantity})` : undefined} />
        <Select label="الحالة" value={condition} onChange={setCondition} options={[['ACCEPTABLE', 'سليمة'], ['DAMAGED', 'تالفة'], ['EXPIRED', 'منتهية الصلاحية'], ['QUARANTINED', 'معزولة للفحص']]} />
        <Field label="رقم التشغيلة (اختياري)" ltr value={lot} onChange={(e) => setLot(e.target.value)} />
        <Field label="تاريخ الصلاحية (إجباري، ٦ شهور على الأقل)" type="date" ltr value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        <div className="flex items-end gap-2 md:col-span-2">
          <Button type="submit" loading={receive.pending} disabled={!valid}>تسجيل الاستلام</Button>
          <button type="button" className="text-bw-small underline" onClick={() => setManual(!manual)}>{manual ? 'رجوع لمسح الباركود' : 'تحقق يدوي'}</button>
        </div>
      </form>
      <CommandError error={receive.error} />
      <details className="text-bw-small">
        <summary className="cursor-pointer font-semibold">الكمية ماوصلتش؟ سجّل عجز</summary>
        <form className="mt-2 grid gap-2 md:grid-cols-[8rem_14rem_auto] md:items-end" onSubmit={async (e) => {
          e.preventDefault()
          if (await shortfall.execute()) { setDone(`اتسجّل عجز ${shortQty} قطعة`); setShortQty(''); onDone() }
        }}>
          <Field label="الكمية الناقصة" ltr inputMode="numeric" value={shortQty} onChange={(e) => setShortQty(e.target.value)} />
          <Select label="السبب" value={shortReason} onChange={setShortReason} options={Object.entries(SHORTFALL_REASONS)} />
          <Button type="submit" variant="danger" loading={shortfall.pending} disabled={!(Number(shortQty) >= 1 && Number(shortQty) <= r.remainingQuantity)}>تسجيل العجز</Button>
        </form>
        <CommandError error={shortfall.error} />
      </details>
    </div>
  )
}
