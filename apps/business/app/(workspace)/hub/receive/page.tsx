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
    ...(lot.trim() ? { lotNumber: lot.trim() } : {}), ...(expiry ? { expiryDate: expiry } : {}),
  } }))
  const shortfall = useCommand(() => api(`/purchase-orders/${r.purchaseOrderId}/shortfalls`, { body: {
    sourceAllocationId: r.allocationId, quantity: Number(shortQty), reasonCode: shortReason,
  } }))

  const qty = Number(quantity)
  const evidenceOk = manual ? manualReason.trim().length > 0 && checks.length === CHECKS.length : barcode.trim().length > 0
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= r.remainingQuantity && evidenceOk

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
        <Field label="تاريخ الصلاحية (اختياري)" type="date" ltr value={expiry} onChange={(e) => setExpiry(e.target.value)} />
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
