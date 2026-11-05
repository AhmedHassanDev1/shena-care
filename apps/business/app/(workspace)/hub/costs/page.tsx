'use client'

import * as React from 'react'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { HubShell } from '@/components/workspace/hub'
import { CommandError, Egp, Page, Select } from '@/components/workspace/kit'
import { LoadError, useMe } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

interface CostLot { id: string; invoiceRef: string; invoiceLineRef: string; quantity: number; unitCost: string; currency: string; version: number; capturedAt: string }
interface CostLine {
  purchaseOrderId: string; lineId: string; skuId: string; supplierId: string; supplierName: string; purchaseOrderStatus: string
  sku: { productName: string; variantName: string; skuCode: string } | null
  status: string; receivedQuantity: number; costedQuantity: number; pendingQuantity: number; capturedValue: string
  lots: CostLot[]; payable: { id: string; status: string; amount: string } | null
}
interface MarginWarning { orderItemId: string; unitNetPrice: string; unitCost: string; unitContribution: string }
interface CaptureResult { marginWarnings: MarginWarning[] }
interface HistoryEvent { id: string; action: string; actorId: string; reason: string | null; previous: { unitCost?: string; quantity?: number } | null; current: { unitCost: string; quantity: number }; createdAt: string }

const FILTERS: Array<[string, string]> = [['COST_PENDING', 'مستنية فاتورة'], ['COST_CAPTURED', 'متسجلة'], ['', 'الكل']]

/**
 * Actual invoice cost of goods already received. Receiving does not wait for it: a line without a cost stays pending and the supplier payable stays blocked.
 * The cost comes from the supplier's invoice only; nothing here suggests one from a retail price or an old offer.
 */
export default function HubCostsPage() {
  return (
    <HubShell active="costs">
      <CostsBody />
    </HubShell>
  )
}

function CostsBody() {
  const [status, setStatus] = React.useState('COST_PENDING')
  const { data, error, loading, reload } = useApi<{ total: number; items: CostLine[] }>(`/procurement/acquisition-costs?take=100${status ? `&status=${status}` : ''}`, { pollMs: 30000 })
  return (
    <Page>
      <PageHeader title="تكلفة فواتير الموردين" meta="سجّل التكلفة الفعلية من فاتورة المورد بالجنيه. لو الفاتورة لسه ماوصلتش، سيب السطر مستني: الاستلام مسجل، والمستحق للمورد مش هيتقفل غير لما كل قطعة ليها فاتورة." />
      <Select label="عرض" value={status} onChange={setStatus} options={FILTERS} />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
      {data && data.items.length === 0 ? <StateBlock kind="empty" title="مفيش سطور في العرض ده" body="السطور بتظهر هنا بعد استلام البضاعة في المخزن." /> : null}
      {(data?.items ?? []).map((line) => <CostRow key={line.lineId} line={line} onDone={reload} />)}
    </Page>
  )
}

function CostRow({ line, onDone }: { line: CostLine; onDone: () => void }) {
  const me = useMe()
  const canCorrect = me.roles.includes('ADMIN')
  const [barcode, setBarcode] = React.useState('')
  const [invoiceRef, setInvoiceRef] = React.useState('')
  const [quantity, setQuantity] = React.useState(String(line.pendingQuantity))
  const [unitCost, setUnitCost] = React.useState('')
  const [warnings, setWarnings] = React.useState<MarginWarning[]>([])
  const key = React.useRef(newKey())
  const qty = Number(quantity)
  const cost = Number(unitCost)
  const valid = invoiceRef.trim().length > 0 && Number.isInteger(qty) && qty >= 1 && qty <= line.pendingQuantity && cost > 0 && /^\d+(\.\d{1,2})?$/.test(unitCost)
  const capture = useCommand(() => api<CaptureResult>(`/procurement/acquisition-costs/purchase-orders/${line.purchaseOrderId}/lines/${line.lineId}`, { body: {
    quantity: qty, unitCost: cost, invoiceRef: invoiceRef.trim(), currency: 'EGP', expectedSupplierId: line.supplierId, idempotencyKey: key.current,
    ...(barcode.trim() ? { barcodeScanned: barcode.trim() } : {}),
  } }))

  return (
    <Section title={<span className="flex flex-wrap items-center gap-2"><bdi>{line.sku?.productName ?? shortId(line.skuId)}</bdi> <Code>{line.sku?.skuCode ?? shortId(line.skuId)}</Code>
      {line.status === 'COST_PENDING' ? <StatusLabel tone="warn">مستني فاتورة</StatusLabel> : <StatusLabel tone="ok">التكلفة متسجلة</StatusLabel>}</span>}
      aside={<span className="text-bw-small text-bw-ink-soft">{line.supplierName} · أمر شراء <Code>{shortId(line.purchaseOrderId)}</Code></span>}>
      <div className="space-y-3">
        <p className="text-bw-small">اتستلم <Code>{line.receivedQuantity}</Code> · له فاتورة <Code>{line.costedQuantity}</Code> · <strong>مستني <Code>{line.pendingQuantity}</Code></strong> · قيمة الفواتير <Egp value={line.capturedValue} />
          {line.payable ? <> · مستحق المورد <Egp value={line.payable.amount} /></> : null}</p>
        {warnings.map((w) => (
          <Notice key={w.orderItemId} tone="danger" title={`خسارة في سطر طلب: التكلفة ${w.unitCost} والصافي للعميل ${w.unitNetPrice} جنيه للقطعة`}>
            سعر العميل ماتغيرش. اتفتحت حالة للإدارة عشان تقرر مع المورد.
          </Notice>
        ))}
        {line.pendingQuantity > 0 ? (
          <form className="grid gap-3 md:grid-cols-5 md:items-end" onSubmit={async (e) => {
            e.preventDefault()
            const result = await capture.execute()
            if (result) { key.current = newKey(); setWarnings(result.marginWarnings ?? []); setInvoiceRef(''); setUnitCost(''); setBarcode(''); onDone() }
          }}>
            <Field label="امسح باركود القطعة" ltr autoComplete="off" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            <Field label="رقم فاتورة المورد" ltr autoComplete="off" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
            <Field label="الكمية" ltr inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} error={qty > line.pendingQuantity ? `أكتر من المستني (${line.pendingQuantity})` : undefined} />
            <Field label="تكلفة القطعة (جنيه)" ltr inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            <Button type="submit" loading={capture.pending} disabled={!valid}>تسجيل التكلفة</Button>
          </form>
        ) : null}
        <CommandError error={capture.error} />
        {line.lots.length ? (
          <ul className="space-y-2 border-t border-bw-line pt-3 text-bw-small">
            {line.lots.map((lot) => <LotRow key={`${lot.id}-${lot.version}`} lot={lot} canCorrect={canCorrect && line.payable?.status !== 'paid'} onDone={onDone} />)}
          </ul>
        ) : null}
      </div>
    </Section>
  )
}

function LotRow({ lot, canCorrect, onDone }: { lot: CostLot; canCorrect: boolean; onDone: () => void }) {
  const [unitCost, setUnitCost] = React.useState(lot.unitCost)
  const [quantity, setQuantity] = React.useState(String(lot.quantity))
  const [reason, setReason] = React.useState('')
  const [history, setHistory] = React.useState<HistoryEvent[] | null>(null)
  const correct = useCommand(() => api(`/procurement/acquisition-costs/lots/${lot.id}/corrections`, { body: { expectedVersion: lot.version, unitCost: Number(unitCost), quantity: Number(quantity), reason: reason.trim() } }))
  const loadHistory = useCommand(async () => setHistory((await api<{ events: HistoryEvent[] }>(`/procurement/acquisition-costs/lots/${lot.id}/history`)).events))
  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        فاتورة <Code>{lot.invoiceRef}</Code> · <Code>{lot.quantity}</Code> قطعة × <Egp value={lot.unitCost} /> · {formatDateTime(lot.capturedAt)}
        <button type="button" className="underline" onClick={() => loadHistory.execute()}>السجل</button>
      </div>
      <CommandError error={loadHistory.error} />
      {history ? (
        <ul className="list-disc ps-5">
          {history.map((event) => (
            <li key={event.id}>{event.action === 'CAPTURED' ? 'تسجيل' : 'تصحيح'} · {formatDateTime(event.createdAt)}
              {event.previous ? <> · كانت <Code>{event.previous.unitCost}</Code> × <Code>{event.previous.quantity}</Code></> : null} · بقت <Code>{event.current.unitCost}</Code> × <Code>{event.current.quantity}</Code>{event.reason ? ` · ${event.reason}` : ''}</li>
          ))}
        </ul>
      ) : null}
      {canCorrect ? (
        <details>
          <summary className="cursor-pointer font-semibold">تصحيح (الإدارة فقط)</summary>
          <form className="mt-2 grid gap-2 md:grid-cols-4 md:items-end" onSubmit={async (e) => { e.preventDefault(); if (await correct.execute()) { setReason(''); onDone() } }}>
            <Field label="تكلفة القطعة" ltr inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            <Field label="الكمية" ltr inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            <Field label="سبب التصحيح" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button type="submit" variant="secondary" loading={correct.pending} disabled={reason.trim().length < 5 || !(Number(unitCost) > 0)}>حفظ التصحيح</Button>
          </form>
          <CommandError error={correct.error} />
        </details>
      ) : null}
    </li>
  )
}
