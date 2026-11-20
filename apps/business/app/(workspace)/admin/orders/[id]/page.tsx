'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, MapPin, RefreshCw, XCircle } from 'lucide-react'
import { Button, Code, DataTable, Field, Notice, PageHeader, Section, Skeleton, StatusLabel } from '@/components/bw/primitives'
import { CopyId } from '@/components/workspace/copy-id'
import { CommandError, Egp, KeyValues, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import {
  CANCEL_REASONS, COLLECTION_STATUS, FAILURE_REASONS, INSTRUCTION_REASONS, ORDER_STATUS, PAYABLE_STATUS, PO_LINE_STATUS, PO_STATUS,
  SHIPMENT_STATUS, SUPPLIER_EXCEPTIONS, formatDateTime, shortId,
} from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

type SkuLabel = { productName: string; brandName: string | null; variantName: string; skuCode: string; barcode: string | null } | null

interface OrderItemDetail {
  id: string
  skuId: string
  quantity: number
  price: number
  productId?: string | null
  productName?: string | null
  variantName?: string | null
  skuCode?: string | null
  discountAmount?: number | null
  lineTotal?: number | null
  sku: SkuLabel
}

interface Detail {
  order: {
    id: string; orderNumber: string; status: string; customerName: string; customerPhone: string; shippingAddress: string
    governorate: string | null; area: string | null; notes: string | null; latitude: number | null; longitude: number | null
    locationSource: string | null; subtotal: number | null; shippingFee: number; totalAmount: number; codAmount: number | null
    paymentMethod?: string; createdAt: string
    items: OrderItemDetail[]
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

/** Robust SKU text resolution: uses live catalog labels if present, falls back cleanly to snapshot data */
const skuText = (sku: SkuLabel, fallbackName?: string | null, fallbackVariant?: string | null) => {
  if (sku) {
    return `${sku.productName}${sku.variantName ? ` · ${sku.variantName}` : ''}`
  }
  const parts = [fallbackName, fallbackVariant].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

type StageMeta = { title: string; responsible: string; nextAction: string; tone: 'neutral' | 'warn' | 'ok' | 'danger' }

const STAGE_ACTION: Record<string, StageMeta> = {
  placed: {
    title: 'بانتظار توفير المنتجات من الموردين',
    responsible: 'فريق المشتريات والتوريد (Sourcing)',
    nextAction: 'إصدار أوامر الشراء ومتابعة تأكيد الموردين للكميات والأسعار.',
    tone: 'warn',
  },
  confirmed: {
    title: 'تم تأكيد التوفر — بانتظار استلام البضاعة',
    responsible: 'فريق المخزن (Hub Receiving)',
    nextAction: 'فحص واستلام المنتجات في المخزن فور وصولها.',
    tone: 'neutral',
  },
  packing: {
    title: 'البضاعة بالمخزن — جاري التجهيز والتغليف',
    responsible: 'فريق التجهيز (Hub Packing)',
    nextAction: 'فحص الجودة وتغليف الطرد وطباعة بوليصة الشحن.',
    tone: 'neutral',
  },
  shipped: {
    title: 'الشحنة مع المندوب للتسليم',
    responsible: 'مندوب التوصيل (Courier / Delivery)',
    nextAction: 'تسليم الطرد للعميل وتحصيل قيمة الطلب.',
    tone: 'neutral',
  },
  delivered: {
    title: 'تم التسليم بنجاح للعميل',
    responsible: 'أمين الخزينة (Cashier / Finance)',
    nextAction: 'مراجعة وتوريد النقدية المحصلة في الخزينة وإتمام تسوية الجولة.',
    tone: 'ok',
  },
  cancelled: {
    title: 'الطلب ملغي',
    responsible: 'إدارة العمليات (Operations)',
    nextAction: 'الطلب ملغي؛ راجع مسار المرتجع إن كانت هناك بضاعة وردت بالمخزن.',
    tone: 'danger',
  },
  returned: {
    title: 'مرتجع إلى المخزن',
    responsible: 'فريق المرتجعات (Hub Returns)',
    nextAction: 'فحص حالة المنتجات المرتجعة وإعادة إدراجها بالمخزون.',
    tone: 'warn',
  },
}

export default function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, error, loading, reload } = useApi<Detail>(`/admin/orders/${encodeURIComponent(id)}`)

  return (
    <RoleShell role="admin" active="orders" mode="responsive">
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-9" dir="rtl">
        <Link href="/admin/orders" className="inline-flex items-center gap-2 text-bw-small text-bw-ink-soft hover:text-bw-ink"><ArrowRight className="size-4" />كل الطلبات</Link>
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-96 w-full" /> : null}
        {data ? <OrderBody d={data} reload={reload} /> : null}
      </main>
    </RoleShell>
  )
}

function OrderBody({ d, reload }: { d: Detail; reload: () => void }) {
  const o = d.order
  const shipment = d.fulfillment.shipment
  const shortages = d.purchaseOrderLines.filter((line) => line.shortQuantity > 0 || line.exceptionCode || line.distributionRequired)
  const activeCases = d.supportCases.filter((supportCase) => !['closed', 'resolved'].includes(supportCase.status.toLowerCase()))
  const missingPin = o.latitude === null || o.longitude === null
  const isClosed = ['delivered', 'cancelled', 'returned'].includes(o.status)

  const stage = STAGE_ACTION[o.status] ?? {
    title: o.status,
    responsible: 'إدارة العمليات (Operations)',
    nextAction: 'متابعة سير الطلب مع الأقسام المعنية.',
    tone: 'neutral' as const,
  }

  // Financial calculations: verify products subtotal and compute explicit order discount
  const itemsSubtotal = o.subtotal ?? o.items.reduce((sum, item) => sum + (item.lineTotal ?? item.price * item.quantity), 0)
  const effectiveOrderDiscount = Math.max(0, Math.round(((itemsSubtotal + o.shippingFee) - o.totalAmount) * 100) / 100)

  return (
    <>
      <PageHeader
        eyebrow="تفاصيل الطلب"
        title={<CopyId value={o.orderNumber} label="رقم الطلب" textClassName="text-bw-title" />}
        meta={<span className="flex flex-wrap items-center gap-2"><Status map={ORDER_STATUS} value={o.status} /><span>أنشئ {formatDateTime(o.createdAt)}</span></span>}
        actions={<Button variant="secondary" onClick={reload}><RefreshCw className="size-4" />تحديث</Button>}
      />

      {/* 1. Status & Responsibility Banner: Clear, actionable operational progress */}
      <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bw-line pb-3">
          <div className="flex items-center gap-2.5">
            <Status map={ORDER_STATUS} value={o.status} />
            <strong className="text-bw-small sm:text-bw-body text-bw-ink">{stage.title}</strong>
          </div>
          <span className="text-bw-small text-bw-ink-soft">
            المسؤول الحالي: <strong className="font-semibold text-bw-ink">{stage.responsible}</strong>
          </span>
        </div>
        <p className="mt-2.5 text-bw-small text-bw-ink-soft">
          <span className="font-semibold text-bw-ink">الخطوة المطلوبة:</span> {stage.nextAction}
        </p>
      </div>

      {/* 2. Urgent Attention Alerts (only rendered when there is an actual problem) */}
      {(missingPin || shortages.length > 0 || activeCases.length > 0) ? (
        <div className="rounded-bw-card border border-bw-warn/35 bg-bw-warn-soft/50 p-4 sm:p-5" role="status">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-bw-warn" aria-hidden />
            <div className="space-y-1.5">
              <h2 className="font-semibold text-bw-ink">يحتاج متابعة وتدخل</h2>
              {missingPin && !isClosed ? (
                <p className="text-bw-small text-bw-ink-soft">
                  <strong className="text-bw-danger">موقع التسليم غير مؤكد:</strong> يرجى التواصل مع العميل لتحديد الموقع أو تسجيل تعليمات المندوب لتفادي تعثر الشحن.
                </p>
              ) : null}
              {shortages.length > 0 ? (
                <p className="text-bw-small text-bw-ink-soft">
                  <strong className="text-bw-warn">نقص أو استثناء توريد:</strong> يوجد <Code>{shortages.length}</Code> بنود بها نقص أو تتطلب قرار توزيع في قسم المشتريات.
                </p>
              ) : null}
              {activeCases.length > 0 ? (
                <p className="text-bw-small text-bw-ink-soft">
                  <strong className="text-bw-amber">تذاكر دعم مفتوحة:</strong> يوجد <Code>{activeCases.length}</Code> تذاكر مرتبطة بهذا الطلب.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* 3. Customer, Delivery & Payment Overview */}
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
          {!isClosed ? (
            <InstructionForm orderId={o.id} disabled={isClosed} onDone={reload} />
          ) : null}
        </Section>

        <Section title="ملخص الدفع">
          <KeyValues rows={[
            ['المنتجات', <Egp key="s" value={itemsSubtotal} />],
            ...(effectiveOrderDiscount > 0 ? [['الخصم', <span key="disc" className="font-semibold text-bw-ok">- <Egp value={effectiveOrderDiscount} /></span>] as [string, React.ReactNode]] : []),
            ['التوصيل', <Egp key="f" value={o.shippingFee} />],
            ['الإجمالي', <strong key="t" className="text-bw-body font-semibold leading-tight text-bw-ink"><Egp value={o.totalAmount} /></strong>],
            ['عند الاستلام', <Egp key="c" value={o.codAmount} />],
          ]} />
          <details className="mt-5 border-t border-bw-line pt-4 text-bw-small">
            <summary className="cursor-pointer font-semibold text-bw-ink-soft hover:text-bw-ink">تفاصيل التحصيل والتسوية</summary>
            <div className="mt-4">
              <KeyValues rows={[
                ['حالة التحصيل', d.money.collection ? <Status key="cs" map={COLLECTION_STATUS} value={d.money.collection.status} /> : 'لسه ماتسجّلش (قبل خروج الطرد)'],
                ['المتوقع', <Egp key="e" value={d.money.collection?.expectedAmount} />],
                ['أعلن المندوب', <Egp key="d" value={d.money.collection?.declaredAmount} />],
                ['اتعدّ في المخزن', <Egp key="n" value={d.money.collection?.countedAmount} />],
                ['التسوية', d.money.collection?.settlement ? <CopyId key="r" value={d.money.collection.settlement.reference} label="مرجع التسوية" /> : '—'],
              ]} />
            </div>
          </details>
        </Section>
      </div>

      {/* 4. Products Table with Line Totals & Fallback Snapshots */}
      <Section title="المنتجات">
        <DataTable caption="منتجات الطلب" head={['المنتج', 'الكود', 'الكمية', 'سعر القطعة', 'إجمالي البند']}>
          {o.items.map((item) => {
            const lineTotalCalc = item.lineTotal ?? (item.price * item.quantity - (item.discountAmount ?? 0))
            return (
              <tr key={item.id}>
                <td><bdi>{skuText(item.sku, item.productName, item.variantName)}</bdi></td>
                <td><Code>{item.sku?.skuCode ?? item.skuCode ?? '—'}</Code></td>
                <td><Code>{item.quantity}</Code></td>
                <td><Egp value={item.price} /></td>
                <td>
                  <span className="font-semibold text-bw-ink"><Egp value={lineTotalCalc} /></span>
                  {item.discountAmount ? <span className="block text-[11px] text-bw-ok">خصم: <Egp value={item.discountAmount} /></span> : null}
                </td>
              </tr>
            )
          })}
        </DataTable>
      </Section>

      {/* 5. Sourcing & Supplier Purchase Orders */}
      {d.purchaseOrderLines.length > 0 ? (
        <details className="group rounded-bw-card border border-bw-line bg-bw-surface" open={shortages.length > 0}>
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-5 font-semibold text-bw-ink">
            <span>التوريد من الموردين <span className="ms-2 text-bw-small font-normal text-bw-ink-soft">({d.purchaseOrderLines.length} بند)</span></span>
            <span className="flex items-center gap-2 text-bw-small font-normal">
              {shortages.length ? <StatusLabel tone="warn">{shortages.length} استثناء</StatusLabel> : null}
              {d.supplyPlan ? <StatusLabel tone="neutral">{d.supplyPlan.status}</StatusLabel> : <StatusLabel tone="pending">لا توجد خطة بعد</StatusLabel>}
            </span>
          </summary>
          <div className="border-t border-bw-line p-5">
            <DataTable caption="أوامر الشراء المرتبطة" head={['أمر الشراء', 'المورد', 'المنتج', 'لهذا الطلب', 'مؤكد', 'وصل', 'ناقص', 'التكلفة', 'الحالة']}>
              {d.purchaseOrderLines.map((l) => {
                const matchedItem = o.items.find((i) => i.skuId === l.skuId)
                return (
                  <tr key={l.purchaseOrderId + l.skuId}>
                    <td><CopyId value={l.purchaseOrderId} display={shortId(l.purchaseOrderId)} label="رقم أمر الشراء" /><div><Status map={PO_STATUS} value={l.purchaseOrderStatus} /></div></td>
                    <td>{l.supplierName ?? '—'}</td>
                    <td><bdi>{skuText(l.sku, matchedItem?.productName, matchedItem?.variantName)}</bdi></td>
                    <td><Code>{l.quantity}</Code></td>
                    <td><Code>{l.confirmedQuantity ?? '—'}</Code></td>
                    <td><Code>{l.receivedQuantity}</Code></td>
                    <td><Code>{l.shortQuantity}</Code>{l.shortfalls.map((s, i) => <div key={i} className="text-bw-small text-bw-warn">{s.reasonCode}</div>)}</td>
                    <td><Egp value={l.unitCost} /></td>
                    <td>
                      <Status map={PO_LINE_STATUS} value={l.lineStatus} />
                      {l.exceptionCode ? <div className="text-bw-small text-bw-warn">{SUPPLIER_EXCEPTIONS[l.exceptionCode] ?? l.exceptionCode}</div> : null}
                      {l.distributionRequired ? <div className="text-bw-small text-bw-warn">محتاج قرار توزيع</div> : null}
                    </td>
                  </tr>
                )
              })}
            </DataTable>
            {d.payables.length ? (
              <ul className="mt-3 space-y-1 text-bw-small">
                {d.payables.map((p) => (
                  <li key={p.id}>مستحق للمورد عن أمر <Code>{shortId(p.purchaseOrderId)}</Code>: <Egp value={p.amount} /> · <Status map={PAYABLE_STATUS} value={p.status} /> {p.paymentRef ? <Code>{p.paymentRef}</Code> : null}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ) : null}

      {/* 6. Fulfillment & Shipment */}
      {(shipment || d.fulfillment.receipts.length > 0) ? (
        <details className="rounded-bw-card border border-bw-line bg-bw-surface" open={['packing', 'shipped'].includes(o.status)}>
          <summary className="flex cursor-pointer items-center justify-between gap-3 p-5 font-semibold text-bw-ink">
            <span>المخزن والتوصيل</span>
            {shipment ? <Status map={SHIPMENT_STATUS} value={shipment.status} /> : <StatusLabel tone="pending">لم يجهز الطرد</StatusLabel>}
          </summary>
          <div className="border-t border-bw-line p-5">
            {d.fulfillment.receipts.length ? (
              <div className="mb-4">
                <p className="mb-1 text-bw-small font-semibold text-bw-ink">الاستلام في المخزن</p>
                <ul className="space-y-1 text-bw-small">
                  {d.fulfillment.receipts.map((r) => (
                    <li key={r.id}><Code>{r.quantity}</Code> قطعة · {r.condition} · تحقق: {r.identityMethod}{r.lotNumber ? <> · تشغيلة <Code>{r.lotNumber}</Code></> : null}{r.expiryDate ? <> · صلاحية <Code>{r.expiryDate.slice(0, 10)}</Code></> : null} · {formatDateTime(r.receivedAt)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {shipment ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-bw-small font-semibold text-bw-ink">سجل أحداث الشحنة</p>
                  <ol className="space-y-1 text-bw-small">
                    {shipment.events.map((e) => (
                      <li key={e.id}><Code>{e.type}</Code>{e.reasonCode ? ` · ${FAILURE_REASONS[e.reasonCode] ?? e.reasonCode}` : ''} · {formatDateTime(e.createdAt)}</li>
                    ))}
                  </ol>
                </div>
                <div className="space-y-1 text-bw-small">
                  <p className="mb-1 font-semibold text-bw-ink">تفاصيل التوصيل</p>
                  <p>المخزن: {shipment.location.name}</p>
                  {shipment.attempts.map((a, i) => (
                    <p key={a.stopId}>محاولة <Code>{i + 1}</Code>: {a.outcome} · مشوار {a.runStatus} · مندوب <Code>{shortId(a.driverId)}</Code>{a.closedAt ? ` · ${formatDateTime(a.closedAt)}` : ''}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {/* 7. Returns & Resolutions (Only shown if resolutions exist or if order is in returnable state) */}
      {(d.money.resolutions.length > 0 || ['delivered', 'shipped', 'returned'].includes(o.status)) ? (
        <details className="rounded-bw-card border border-bw-line bg-bw-surface" open={d.money.resolutions.length > 0}>
          <summary className="flex cursor-pointer items-center justify-between p-5 font-semibold text-bw-ink">
            <span>المرتجعات والاستردادات</span>
            {d.money.resolutions.length ? <StatusLabel tone="warn">{d.money.resolutions.length} حالة</StatusLabel> : null}
          </summary>
          <div className="border-t border-bw-line p-3">
            <Resolutions d={d} reload={reload} />
          </div>
        </details>
      ) : null}

      {/* 8. Order Actions: Cancel only when permitted by lifecycle */}
      {!isClosed ? (
        <Section title="إجراءات الطلب">
          <CancelOrder orderId={o.id} status={o.status} onDone={reload} />
        </Section>
      ) : null}

      {/* 9. Audit History & System Events: Collapsed by default for clean UX */}
      <details className="rounded-bw-card border border-bw-line bg-bw-surface">
        <summary className="cursor-pointer p-5 font-semibold text-bw-ink-soft hover:text-bw-ink">السجل والأحداث التاريخية</summary>
        <div className="grid gap-4 border-t border-bw-line p-4 lg:grid-cols-2">
          <Section title="تغيرات الحالة">
            {d.timeline.statusEvents.length ? (
              <ol className="space-y-2 text-bw-small">
                {d.timeline.statusEvents.map((event, index) => (
                  <li key={`${event.status}-${event.at}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-bw-line pb-2">
                    <Status map={ORDER_STATUS} value={event.status} />
                    <span className="text-bw-ink-soft">{formatDateTime(event.at)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-bw-small text-bw-ink-soft">لا توجد أحداث حالة مسجلة.</p>}
          </Section>
          <Section title="الحالات والتذاكر">
            {d.supportCases.length === 0 ? <p className="text-bw-small text-bw-ink-soft">لا توجد تذاكر دعم مسجلة.</p> : (
              <ul className="space-y-1 text-bw-small">
                {d.supportCases.map((c) => <li key={c.id}>{c.title} · <Code>{c.status}</Code> · {c.priority}</li>)}
              </ul>
            )}
          </Section>
          {d.events.length > 0 ? (
            <div className="lg:col-span-2">
              <details className="text-bw-small text-bw-ink-soft">
                <summary className="cursor-pointer py-1 font-medium hover:text-bw-ink">أحداث النظام التقنية ({d.events.length})</summary>
                <ul className="mt-2 space-y-1">
                  {d.events.map((e) => (
                    <li key={e.id}><Code>{e.eventType}</Code> → {e.consumer}: {e.status}{e.lastError ? ` · ${e.lastError}` : ''}</li>
                  ))}
                </ul>
              </details>
            </div>
          ) : null}
        </div>
      </details>
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
    <div className="rounded-bw-card border border-bw-danger/30 bg-bw-danger-soft/30 p-4">
      <h3 className="font-semibold text-bw-danger">إلغاء الطلب</h3>
      <p className="mb-3 text-bw-small text-bw-ink-soft">الإلغاء متاح قبل خروج الطرد مع المندوب فقط. بعد خروج الطرد تتم المعالجة عبر مسار المرتجع.</p>
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
    </div>
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
                <input aria-label={`كمية ${skuText(item.sku, item.productName, item.variantName)}`} type="number" min={0} max={item.quantity} value={quantities[item.id] ?? 0}
                  onChange={(e) => setQuantities({ ...quantities, [item.id]: Math.max(0, Math.min(item.quantity, Number(e.target.value))) })}
                  className="h-bw-control w-20 rounded-bw-field border-[1.5px] border-bw-line-field px-2 bw-code" />
                <bdi>{skuText(item.sku, item.productName, item.variantName)}</bdi> (من <Code>{item.quantity}</Code>)
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
