'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, ChevronRight, HelpCircle, RefreshCw, ServerCrash, ShieldAlert, Wallet } from 'lucide-react'
import { Button, Code, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CopyId } from '@/components/workspace/copy-id'
import { Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Paged<T> = { total: number; items: T[] }

interface SupplierWait {
  purchaseOrderId: string
  supplierName: string
  waitedMinutes: number
  opened: boolean
  lineCount: number
  totalCost: number
  currency: string | null
}

interface CashVariance {
  orderId: string
  orderNumber: string
  variance: string | null
  severity: 'large' | 'small'
}

interface AttentionQueue {
  supplyActionRequired: Paged<{ orderId: string; orderNumber: string | null; category?: string; unresolvedQuantity?: number; since?: string }>
  customerDecisionsPending: Paged<{ orderId: string; orderNumber: string; reason?: string; unresolvedQuantity?: number; expiresAt?: string }>
  distributionRequired: Paged<{ purchaseOrderId: string; lineId: string; requestedQuantity: number; confirmedQuantity: number | null }>
  failedDeliveries: Paged<{ orderId: string; orderNumber: string | null; reasonCode: string | null; failedAt: string; returnDue?: boolean }>
  supplierResponses?: { unopened: SupplierWait[]; unanswered: SupplierWait[] }
  lateOrders?: Paged<{ orderId: string; orderNumber: string; promisedDate: string; daysLate: number }>
  cashVariances?: { short: Paged<CashVariance>; over: Paged<CashVariance> }
  unsettledRounds?: Paged<{ courierId: string; locationId: string; orders: number; expectedTotal: string; declaredTotal: string; oldestDeclaredAt: string | null }>
  roundVariances?: Paged<{ batchId: string; reference: string; expectedTotal: string; countedTotal: string; variance: string; severity: 'large' | 'small'; settledAt: string; currency?: string }>
  openCases?: Paged<{ id: string; title: string; priority: string; orderId: string | null; createdAt: string }>
  deliveredUnsettled?: Paged<{ orderId: string; orderNumber: string; status: string; expectedAmount: string; declaredAmount: string | null; countedAmount: string | null; declaredAt: string }>
  eventFailures?: {
    failed: Array<{ id: string; eventType: string; consumer: string; aggregateId: string; attempts: number; lastError: string | null; nextAttemptAt: string | null }>
    dead: Array<{ id: string; eventType: string; consumer: string; aggregateId: string; attempts: number; lastError: string | null; nextAttemptAt: string | null }>
    totalFailed: number
    totalDead: number
  }
}

const waited = (minutes: number) => (minutes >= 120 ? `${Math.floor(minutes / 60)} ساعة` : `${minutes} دقيقة`)

export default function AdminExceptionsPage() {
  return (
    <RoleShell role="admin" active="exceptions" mode="desktop">
      <ExceptionsContent />
    </RoleShell>
  )
}

function ExceptionsContent() {
  const { data, error, loading, reload } = useApi<AttentionQueue>('/operations/queues/attention', { pollMs: 20000 })

  // Derived counts for categorization:
  // Admin Critical: strictly issues that require executive/management decisions (financial shortages, cash float risk, critical disputes)
  const largeCashVariances = [
    ...(data?.cashVariances?.short.items ?? []).filter((i) => i.severity === 'large'),
    ...(data?.cashVariances?.over.items ?? []).filter((i) => i.severity === 'large'),
  ]
  const largeRoundVariances = (data?.roundVariances?.items ?? []).filter((r) => r.severity === 'large')
  const unsettledRoundsCount = data?.unsettledRounds?.items.length ?? 0
  const criticalCases = (data?.openCases?.items ?? []).filter((c) => c.priority === 'critical')

  const criticalTotal =
    largeCashVariances.length +
    largeRoundVariances.length +
    unsettledRoundsCount +
    criticalCases.length

  // Operational Queues: fulfillment, sourcing and support workflows handled inside their respective workspaces
  const unansweredPOs = data?.supplierResponses?.unanswered ?? []
  const unopenedPOs = data?.supplierResponses?.unopened ?? []
  const allSupplierWaits = [...unansweredPOs, ...unopenedPOs]
  const distributionItems = data?.distributionRequired?.items ?? []
  const supplyShortageItems = data?.supplyActionRequired?.items ?? []
  const customerDecisionItems = data?.customerDecisionsPending?.items ?? []
  const failedDeliveryItems = data?.failedDeliveries?.items ?? []
  const standardSupportCases = (data?.openCases?.items ?? []).filter((c) => c.priority !== 'critical')
  const lateOrdersItems = data?.lateOrders?.items ?? []

  const operationalTotal =
    allSupplierWaits.length +
    distributionItems.length +
    supplyShortageItems.length +
    customerDecisionItems.length +
    failedDeliveryItems.length +
    standardSupportCases.length +
    lateOrdersItems.length

  // Unused data monitoring
  const deliveredUnsettledCount = data?.deliveredUnsettled?.total ?? 0
  const deadEventsCount = data?.eventFailures?.totalDead ?? 0
  const failedEventsCount = data?.eventFailures?.totalFailed ?? 0

  const hasAnyIssues = criticalTotal > 0 || operationalTotal > 0 || deliveredUnsettledCount > 0 || deadEventsCount > 0

  return (
    <Page>
      {/* Page Header with Real Operational Counts */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bw-line pb-4">
        <div>
          <h1 className="sc-page-title flex items-center gap-2">
            <ShieldAlert className="size-5 text-bw-amber" />
            الاستثناءات والتدخّل التشغيلي
          </h1>
          <p className="mt-1 text-bw-small text-bw-ink-soft">
            متابعة المشكلات التي تستوجب قرارات إدارية أو إجراءات تصحيحية من فرق العمليات.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {criticalTotal > 0 ? (
            <StatusLabel tone="danger">{criticalTotal} تدخل حرج</StatusLabel>
          ) : (
            <StatusLabel tone="ok">لا توجد حالات حرجة</StatusLabel>
          )}
          <Button variant="secondary" size="sm" onClick={reload} loading={loading && !!data}>
            <RefreshCw className="size-3.5" />
            تحديث
          </Button>
        </div>
      </div>

      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-48 w-full rounded-bw-card" /> : null}

      {data ? (
        <div className="space-y-6">
          {/* Unified Healthy State when everything is clean */}
          {!hasAnyIssues ? (
            <div className="rounded-bw-card border border-bw-emerald/30 bg-bw-emerald-soft/30 p-8 text-center">
              <CheckCircle2 className="mx-auto size-10 text-bw-emerald" />
              <h2 className="mt-3 text-bw-title font-semibold text-bw-ink">جميع العمليات تسير بانتظام</h2>
              <p className="mt-1 text-bw-small text-bw-ink-soft">
                لا توجد استثناءات أو جولات معلقة أو مشكلات توريد تتطلب انتباه الإدارة حالياً.
              </p>
            </div>
          ) : null}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* LEVEL 1: CRITICAL INTERVENTIONS (Admin Executive Decisions) */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {criticalTotal > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-bw-small font-bold uppercase tracking-wider text-bw-rose">
                  تدخلات حرجة تتطلب قرار الإدارة ({criticalTotal})
                </h2>
                <span className="text-[12px] text-bw-ink-subtle">تستوجب التدقيق الفوري لمنع الخسائر</span>
              </div>

              {/* 1. Large Cash Variances */}
              {(largeCashVariances.length > 0 || largeRoundVariances.length > 0) ? (
                <QueueCard
                  tone="danger"
                  title="عجز نقدي كبير (> 20 ج.م)"
                  responsible="الإدارة المالية وأمين الخزينة (Finance / Cashier)"
                  actionDescription="مراجعة ومطابقة العجز المالي للجولة أو الطلب وتحديد المسؤولية."
                  actionHref="/admin/cash"
                  actionLabel="افتح تسوية النقدية"
                  count={largeCashVariances.length + largeRoundVariances.length}
                >
                  <ul className="divide-y divide-bw-line">
                    {largeRoundVariances.map((r) => (
                      <ActionRow
                        key={r.batchId}
                        title={`تسوية جولة مندوب: فرق ${r.variance} ${r.currency ?? 'ج.م'}`}
                        details={`مرجع: ${r.reference} · متوقع: ${r.expectedTotal} · اتعدّ: ${r.countedTotal} · ${formatDateTime(r.settledAt)}`}
                        href="/admin/cash"
                        actionLabel="تدقيق الجولة"
                      />
                    ))}
                    {largeCashVariances.map((c) => (
                      <ActionRow
                        key={c.orderId}
                        title={`طلب #${c.orderNumber.replace(/^ORD-/, '')}: عجز تحصيل ${c.variance ?? ''} ج.م`}
                        details="فارق كبير بين المبلغ المطلوب والمحصل من العميل"
                        href={`/admin/orders/${c.orderId}`}
                        actionLabel="افتح الطلب"
                      />
                    ))}
                  </ul>
                </QueueCard>
              ) : null}

              {/* 2. Unsettled Cash Rounds > 12 Hours */}
              {unsettledRoundsCount > 0 ? (
                <QueueCard
                  tone="danger"
                  title="جولات نقدية معلقة لم تُعد بعد 12 ساعة"
                  responsible="مدير المخزن وأمين الخزينة (Hub Operations)"
                  actionDescription="إلزام أمين الخزينة بإنهاء عد وتوريد الكاش المعلق بحوزة المناديب فوراً."
                  actionHref="/admin/cash"
                  actionLabel="افتح النقدية"
                  count={unsettledRoundsCount}
                >
                  <ul className="divide-y divide-bw-line">
                    {data.unsettledRounds?.items.map((r) => (
                      <ActionRow
                        key={`${r.courierId}-${r.locationId}`}
                        title={`مندوب ${shortId(r.courierId)}: ${r.orders} طلب بقيمة ${r.expectedTotal} ج.م`}
                        details={`أعلن المندوب: ${r.declaredTotal} ج.م${r.oldestDeclaredAt ? ` · معلقة منذ ${formatDateTime(r.oldestDeclaredAt)}` : ''}`}
                        href="/admin/cash"
                        actionLabel="إتمام العد والتسوية"
                      />
                    ))}
                  </ul>
                </QueueCard>
              ) : null}

              {/* 3. Critical Support Cases */}
              {criticalCases.length > 0 ? (
                <QueueCard
                  tone="danger"
                  title="حالات دعم واستثناءات حرجة"
                  responsible="إدارة العمليات والدعم (Admin / Support)"
                  actionDescription="اتخاذ القرار التشغيلي في الحالات ذات الأولوية القصوى (نزاعات، خسائر هوامش، إلغاءات بعد الورود)."
                  actionHref="/admin/orders"
                  actionLabel="مراجعة الحالات"
                  count={criticalCases.length}
                >
                  <ul className="divide-y divide-bw-line">
                    {criticalCases.map((c) => (
                      <ActionRow
                        key={c.id}
                        title={c.title}
                        details={`أنشئت: ${formatDateTime(c.createdAt)}`}
                        href={c.orderId ? `/admin/orders/${c.orderId}` : undefined}
                        actionLabel={c.orderId ? 'افتح الطلب' : undefined}
                      />
                    ))}
                  </ul>
                </QueueCard>
              ) : null}
            </div>
          ) : null}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* LEVEL 2: OPERATIONAL WORKSPACES (Dedicated Department Queues) */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {operationalTotal > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-bw-small font-bold uppercase tracking-wider text-bw-amber">
                  تنبيهات تشغيلية لمتابعة الأقسام ({operationalTotal})
                </h2>
                <span className="text-[12px] text-bw-ink-subtle">تتم معالجتها داخل مساحات العمل المخصصة</span>
              </div>

              {/* 1. Supplier Orders Waiting Confirmation */}
              {allSupplierWaits.length > 0 ? (
                <QueueCard
                  tone="warn"
                  title="أوامر شراء معلقة لدى الموردين"
                  responsible="فريق المشتريات والتوريد (Purchasing Workspace)"
                  actionDescription="التواصل مع الموردين هاتفياً لتأكيد التوفر والأسعار لأوامر الشراء التي تجاوزت مهلة الرد."
                  actionHref="/admin/sourcing"
                  actionLabel="مساحة التوريد"
                  count={allSupplierWaits.length}
                >
                  <ul className="divide-y divide-bw-line">
                    {allSupplierWaits.map((w) => (
                      <ActionRow
                        key={w.purchaseOrderId}
                        title={`مورد: ${w.supplierName} · أمر شراء ${shortId(w.purchaseOrderId)} (${w.lineCount} صنف)`}
                        details={`تكلفة: ${w.totalCost} ${w.currency ?? ''} · معلق منذ ${waited(w.waitedMinutes)}${w.opened ? ' (تم فتحه بدون رد)' : ' (لم يفتح بعد)'}`}
                        href="/admin/sourcing"
                        actionLabel="متابعة في التوريد"
                      />
                    ))}
                  </ul>
                </QueueCard>
              ) : null}

              {/* 2. Manual Distribution Required */}
              {distributionItems.length > 0 ? (
                <QueueCard
                  tone="warn"
                  title="بضاعة موردين محتاجة قرار توزيع حصص"
                  responsible="مسؤول المشتريات (Purchasing Workspace)"
                  actionDescription="مورد أكد كمية جزئية لبند مشترك بين عدة طلبات؛ يتطلب تحديد أولوية التخصيص."
                  actionHref="/admin/sourcing"
                  actionLabel="مساحة التوريد"
                  count={distributionItems.length}
                >
                  <ul className="divide-y divide-bw-line">
                    {distributionItems.map((r) => (
                      <ActionRow
                        key={r.lineId}
                        title={`أمر شراء ${shortId(r.purchaseOrderId)}: مطلوب ${r.requestedQuantity}${r.confirmedQuantity !== null ? ` · مؤكد ${r.confirmedQuantity}` : ''}`}
                        details="فشل التوزيع الآلي بنظام FIFO؛ يلزم تخصيص الكميات يدوياً"
                        href="/admin/sourcing"
                        actionLabel="اتخاذ قرار التوزيع"
                      />
                    ))}
                  </ul>
                </QueueCard>
              ) : null}

              {/* 3. Sourcing Shortages & Customer Decisions */}
              {(supplyShortageItems.length > 0 || customerDecisionItems.length > 0) ? (
                <QueueCard
                  tone="warn"
                  title="نقص توريد مستنفد وقرارات بدائل معلقة"
                  responsible="خدمة العملاء والمشتريات (Support & Sourcing)"
                  actionDescription="أصناف غير متوفرة بالسوق؛ تتطلب اعتماد بديل مقترح أو تأكيد قرار العميل."
                  actionHref="/admin/orders"
                  actionLabel="عرض الطلبات"
                  count={supplyShortageItems.length + customerDecisionItems.length}
                >
                  <ul className="divide-y divide-bw-line">
                    {supplyShortageItems.map((r) => (
                      <ActionRow
                        key={r.orderId}
                        title={`طلب #${r.orderNumber ? r.orderNumber.replace(/^ORD-/, '') : shortId(r.orderId)}: نقص توريد`}
                        details={`${r.unresolvedQuantity ?? 0} قطعة غير متوفرة بالسوق من أي مورد`}
                        href={`/admin/orders/${r.orderId}`}
                        actionLabel="افتح الطلب"
                      />
                    ))}
                    {customerDecisionItems.map((d) => (
                      <ActionRow
                        key={d.orderId}
                        title={`طلب #${d.orderNumber.replace(/^ORD-/, '')}: قرار عميل معلق`}
                        details={`${d.unresolvedQuantity ?? 0} قطعة · ${d.reason ?? 'بديل مقترح'}${d.expiresAt ? ` · ينتهي في ${formatDateTime(d.expiresAt)}` : ''}`}
                        href={`/admin/orders/${d.orderId}`}
                        actionLabel="افتح الطلب"
                      />
                    ))}
                  </ul>
                </QueueCard>
              ) : null}

              {/* 4. Failed Deliveries */}
              {failedDeliveryItems.length > 0 ? (
                <QueueCard
                  tone="warn"
                  title="شحنات متعثرة التسليم"
                  responsible="عمليات التوصيل والمخزن (Delivery & Hub)"
                  actionDescription="شحنات تعذر تسليمها للعميل؛ يلزم إعادة الجدولة أو مسح الطرد كمرتجع بالمخزن بعد 24 ساعة."
                  actionHref="/admin/orders?status=shipped"
                  actionLabel="عرض شحنات المناديب"
                  count={failedDeliveryItems.length}
                >
                  <ul className="divide-y divide-bw-line">
                    {failedDeliveryItems.map((f) => (
                      <ActionRow
                        key={`${f.orderId}-${f.failedAt}`}
                        title={`طلب #${f.orderNumber ? f.orderNumber.replace(/^ORD-/, '') : shortId(f.orderId)}: تعثر توصيل`}
                        details={`${f.reasonCode ?? 'سبب غير محدد'}${f.returnDue ? ' · مضى أكثر من 24 ساعة (يتحول لمرتجع)' : ''} · ${formatDateTime(f.failedAt)}`}
                        href={`/admin/orders/${f.orderId}`}
                        actionLabel="افتح الطلب"
                      />
                    ))}
                  </ul>
                </QueueCard>
              ) : null}

              {/* 5. Late Orders awaiting Hub packing or dispatch */}
              {lateOrdersItems.length > 0 ? (
                <QueueCard
                  tone="warn"
                  title="طلبات تجاوزت موعدها بانتظار التجهيز أو الشحن"
                  responsible="فريق المخزن والتوصيل (Hub & Delivery Workspace)"
                  actionDescription="طلبات حل موعد تسليمها الموعود وما زالت بالمخزن؛ يلزم تسريع التجهيز والإسناد للمندوب."
                  actionHref="/admin/orders?status=active"
                  actionLabel="عرض الطلبات الجارية"
                  count={lateOrdersItems.length}
                >
                  <ul className="divide-y divide-bw-line">
                    {lateOrdersItems.map((o) => (
                      <ActionRow
                        key={o.orderId}
                        title={`طلب #${o.orderNumber.replace(/^ORD-/, '')}`}
                        details={o.daysLate > 0 ? `متأخر ${o.daysLate} يوم عن ميعاده الموعود (${o.promisedDate})` : `ميعاد التسليم اليوم (${o.promisedDate}) وتجاوز 12:00 ظهراً`}
                        href={`/admin/orders/${o.orderId}`}
                        actionLabel="افتح الطلب"
                      />
                    ))}
                  </ul>
                </QueueCard>
              ) : null}

              {/* 6. Standard Support Cases */}
              {standardSupportCases.length > 0 ? (
                <QueueCard
                  tone="warn"
                  title="تذاكر واستفسارات خدمة العملاء الجارية"
                  responsible="فريق خدمة العملاء (Support Workspace)"
                  actionDescription="متابعة تواصل العملاء والاستفسارات التشغيلية العادية."
                  actionHref="/admin/orders"
                  actionLabel="عرض الحالات"
                  count={standardSupportCases.length}
                >
                  <ul className="divide-y divide-bw-line">
                    {standardSupportCases.map((c) => (
                      <ActionRow
                        key={c.id}
                        title={c.title}
                        details={`أولوية: ${c.priority} · أنشئت: ${formatDateTime(c.createdAt)}`}
                        href={c.orderId ? `/admin/orders/${c.orderId}` : undefined}
                        actionLabel={c.orderId ? 'افتح الطلب' : undefined}
                      />
                    ))}
                  </ul>
                </QueueCard>
              ) : null}
            </div>
          ) : null}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* LEVEL 3: MONITORING & INFRASTRUCTURE (Unused Data Handled)   */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {(deliveredUnsettledCount > 0 || deadEventsCount > 0 || failedEventsCount > 0) ? (
            <div className="space-y-3 pt-2">
              <h2 className="text-bw-small font-bold uppercase tracking-wider text-bw-ink-soft">
                المراقبة المالية وسلامة المنصة
              </h2>

              <div className="grid gap-4 md:grid-cols-2">
                {/* 1. Delivered Unsettled Collections */}
                {deliveredUnsettledCount > 0 ? (
                  <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4">
                    <div className="flex items-center gap-2">
                      <Wallet className="size-4 text-bw-amber" />
                      <h3 className="font-semibold text-bw-ink">تحصيلات مسلّمة بانتظار التسوية</h3>
                    </div>
                    <p className="mt-1 text-bw-small text-bw-ink-soft">
                      يوجد <strong className="text-bw-ink"><Code>{deliveredUnsettledCount}</Code></strong> طلب تم تسليمه للعميل بنجاح وبانتظار اعتماد التوريد بالخزينة.
                    </p>
                    <div className="mt-3 flex items-center justify-between border-t border-bw-line pt-2 text-bw-small">
                      <span className="text-bw-ink-subtle">المسؤول: أمين الخزينة (Cashier)</span>
                      <Link href="/admin/cash" className="flex items-center gap-1 font-medium text-bw-ink underline">
                        افتح النقدية
                        <ArrowLeft className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                ) : null}

                {/* 2. Platform Reliability & Domain Events Failures */}
                {(deadEventsCount > 0 || failedEventsCount > 0) ? (
                  <div className="rounded-bw-card border border-bw-danger/30 bg-bw-danger-soft/20 p-4">
                    <div className="flex items-center gap-2">
                      <ServerCrash className="size-4 text-bw-danger" />
                      <h3 className="font-semibold text-bw-danger">أحداث نظام تقنية معطلة (DLQ)</h3>
                    </div>
                    <p className="mt-1 text-bw-small text-bw-ink-soft">
                      يوجد <strong className="text-bw-danger"><Code>{deadEventsCount}</Code></strong> أحداث ميتة و <Code>{failedEventsCount}</Code> أحداث متعثرة في طابور رسائل النظام.
                    </p>
                    <div className="mt-3 flex items-center justify-between border-t border-bw-line pt-2 text-bw-small">
                      <span className="text-bw-ink-subtle">المسؤول: فريق هندسة المنصة (Platform Team)</span>
                      <span className="font-mono text-[11px] text-bw-danger">outbox.failure</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Page>
  )
}

function QueueCard({
  title,
  count,
  responsible,
  actionDescription,
  actionHref,
  actionLabel,
  tone,
  children,
}: {
  title: string
  count: number
  responsible: string
  actionDescription: string
  actionHref: string
  actionLabel: string
  tone: 'danger' | 'warn'
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-bw-card border bg-bw-surface overflow-hidden',
        tone === 'danger' ? 'border-bw-rose/40' : 'border-bw-amber/35',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bw-line bg-bw-veil-1 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <strong className="text-bw-body font-semibold text-bw-ink">{title}</strong>
          <span
            className={cn(
              'inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold text-white',
              tone === 'danger' ? 'bg-bw-rose' : 'bg-bw-amber',
            )}
          >
            {count}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-bw-small text-bw-ink-soft">
            المسؤول: <strong className="text-bw-ink">{responsible}</strong>
          </span>
          <Link
            href={actionHref}
            className="hidden items-center gap-1 rounded-bw-field bg-bw-surface px-2.5 py-1 text-bw-small font-medium text-bw-ink shadow-sm ring-1 ring-bw-line hover:bg-bw-veil-2 sm:inline-flex"
          >
            {actionLabel}
            <ArrowLeft className="size-3.5" />
          </Link>
        </div>
      </div>
      <div className="px-4 py-2 text-bw-small text-bw-ink-subtle border-b border-bw-line bg-bw-veil-0">
        <span className="font-medium text-bw-ink-soft">الإجراء المطلوب:</span> {actionDescription}
      </div>
      <div className="p-2 sm:p-3">{children}</div>
    </div>
  )
}

function ActionRow({
  title,
  details,
  href,
  actionLabel,
}: {
  title: string
  details: string
  href?: string
  actionLabel?: string
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-bw-small hover:bg-bw-veil-1 rounded-bw-field">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-bw-ink">{title}</p>
        <p className="text-[12px] text-bw-ink-soft">{details}</p>
      </div>
      {href && actionLabel ? (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-bw-small font-medium text-bw-ink underline hover:text-bw-ink-bright"
        >
          {actionLabel}
          <ArrowLeft className="size-3.5" />
        </Link>
      ) : null}
    </li>
  )
}
