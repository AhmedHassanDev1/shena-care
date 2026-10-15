'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ExternalLink, MapPin } from 'lucide-react'
import { Button, Code, DataTable, Field, Notice, PageHeader, Section, Skeleton, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Egp, KeyValues, Page, Select, Status, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import {
  CANCEL_REASONS, COLLECTION_STATUS, FAILURE_REASONS, INSTRUCTION_REASONS, ORDER_STATUS, PAYABLE_STATUS, PO_LINE_STATUS, PO_STATUS,
  SHIPMENT_STATUS, SUPPLIER_EXCEPTIONS, formatDateTime, shortId,
} from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

type SkuLabel = { productName: string; brandName: string | null; variantName: string; skuCode: string; barcode: string | null } | null
interface Detail {
  order: {
    id: string; orderNumber: string; status: string; customerName: string; customerPhone: string; shippingAddress: string
    governorate: string | null; area: string | null; notes: string | null; latitude: number | null; longitude: number | null
    locationSource: string | null; subtotal: number | null; shippingFee: number; totalAmount: number; codAmount: number | null
    paymentMethod?: string; createdAt: string
    items: Array<{ id: string; skuId: string; quantity: number; price: number; productName?: string | null; variantName?: string | null; sku: SkuLabel }>
  }
  timeline: { statusEvents: Array<{ status: string; at: string }>; deliveryInstructions: Array<{ id: string; note: string; reason: string; at: string }> }
  supplyPlan: { status: string } | null
  purchaseOrderLines: Array<{
    purchaseOrderId: string; purchaseOrderStatus: string; supplierName: string | null; lineStatus: string; skuId: string
    quantity: number; confirmedQuantity: number | null; receivedQuantity: number; shortQuantity: number; unitCost: number | null
    exceptionCode: string | null; distributionRequired: boolean; sku: SkuLabel; shortfalls: Array<{ quantity: number; reasonCode: string }>
  }>
  payables: Array<{ id: string; purchaseOrderId: string; amount: number; status: string; paymentRef: string | null }>
  fulfillment: {
    shipment: null | {
      id: string; status: string; location: { name: string }; dispatchedAt: string | null; deliveredAt: string | null
      events: Array<{ id: string; type: string; reasonCode: string | null; createdAt: string }>
      attempts: Array<{ stopId: string; outcome: string; runStatus: string; driverId: string | null; closedAt: string | null }>
    }
    receipts: Array<{ id: string; skuId: string; quantity: number; condition: string; identityMethod: string; lotNumber: string | null; expiryDate: string | null; receivedAt: string }>
  }
  money: {
    collection: null | { status: string; expectedAmount: number | null; declaredAmount: number | null; countedAmount: number | null; settlement: { reference: string; settledAt: string } | null }
    resolutions: Array<{ id: string; type: string; status: string; reasonCode: string | null; createdAt: string; items: Array<{ orderItemId: string; quantity: number }>
      refund: null | { amount: number | null; status: string; providerRef: string | null; paymentProvider: string | null } }>
  }
  supportCases: Array<{ id: string; status: string; priority: string; title: string; createdAt: string }>
  events: Array<{ id: string; eventType: string; consumer: string; status: string; attempts: number; lastError: string | null }>
}

const skuText = (sku: SkuLabel, fallback?: string | null) => (sku ? `${sku.productName} · ${sku.variantName}` : fallback ?? '—')

export default function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, error, loading, reload } = useApi<Detail>(`/admin/orders/${encodeURIComponent(id)}`)

  return (
    <RoleShell role="admin" active="orders" mode="desktop">
      <Page>
        <Link href="/admin/orders" className="text-bw-small text-bw-ink-soft underline">← كل الطلبات</Link>
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-96 w-full" /> : null}
        {data ? <OrderBody d={data} reload={reload} /> : null}
      </Page>
    </RoleShell>
  )
}

function OrderBody({ d, reload }: { d: Detail; reload: () => void }) {
  const o = d.order
  const shipment = d.fulfillment.shipment
  return (
    <>
      <PageHeader
        eyebrow="طلب"
        title={o.orderNumber}
        meta={<span className="flex flex-wrap items-center gap-2"><Status map={ORDER_STATUS} value={o.status} /> اتطلب {formatDateTime(o.createdAt)}</span>}
        actions={<Button variant="secondary" onClick={reload}>تحديث</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="العميل والتوصيل" className="lg:col-span-2">
          <KeyValues rows={[
            ['الاسم', o.customerName],
            ['الموبايل', <a key="p" href={`tel:${o.customerPhone}`} className="underline"><Code>{o.customerPhone}</Code></a>],
            ['العنوان', [o.shippingAddress, o.area, o.governorate].filter(Boolean).join('، ')],
            ['ملاحظات', o.notes ?? '—'],
            ['الموقع المؤكد', o.latitude !== null && o.longitude !== null ? (
              <a key="m" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline" href={`https://www.google.com/maps?q=${o.latitude},${o.longitude}`}>
                <MapPin className="size-4" aria-hidden /><Code>{`${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)}`}</Code> ({o.locationSource ?? '—'}) <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : <StatusLabel key="np" tone="danger">مافيش دبوس مؤكد — مايتشحنش</StatusLabel>],
          ]} />
          {d.timeline.deliveryInstructions.length ? (
            <ul className="mt-3 space-y-1 text-bw-small">
              {d.timeline.deliveryInstructions.map((i) => (
                <li key={i.id} className="rounded-bw-field bg-bw-sunken px-3 py-2">{INSTRUCTION_REASONS[i.reason] ?? i.reason}: {i.note} · {formatDateTime(i.at)}</li>
              ))}
            </ul>
          ) : null}
          <InstructionForm orderId={o.id} disabled={['delivered', 'cancelled', 'returned'].includes(o.status)} onDone={reload} />
        </Section>

        <Section title="المبلغ">
          <KeyValues rows={[
            ['المنتجات', <Egp key="s" value={o.subtotal} />],
            ['التوصيل', <Egp key="f" value={o.shippingFee} />],
            ['الإجمالي', <Egp key="t" value={o.totalAmount} />],
            ['عند الاستلام', <Egp key="c" value={o.codAmount} />],
            ['التحصيل', d.money.collection ? <Status key="cs" map={COLLECTION_STATUS} value={d.money.collection.status} /> : 'لسه ماتسجّلش (قبل خروج الطرد)'],
            ['متوقع', <Egp key="e" value={d.money.collection?.expectedAmount} />],
            ['أعلن المندوب', <Egp key="d" value={d.money.collection?.declaredAmount} />],
            ['اتعدّ في المخزن', <Egp key="n" value={d.money.collection?.countedAmount} />],
            ['التسوية', d.money.collection?.settlement ? <Code key="r">{d.money.collection.settlement.reference}</Code> : '—'],
          ]} />
        </Section>
      </div>

      <Section title="المنتجات">
        <DataTable caption="منتجات الطلب" head={['المنتج', 'الكود', 'الكمية', 'سعر القطعة']}>
          {o.items.map((item) => (
            <tr key={item.id}>
              <td><bdi>{skuText(item.sku, item.productName)}</bdi></td>
              <td><Code>{item.sku?.skuCode ?? '—'}</Code></td>
              <td><Code>{item.quantity}</Code></td>
              <td><Egp value={item.price} /></td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="التوفير من الموردين" aside={d.supplyPlan ? <StatusLabel tone="neutral">خطة التوفير: {d.supplyPlan.status}</StatusLabel> : <StatusLabel tone="pending">لسه مافيش خطة</StatusLabel>}>
        {d.purchaseOrderLines.length === 0 ? (
          <p className="text-bw-small text-bw-ink-soft">مفيش أمر شراء مرتبط لسه. الطلبات بتتجمّع في أوامر شراء من صفحة الموردين.</p>
        ) : (
          <DataTable caption="أوامر الشراء المرتبطة" head={['أمر الشراء', 'المورد', 'المنتج', 'لهذا الطلب', 'مؤكد', 'وصل', 'ناقص', 'التكلفة', 'الحالة']}>
            {d.purchaseOrderLines.map((l) => (
              <tr key={l.purchaseOrderId + l.skuId}>
                <td><Code>{shortId(l.purchaseOrderId)}</Code><div><Status map={PO_STATUS} value={l.purchaseOrderStatus} /></div></td>
                <td>{l.supplierName ?? '—'}</td>
                <td><bdi>{skuText(l.sku)}</bdi></td>
                <td><Code>{l.quantity}</Code></td>
                <td><Code>{l.confirmedQuantity ?? '—'}</Code></td>
                <td><Code>{l.receivedQuantity}</Code></td>
                <td><Code>{l.shortQuantity}</Code>{l.shortfalls.map((s, i) => <div key={i} className="text-bw-small">{s.reasonCode}</div>)}</td>
                <td><Egp value={l.unitCost} /></td>
                <td>
                  <Status map={PO_LINE_STATUS} value={l.lineStatus} />
                  {l.exceptionCode ? <div className="text-bw-small text-bw-warn">{SUPPLIER_EXCEPTIONS[l.exceptionCode] ?? l.exceptionCode}</div> : null}
                  {l.distributionRequired ? <div className="text-bw-small text-bw-warn">محتاج قرار توزيع</div> : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
        {d.payables.length ? (
          <ul className="mt-3 space-y-1 text-bw-small">
            {d.payables.map((p) => (
              <li key={p.id}>مستحق للمورد عن أمر <Code>{shortId(p.purchaseOrderId)}</Code>: <Egp value={p.amount} /> · <Status map={PAYABLE_STATUS} value={p.status} /> {p.paymentRef ? <Code>{p.paymentRef}</Code> : null}</li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="المخزن والتوصيل" aside={shipment ? <Status map={SHIPMENT_STATUS} value={shipment.status} /> : null}>
        {d.fulfillment.receipts.length ? (
          <div className="mb-3">
            <p className="mb-1 text-bw-small font-semibold">الاستلام في المخزن</p>
            <ul className="space-y-1 text-bw-small">
              {d.fulfillment.receipts.map((r) => (
                <li key={r.id}><Code>{r.quantity}</Code> قطعة · {r.condition} · تحقق: {r.identityMethod}{r.lotNumber ? <> · تشغيلة <Code>{r.lotNumber}</Code></> : null}{r.expiryDate ? <> · صلاحية <Code>{r.expiryDate.slice(0, 10)}</Code></> : null} · {formatDateTime(r.receivedAt)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {!shipment ? <p className="text-bw-small text-bw-ink-soft">الطرد بيتعمل لما البضاعة توصل المخزن.</p> : (
          <div className="grid gap-4 md:grid-cols-2">
            <ol className="space-y-1 text-bw-small">
              {shipment.events.map((e) => (
                <li key={e.id}><Code>{e.type}</Code>{e.reasonCode ? ` · ${FAILURE_REASONS[e.reasonCode] ?? e.reasonCode}` : ''} · {formatDateTime(e.createdAt)}</li>
              ))}
            </ol>
            <div className="space-y-1 text-bw-small">
              <p>المخزن: {shipment.location.name}</p>
              {shipment.attempts.map((a, i) => (
                <p key={a.stopId}>محاولة <Code>{i + 1}</Code>: {a.outcome} · مشوار {a.runStatus} · مندوب <Code>{shortId(a.driverId)}</Code>{a.closedAt ? ` · ${formatDateTime(a.closedAt)}` : ''}</p>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Resolutions d={d} reload={reload} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="الحالات والاستثناءات">
          {d.supportCases.length === 0 ? <p className="text-bw-small text-bw-ink-soft">مافيش.</p> : (
            <ul className="space-y-1 text-bw-small">{d.supportCases.map((c) => <li key={c.id}>{c.title} · {c.status} · {c.priority}</li>)}</ul>
          )}
        </Section>
        <Section title="أحداث النظام">
          <ul className="space-y-1 text-bw-small">{d.events.map((e) => <li key={e.id}><Code>{e.eventType}</Code> → {e.consumer}: {e.status}{e.lastError ? ` · ${e.lastError}` : ''}</li>)}</ul>
        </Section>
      </div>

      <CancelOrder orderId={o.id} status={o.status} onDone={reload} />
    </>
  )
}

function InstructionForm({ orderId, disabled, onDone }: { orderId: string; disabled: boolean; onDone: () => void }) {
  const [note, setNote] = React.useState('')
  const [reason, setReason] = React.useState('ADDRESS_CLARIFICATION')
  const cmd = useCommand(() => api(`/ordering/orders/${orderId}/delivery-instructions`, { body: { note: note.trim(), reason } }))
  if (disabled) return null
  return (
    <form className="mt-3 grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end" onSubmit={async (e) => { e.preventDefault(); if (await cmd.execute()) { setNote(''); onDone() } }}>
      <Select label="تعليمات للمندوب" value={reason} onChange={setReason} options={Object.entries(INSTRUCTION_REASONS)} />
      <Field label="النص (الدبوس الأصلي للعميل مابيتغيرش)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" variant="secondary" loading={cmd.pending} disabled={!note.trim()}>إضافة</Button>
      <div className="sm:col-span-3"><CommandError error={cmd.error} /></div>
    </form>
  )
}

function CancelOrder({ orderId, status, onDone }: { orderId: string; status: string; onDone: () => void }) {
  const [reason, setReason] = React.useState('CUSTOMER_REQUEST')
  const [notes, setNotes] = React.useState('')
  const [result, setResult] = React.useState<{ goodsReceived: boolean; exceptionCaseId?: string } | null>(null)
  const cmd = useCommand(() => api<{ goodsReceived: boolean; exceptionCaseId?: string }>(`/ordering/orders/${orderId}/cancel`, { body: { reasonCode: reason, ...(notes.trim() ? { notes: notes.trim() } : {}) } }))
  if (['delivered', 'cancelled', 'returned'].includes(status)) return null
  return (
    <Section title="إلغاء الطلب">
      <p className="mb-2 text-bw-small text-bw-ink-soft">الإلغاء مسموح قبل ما الطرد يبقى في عهدة المندوب بس؛ الـAPI بيرفض بعد كده ويطلب مسار المرتجع.</p>
      {result ? <Notice tone="ok" title="الطلب اتلغى">{result.goodsReceived ? 'البضاعة كانت وصلت المخزن — اتفتحت حالة استثناء لمتابعتها.' : 'مافيش بضاعة اتستلمت.'}</Notice> : null}
      <form className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-end" onSubmit={async (e) => {
        e.preventDefault()
        if (!window.confirm('تأكيد إلغاء الطلب؟')) return
        const done = await cmd.execute()
        if (done) { setResult(done); onDone() }
      }}>
        <Select label="السبب" value={reason} onChange={setReason} options={Object.entries(CANCEL_REASONS)} />
        <Field label="ملاحظة" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button type="submit" variant="danger" loading={cmd.pending}>إلغاء الطلب</Button>
      </form>
      <div className="mt-2"><CommandError error={cmd.error} /></div>
    </Section>
  )
}

function Resolutions({ d, reload }: { d: Detail; reload: () => void }) {
  const [type, setType] = React.useState('return')
  const [reasonCode, setReasonCode] = React.useState('')
  const [quantities, setQuantities] = React.useState<Record<string, number>>({})
  const open = useCommand(() => api('/ordering/resolutions', { body: {
    orderId: d.order.id, type, actorId: 'staff', ...(reasonCode.trim() ? { reasonCode: reasonCode.trim() } : {}),
    items: Object.entries(quantities).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
  } }))
  const canOpen = ['delivered', 'shipped', 'returned'].includes(d.order.status)
  return (
    <Section title="المرتجعات والاستردادات">
      {d.money.resolutions.length === 0 ? <p className="text-bw-small text-bw-ink-soft">مافيش طلبات مرتجع أو استرداد.</p> : (
        <div className="space-y-3">{d.money.resolutions.map((r) => <ResolutionRow key={r.id} r={r} reload={reload} />)}</div>
      )}
      {canOpen ? (
        <form className="mt-4 space-y-2 border-t border-bw-line pt-3" onSubmit={async (e) => { e.preventDefault(); if (await open.execute()) { setQuantities({}); reload() } }}>
          <p className="text-bw-small font-semibold">فتح حالة جديدة</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select label="النوع" value={type} onChange={setType} options={[['return', 'مرتجع'], ['refund', 'استرداد'], ['replacement', 'استبدال'], ['compensation', 'تعويض']]} />
            <Field label="كود السبب" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} />
          </div>
          <ul className="space-y-1 text-bw-small">
            {d.order.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <input aria-label={`كمية ${skuText(item.sku, item.productName)}`} type="number" min={0} max={item.quantity} value={quantities[item.id] ?? 0}
                  onChange={(e) => setQuantities({ ...quantities, [item.id]: Math.max(0, Math.min(item.quantity, Number(e.target.value))) })}
                  className="h-bw-control w-20 rounded-bw-field border-[1.5px] border-bw-line-field px-2 bw-code" />
                <bdi>{skuText(item.sku, item.productName)}</bdi> (من <Code>{item.quantity}</Code>)
              </li>
            ))}
          </ul>
          <Button type="submit" variant="secondary" loading={open.pending}>فتح الحالة</Button>
          <CommandError error={open.error} />
        </form>
      ) : null}
    </Section>
  )
}

function ResolutionRow({ r, reload }: { r: Detail['money']['resolutions'][number]; reload: () => void }) {
  const [amount, setAmount] = React.useState('')
  const [provider, setProvider] = React.useState('cash')
  const [proof, setProof] = React.useState('')
  const status = useCommand((next: string) => api(`/ordering/resolutions/${r.id}/status`, { method: 'PATCH', body: { status: next, actorId: 'staff' } }))
  const refund = useCommand(() => api(`/ordering/resolutions/${r.id}/refund`, { body: { amount: Number(amount), currency: 'EGP', paymentProvider: provider } }))
  const paid = useCommand(() => api(`/ordering/resolutions/${r.id}/refund/status`, { method: 'PATCH', body: { status: 'succeeded', providerRef: proof.trim() } }))
  const run = async (p: Promise<unknown>) => { if (await p) reload() }
  return (
    <div className="space-y-2 rounded-bw-field border border-bw-line p-3">
      <p className="flex flex-wrap items-center gap-2 text-bw-small">
        <Code>{r.type}</Code> · <StatusLabel tone={r.status === 'rejected' ? 'danger' : r.status === 'resolved' ? 'ok' : 'warn'}>{r.status}</StatusLabel>
        {r.reasonCode ? <> · {r.reasonCode}</> : null} · {formatDateTime(r.createdAt)} · قطع: <Code>{r.items.reduce((s, i) => s + i.quantity, 0)}</Code>
      </p>
      {r.status === 'requested' ? (
        <div className="flex gap-2">
          <Button variant="secondary" loading={status.pending} onClick={() => run(status.execute('approved'))}>موافقة</Button>
          <Button variant="danger" loading={status.pending} onClick={() => run(status.execute('rejected'))}>رفض</Button>
        </div>
      ) : null}
      {r.status === 'approved' && !r.refund ? (
        <form className="grid gap-2 sm:grid-cols-[8rem_10rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); run(refund.execute()) }}>
          <Field label="مبلغ الاسترداد" ltr inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Select label="طريقة الدفع" value={provider} onChange={setProvider} options={[['cash', 'كاش'], ['bank_transfer', 'تحويل بنكي'], ['vodafone_cash', 'فودافون كاش'], ['instapay', 'إنستاباي']]} />
          <Button type="submit" variant="secondary" loading={refund.pending} disabled={!(Number(amount) > 0)}>بدء الاسترداد</Button>
        </form>
      ) : null}
      {r.refund ? (
        <p className="text-bw-small">استرداد <Egp value={r.refund.amount} /> · {r.refund.paymentProvider ?? '—'} · <StatusLabel tone={r.refund.status === 'succeeded' ? 'ok' : r.refund.status === 'failed' ? 'danger' : 'pending'}>{r.refund.status}</StatusLabel> {r.refund.providerRef ? <>إثبات: <Code>{r.refund.providerRef}</Code></> : null}</p>
      ) : null}
      {r.refund && ['pending', 'processing'].includes(r.refund.status) ? (
        <form className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); run(paid.execute()) }}>
          <Field label="مرجع إثبات الدفع (إجباري)" ltr value={proof} onChange={(e) => setProof(e.target.value)} />
          <Button type="submit" loading={paid.pending} disabled={!proof.trim()}>تأكيد إن الاسترداد اتدفع</Button>
        </form>
      ) : null}
      <CommandError error={status.error ?? refund.error ?? paid.error} />
    </div>
  )
}
