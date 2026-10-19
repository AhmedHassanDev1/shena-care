'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ShieldAlert, Store } from 'lucide-react'
import { Button, Code, DataTable, Field, Notice, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { CommandError, Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { SupplierPerformanceTable } from '@/components/admin/sourcing/supplier-performance-table'
import { api } from '@/lib/api'
import { PAYABLE_STATUS, PO_LINE_STATUS, PO_STATUS, SUPPLIER_EXCEPTIONS, formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

type SkuLabel = { productName: string; variantName: string; skuCode: string } | null
interface StaffPo {
  id: string; supplierId: string; status: string; batchRef: string | null; createdAt: string; readyAt: string | null; receivedAt: string | null
  lines: Array<{
    id: string; skuId: string; requestedQuantity: number; confirmedQuantity: number | null; status: string; unitCost: string | null
    exceptionCode: string | null; exceptionNote: string | null; proposedQuantity: number | null; proposedUnitCost: string | null
    distributionRequired: boolean; sku: SkuLabel
    allocations: Array<{ sourceAllocationId: string; orderId: string; quantity: number; confirmedQuantity: number | null; receivedQuantity: number }>
  }>
}
interface Payable { id: string; supplierName: string; purchaseOrderId: string; amount: number; status: string; paidAt: string | null; paymentRef: string | null }

/** Supplier purchase orders, scarce-stock decisions and supplier payables (W2). */
export default function AdminSourcing() {
  const suppliers = useApi<Array<{ id: string; name: string }>>('/sourcing/suppliers')
  const [status, setStatus] = React.useState('')
  const pos = useApi<{ total: number; items: StaffPo[] }>(`/purchase-orders?take=50${status ? `&status=${status}` : ''}`, { pollMs: 30000 })
  const payables = useApi<{ total: number; items: Payable[] }>('/sourcing/payables?take=50')
  const supplierName = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]))
  const [flushSupplier, setFlushSupplier] = React.useState('')
  const [flushResult, setFlushResult] = React.useState<string | null>(null)
  const flush = useCommand(() => api<{ purchaseOrders: unknown[] }>('/purchase-orders/batches', { body: flushSupplier ? { supplierId: flushSupplier } : {} }))
  const reloadAll = () => { pos.reload(); payables.reload() }

  return (
    <RoleShell role="admin" active="sourcing" mode="desktop">
      <Page>
        <PageHeader title="الموردين وأوامر الشراء" meta="أمر الشراء الواحد ممكن يغطي كذا طلب عميل؛ كل كمية مربوطة بطلبها." />

        {/* Exceptions Intervention Banner */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.04]">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-amber-500/15 text-[#f5a524] flex items-center justify-center shrink-0">
              <ShieldAlert className="size-4.5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white">استنفاد مسارات التوريد الآلية؟</h4>
              <p className="text-[11px] text-bw-ink-soft">
                في حال رفض الموردين أو انتهاء مهلة التأكيد دون بديل تلقائي متاح، يتم تصعيد الحالة فوراً لمركز الاستثناءات.
              </p>
            </div>
          </div>
          <Link
            href="/admin/exceptions"
            className="sc-btn sm secondary shrink-0 flex items-center gap-1.5 text-xs text-amber-400"
          >
            <span>مركز الاستثناءات</span>
            <ArrowLeft className="size-3.5" />
          </Link>
        </div>

        {/* Supplier Network Performance Section */}
        <Section title="أداء وموثوقية شبكة الموردين في القاهرة والجيزة">
          <div className="sc-card p-4 border-white/[0.08] bg-bw-surface space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-bw-ink-soft">
                متابعة معدلات التأكيد في الموعد ومتوسط سرعة استجابة الصيدليات الشريكة ومستودعات التوريد.
              </p>
              <span className="sc-badge t-success text-[11px]">محدّث لحظياً</span>
            </div>
            <SupplierPerformanceTable />
          </div>
        </Section>
          <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => {
            e.preventDefault()
            const done = await flush.execute()
            if (done) { setFlushResult(done.purchaseOrders.length ? `اتعمل ${done.purchaseOrders.length} أمر شراء جديد.` : 'مافيش طلبات معلقة محتاجة أمر شراء دلوقتي.'); reloadAll() }
          }}>
            <Select className="w-64" label="المورد" value={flushSupplier} onChange={setFlushSupplier}
              options={[['', 'كل الموردين'], ...(suppliers.data ?? []).map((s) => [s.id, s.name] as [string, string])]} />
            <Button type="submit" loading={flush.pending}>تجميع الآن</Button>
          </form>
          <div className="mt-2 space-y-2">
            {flushResult ? <Notice tone="ok" title={flushResult} /> : null}
            <CommandError error={flush.error} />
          </div>
        </Section>

        <Section title="أوامر الشراء" aside={
          <Select className="w-56" label="الحالة" value={status} onChange={setStatus} options={[['', 'الكل'], ...Object.entries(PO_STATUS).map(([k, [t]]) => [k, t] as [string, string])]} />
        }>
          {pos.error ? <LoadError message={pos.error.message} onRetry={pos.reload} /> : null}
          {!pos.data && pos.loading ? <Skeleton className="h-40 w-full" /> : null}
          {pos.data && pos.data.items.length === 0 ? <StateBlock kind="empty" title="مافيش أوامر شراء" /> : null}
          <div className="space-y-4">
            {pos.data?.items.map((po) => <PoCard key={po.id} po={po} supplier={supplierName.get(po.supplierId) ?? shortId(po.supplierId)} payable={payables.data?.items.find((p) => p.purchaseOrderId === po.id)} onChanged={reloadAll} />)}
          </div>
        </Section>

        <Section title="مستحقات الموردين">
          {payables.data && payables.data.items.length === 0 ? <p className="text-bw-small text-bw-ink-soft">مافيش مستحقات لسه. المستحق بيتحسب من الكمية اللي وصلت فعلاً × تكلفة أمر الشراء.</p> : null}
          {payables.data?.items.length ? (
            <DataTable caption="مستحقات الموردين" head={['المورد', 'أمر الشراء', 'المبلغ', 'الحالة', 'مرجع الدفع', '']}>
              {payables.data.items.map((p) => <PayableRow key={p.id} p={p} onChanged={payables.reload} />)}
            </DataTable>
          ) : null}
        </Section>
      </Page>
    </RoleShell>
  )
}

function PoCard({ po, supplier, payable, onChanged }: { po: StaffPo; supplier: string; payable?: Payable; onChanged: () => void }) {
  const createPayable = useCommand(() => api(`/sourcing/purchase-orders/${po.id}/payable`, { method: 'POST' }))
  return (
    <div className="rounded-bw-card border border-bw-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bw-line px-4 py-2">
        <p className="flex flex-wrap items-center gap-2"><Code>{shortId(po.id)}</Code> · {supplier} · <Status map={PO_STATUS} value={po.status} /></p>
        <p className="text-bw-small text-bw-ink-soft">{formatDateTime(po.createdAt)}{po.readyAt ? ` · جاهز ${formatDateTime(po.readyAt)}` : ''}{po.receivedAt ? ` · وصل ${formatDateTime(po.receivedAt)}` : ''}</p>
      </div>
      <div className="space-y-3 p-4">
        {po.lines.map((line) => (
          <div key={line.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-bw-small">
              <bdi className="font-semibold">{line.sku ? `${line.sku.productName} · ${line.sku.variantName}` : shortId(line.skuId)}</bdi>
              <span>مطلوب <Code>{line.requestedQuantity}</Code></span>
              <span>مؤكد <Code>{line.confirmedQuantity ?? '—'}</Code></span>
              <span>تكلفة <Egp value={line.unitCost} /></span>
              <Status map={PO_LINE_STATUS} value={line.status} />
              {line.exceptionCode ? <span className="text-bw-warn">{SUPPLIER_EXCEPTIONS[line.exceptionCode] ?? line.exceptionCode}{line.proposedQuantity ? <> · يقترح كمية <Code>{line.proposedQuantity}</Code></> : null}{line.proposedUnitCost ? <> · يقترح تكلفة <Egp value={line.proposedUnitCost} /></> : null}</span> : null}
            </div>
            <ul className="flex flex-wrap gap-2 text-bw-small">
              {line.allocations.map((a) => (
                <li key={a.sourceAllocationId} className="rounded-full bg-bw-sunken px-3 py-1">
                  <Link href={`/admin/orders/${a.orderId}`} className="underline">طلب <Code>{shortId(a.orderId)}</Code></Link>: <Code>{a.quantity}</Code> · مؤكد <Code>{a.confirmedQuantity ?? '—'}</Code> · وصل <Code>{a.receivedQuantity}</Code>
                </li>
              ))}
            </ul>
            {line.distributionRequired ? <Distribute po={po} line={line} onDone={onChanged} /> : null}
          </div>
        ))}
        {po.status === 'received_at_hub' ? (
          payable ? (
            <p className="text-bw-small">المستحق: <Egp value={payable.amount} /> · <Status map={PAYABLE_STATUS} value={payable.status} /></p>
          ) : (
            <div className="space-y-2">
              <Button variant="secondary" loading={createPayable.pending} onClick={async () => { if (await createPayable.execute()) onChanged() }}>حساب مستحق المورد</Button>
              <CommandError error={createPayable.error} />
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}

/** Admin scarce-stock decision: who gets the partial quantity. Audited by the API, never automatic. */
function Distribute({ po, line, onDone }: { po: StaffPo; line: StaffPo['lines'][number]; onDone: () => void }) {
  const [split, setSplit] = React.useState<Record<string, number>>({})
  const [reason, setReason] = React.useState('')
  const total = Object.values(split).reduce((s, n) => s + n, 0)
  const available = line.confirmedQuantity ?? 0
  const cmd = useCommand(() => api(`/purchase-orders/${po.id}/lines/${line.id}/distribute`, { body: {
    allocations: line.allocations.map((a) => ({ sourceAllocationId: a.sourceAllocationId, quantity: split[a.sourceAllocationId] ?? 0 })), reason: reason.trim(),
  } }))
  return (
    <form className="space-y-2 rounded-bw-field bg-bw-warn-soft p-3" onSubmit={async (e) => { e.preventDefault(); if (await cmd.execute()) onDone() }}>
      <p className="text-bw-small font-semibold">المورد أكّد <Code>{available}</Code> بس — وزّعهم على الطلبات</p>
      {line.allocations.map((a) => (
        <label key={a.sourceAllocationId} className="flex items-center gap-2 text-bw-small">
          طلب <Code>{shortId(a.orderId)}</Code> (طالب <Code>{a.quantity}</Code>)
          <input type="number" min={0} max={a.quantity} value={split[a.sourceAllocationId] ?? 0}
            onChange={(e) => setSplit({ ...split, [a.sourceAllocationId]: Math.max(0, Math.min(a.quantity, Number(e.target.value))) })}
            className="h-bw-control w-20 rounded-bw-field border-[1.5px] border-bw-line-field bg-bw-surface px-2 bw-code" />
        </label>
      ))}
      <Field label="سبب القرار" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button type="submit" loading={cmd.pending} disabled={total !== available || !reason.trim()}>تأكيد التوزيع (<Code>{`${total}/${available}`}</Code>)</Button>
      <CommandError error={cmd.error} />
    </form>
  )
}

function PayableRow({ p, onChanged }: { p: Payable; onChanged: () => void }) {
  const [ref, setRef] = React.useState('')
  const cmd = useCommand(() => api(`/sourcing/payables/${p.id}/mark-paid`, { method: 'PATCH', body: { paymentRef: ref.trim() } }))
  return (
    <tr>
      <td>{p.supplierName}</td>
      <td><Code>{shortId(p.purchaseOrderId)}</Code></td>
      <td><Egp value={p.amount} /></td>
      <td><Status map={PAYABLE_STATUS} value={p.status} /></td>
      <td>{p.paymentRef ? <Code>{p.paymentRef}</Code> : '—'}</td>
      <td>
        {p.status !== 'paid' ? (
          <form className="flex items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (await cmd.execute()) onChanged() }}>
            <input aria-label="مرجع التحويل" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="مرجع التحويل" dir="ltr"
              className="h-bw-control w-40 rounded-bw-field border-[1.5px] border-bw-line-field px-2" />
            <Button type="submit" variant="secondary" loading={cmd.pending} disabled={!ref.trim()}>اتدفع</Button>
          </form>
        ) : formatDateTime(p.paidAt)}
        <CommandError error={cmd.error} />
      </td>
    </tr>
  )
}
