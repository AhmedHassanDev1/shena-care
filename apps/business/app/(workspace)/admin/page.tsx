'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
} from 'lucide-react'
import {
  Button,
  Code,
  DataTable,
  Dialog,
  Notice,
  QueueRow,
  Section,
  Skeleton,
  StateBlock,
  StatusLabel,
  useDialog,
  type Tone,
} from '@/components/bw/primitives'
import { Egp, Page, Select, Status } from '@/components/workspace/kit'
import { RoleShell, useMe } from '@/components/workspace/role-shell'
import { FAILURE_REASONS, ORDER_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Paged<T> = { total: number; items: T[] }

interface Attention {
  supplyActionRequired: Paged<{ orderId: string; orderNumber: string | null; category: string; unresolvedQuantity: number; since: string }>
  customerDecisionsPending: Paged<{ orderId: string; orderNumber: string; reason: string; unresolvedQuantity: number; expiresAt: string }>
  distributionRequired: Paged<{ purchaseOrderId: string; lineId: string; requestedQuantity: number; confirmedQuantity: number | null; orderAllocations: number }>
  failedDeliveries: Paged<{ orderId: string; orderNumber: string | null; reasonCode: string | null; failedAt: string }>
  cashVariances: { short: Paged<CashRow>; over: Paged<CashRow> }
  deliveredUnsettled: Paged<CashRow>
  eventFailures: { failed: EventRow[]; dead: EventRow[] }
  openCases: Paged<{ id: string; title: string; priority: string; orderId: string | null; createdAt: string }>
}

type CashRow = {
  orderId: string
  orderNumber: string
  expectedAmount: string
  declaredAmount: string | null
  countedAmount: string | null
  variance: string | null
}

type EventRow = {
  id: string
  eventType: string
  consumer: string
  aggregateId: string
  attempts: number
  lastError: string | null
}

interface Kpis {
  revenueToday: number
  totalRevenue?: number
  ordersToday: number
  totalOrders: number
  averageOrderValue: number
  attentionCenter?: {
    openSupportCases: number
    unconfirmedPOs: number
    pendingIngestions: number
  }
}

interface OrderRow {
  id: string
  orderNumber: string
  status: string
  customerName: string
  governorate: string | null
  area: string | null
  paymentMethod: string
  totalAmount: number
  codAmount: number | null
  itemCount: number
  hasPin: boolean
  createdAt: string
}

type QueueCategory =
  | 'all'
  | 'supply'
  | 'customer'
  | 'distribution'
  | 'delivery'
  | 'cash'
  | 'unsettled'
  | 'events'
  | 'support'

interface ActiveExceptionDetail {
  id: string
  category: QueueCategory
  categoryLabel: string
  title: string
  orderId?: string
  orderNumber?: string | null
  tone: Tone
  facts: Array<[string, React.ReactNode]>
  nextStep: string
  destinationHref: string
  destinationLabel: string
}

const orderLink = (orderId: string, orderNumber: string | null) => (
  <Link href={`/admin/orders/${orderId}`} className="font-semibold text-bw-action-ink underline hover:text-bw-action">
    <Code>{orderNumber ?? shortId(orderId)}</Code>
  </Link>
)

export default function AdminOverviewPage() {
  return (
    <RoleShell role="admin" active="attention" mode="desktop">
      <AdminOverviewContent />
    </RoleShell>
  )
}

function AdminOverviewContent() {
  const me = useMe()
  const isOwnerAdmin = me.roles.includes('ADMIN')
  const [showFinancials, setShowFinancials] = React.useState(false)

  // Live polling for operational attention queue and KPIs
  const attention = useApi<Attention>('/operations/queues/attention', { pollMs: 30000 })
  const kpis = useApi<Kpis>('/operations/dashboard/kpis', { pollMs: 30000 })

  // Recent orders query with status & search filters
  const [orderStatus, setOrderStatus] = React.useState('')
  const [orderQueryInput, setOrderQueryInput] = React.useState('')
  const [activeQuery, setActiveQuery] = React.useState('')
  const [dateFilter, setDateFilter] = React.useState<'all' | 'today'>('all')

  const orderParams = new URLSearchParams({
    take: '25',
    skip: '0',
    ...(orderStatus ? { status: orderStatus } : {}),
    ...(activeQuery ? { q: activeQuery } : {}),
  })
  const orders = useApi<{ total: number; items: OrderRow[] }>(`/admin/orders?${orderParams}`, { pollMs: 30000 })

  // Timestamp for data freshness tracking
  const [lastRefreshedAt, setLastRefreshedAt] = React.useState<Date>(new Date())

  const handleManualRefresh = React.useCallback(() => {
    attention.reload()
    kpis.reload()
    orders.reload()
    setLastRefreshedAt(new Date())
  }, [attention, kpis, orders])

  const a = attention.data

  // Real waiting operational count
  const waitingTotal = a
    ? a.supplyActionRequired.total +
      a.customerDecisionsPending.total +
      a.distributionRequired.total +
      a.failedDeliveries.total +
      a.cashVariances.short.total +
      a.cashVariances.over.total +
      a.eventFailures.failed.length +
      a.eventFailures.dead.length +
      a.openCases.total
    : undefined

  // Active in-flight fulfillment calculation from recent orders & stages
  const activeFulfillmentCount = React.useMemo(() => {
    if (!orders.data) return 0
    return orders.data.items.filter((o) => ['confirmed', 'packing', 'shipped'].includes(o.status)).length
  }, [orders.data])

  // Pipeline stage counts from real orders fetched
  const pipelineStats = React.useMemo(() => {
    const raw = orders.data?.items ?? []
    const placed = raw.filter((o) => o.status === 'placed').length
    const confirmed = raw.filter((o) => o.status === 'confirmed').length
    const packing = raw.filter((o) => o.status === 'packing').length
    const shipped = raw.filter((o) => o.status === 'shipped').length
    const delivered = raw.filter((o) => o.status === 'delivered').length
    const terminal = raw.filter((o) => ['cancelled', 'returned'].includes(o.status)).length
    const totalSample = raw.length || 1

    return {
      placed,
      confirmed,
      packing,
      shipped,
      delivered,
      terminal,
      totalSample,
    }
  }, [orders.data])

  // Hourly inflow distribution for today from fetched orders
  const hourlyInflow = React.useMemo(() => {
    const raw = orders.data?.items ?? []
    const hours = Array.from({ length: 12 }, (_, i) => ({ hour: 8 + i, count: 0, label: `${8 + i}:00` }))
    for (const order of raw) {
      const d = new Date(order.createdAt)
      const h = d.getHours()
      const match = hours.find((item) => item.hour === h)
      if (match) match.count += 1
    }
    const maxCount = Math.max(...hours.map((h) => h.count), 1)
    return { hours, maxCount }
  }, [orders.data])

  // Attention queue category filter
  const [queueFilter, setQueueFilter] = React.useState<QueueCategory>('all')

  // Selected item for drawer inspection
  const [selectedException, setSelectedException] = React.useState<ActiveExceptionDetail | null>(null)
  const drawer = useDialog()

  const inspectException = (detail: ActiveExceptionDetail) => {
    setSelectedException(detail)
    drawer.open()
  }

  // Filtered orders based on date filter (client-side on top of fetched batch)
  const filteredOrders = React.useMemo(() => {
    if (!orders.data?.items) return []
    if (dateFilter === 'all') return orders.data.items

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    return orders.data.items.filter((item) => new Date(item.createdAt) >= startOfToday)
  }, [orders.data, dateFilter])

  return (
    <Page>
      {/* ── Page Header with Data Freshness & Controls ─────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-bw-line pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-bw-ok opacity-75 motion-reduce:hidden" />
              <span className="relative inline-flex size-2.5 rounded-full bg-bw-ok" />
            </span>
            <span className="text-bw-small font-medium text-bw-ink-soft">
              تحديث تشغيلي تلقائي · كل <Code>30</Code> ثانية
            </span>
          </div>
          <h1 className="font-bw-display text-bw-title font-semibold text-bw-ink">
            لوحة الإشراف والعمليات
          </h1>
          <p className="text-bw-small text-bw-ink-soft">
            متابعة حية للطلبات، مسار التجهيز، التدخلات المعلقة، وتدفق النقدية
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-end text-bw-small text-bw-ink-subtle">
            <p>
              آخر فحص: <Code>{lastRefreshedAt.toLocaleTimeString('ar-EG')}</Code>
            </p>
          </div>
          <Button
            variant="secondary"
            loading={attention.loading || orders.loading || kpis.loading}
            onClick={handleManualRefresh}
            aria-label="تحديث يدوي لكافة البيانات"
          >
            <RefreshCw className="size-4" aria-hidden />
            تحديث
          </Button>
        </div>
      </header>

      {/* ── Error notices if any endpoint fails ───────────────────────── */}
      {attention.error ? (
        <Notice
          tone="danger"
          title="تعذر تحميل قائمة التدخلات المعلقة"
          action={<Button variant="secondary" onClick={attention.reload}>إعادة المحاولة</Button>}
        >
          {attention.error.message}
        </Notice>
      ) : null}

      {orders.error ? (
        <Notice
          tone="danger"
          title="تعذر تحميل أحدث الطلبات"
          action={<Button variant="secondary" onClick={orders.reload}>إعادة المحاولة</Button>}
        >
          {orders.error.message}
        </Notice>
      ) : null}

      {/* ── Primary Operational KPI Cards ─────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Orders Volume */}
        <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors hover:border-bw-line-field">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-bw-small font-semibold">طلبات اليوم</span>
            <ShoppingBag className="size-4 text-bw-action" aria-hidden />
          </div>
          <p className="mt-2 text-bw-figure font-semibold text-bw-ink">
            {kpis.data ? <Code>{kpis.data.ordersToday}</Code> : <Skeleton className="h-8 w-16" />}
          </p>
          <div className="mt-1 flex items-center justify-between text-bw-small text-bw-ink-soft">
            <span>
              إجمالي الطلبات: {kpis.data ? <Code>{kpis.data.totalOrders}</Code> : '—'}
            </span>
            <Link href="/admin/orders" className="text-bw-action-ink underline hover:text-bw-action">
              سجل الطلبات
            </Link>
          </div>
        </div>

        {/* Card 2: Active Fulfillment */}
        <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors hover:border-bw-line-field">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-bw-small font-semibold">قيد التنفيذ بالمخزن والتوصيل</span>
            <Truck className="size-4 text-bw-info" aria-hidden />
          </div>
          <p className="mt-2 text-bw-figure font-semibold text-bw-ink">
            {orders.data ? <Code>{activeFulfillmentCount}</Code> : <Skeleton className="h-8 w-16" />}
          </p>
          <div className="mt-1 flex items-center justify-between text-bw-small text-bw-ink-soft">
            <span>تأكيد · تجهيز · مع المندوب</span>
            <Link href="/admin/orders?status=confirmed" className="text-bw-action-ink underline hover:text-bw-action">
              النشطة
            </Link>
          </div>
        </div>

        {/* Card 3: Blocked / Action Required */}
        <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors hover:border-bw-line-field">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-bw-small font-semibold">محتاج تدخل فوري</span>
            <AlertTriangle className={cn('size-4', waitingTotal && waitingTotal > 0 ? 'text-bw-danger' : 'text-bw-ok')} aria-hidden />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-bw-figure font-semibold text-bw-ink">
              {waitingTotal !== undefined ? <Code>{waitingTotal}</Code> : <Skeleton className="h-8 w-16" />}
            </p>
            {waitingTotal && waitingTotal > 0 ? (
              <StatusLabel tone="danger">استثناءات مفتوحة</StatusLabel>
            ) : (
              <StatusLabel tone="ok">مستقر</StatusLabel>
            )}
          </div>
          <div className="mt-1 text-bw-small text-bw-ink-soft">
            <span>عجز توفير، قرارات عملاء، أو تعثر تسليم</span>
          </div>
        </div>

        {/* Card 4: COD Collections & Cash Status */}
        <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors hover:border-bw-line-field">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-bw-small font-semibold">التحصيل والنقدية (COD)</span>
            <Banknote className="size-4 text-bw-warn" aria-hidden />
          </div>
          <p className="mt-2 text-bw-figure font-semibold text-bw-ink">
            {a ? (
              <Code>{a.deliveredUnsettled.total + a.cashVariances.short.total + a.cashVariances.over.total}</Code>
            ) : (
              <Skeleton className="h-8 w-16" />
            )}
          </p>
          <div className="mt-1 flex items-center justify-between text-bw-small text-bw-ink-soft">
            <span>
              {a ? (
                <>
                  مستني عد: <Code>{a.deliveredUnsettled.total}</Code> · فروق: <Code>{a.cashVariances.short.total + a.cashVariances.over.total}</Code>
                </>
              ) : (
                'جاري الجلب...'
              )}
            </span>
            <Link href="/admin/cash" className="text-bw-action-ink underline hover:text-bw-action">
              التسويات
            </Link>
          </div>
        </div>
      </div>

      {/* ── Owner Protected Financial Overview ───────────────────────── */}
      {isOwnerAdmin ? (
        <section className="rounded-bw-card border border-bw-line bg-bw-kohl p-4 text-bw-ink">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bw-line/70 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-bw-action" aria-hidden />
              <h2 className="text-bw-heading font-semibold">بيانات المؤسس والمالك المالية</h2>
              <span className="rounded bg-bw-sunken px-2 py-0.5 text-bw-small text-bw-ink-subtle">
                صلاحية إدارة عليا فقط
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowFinancials((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-bw-small font-semibold text-bw-action-ink underline hover:text-bw-action"
            >
              {showFinancials ? (
                <>
                  <EyeOff className="size-4" aria-hidden />
                  إخفاء المبالغ
                </>
              ) : (
                <>
                  <Eye className="size-4" aria-hidden />
                  عرض المبالغ المالية
                </>
              )}
            </button>
          </div>

          {showFinancials ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <span className="text-bw-small text-bw-ink-soft">قيمة طلبات اليوم</span>
                <p className="text-bw-heading font-semibold text-bw-ink">
                  {kpis.data ? <Egp value={kpis.data.revenueToday} /> : <Skeleton className="h-6 w-24" />}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-bw-small text-bw-ink-soft">متوسط قيمة الطلب (AOV)</span>
                <p className="text-bw-heading font-semibold text-bw-ink">
                  {kpis.data ? <Egp value={kpis.data.averageOrderValue} /> : <Skeleton className="h-6 w-24" />}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-bw-small text-bw-ink-soft">إجمالي المبيعات المؤكدة</span>
                <p className="text-bw-heading font-semibold text-bw-ink">
                  {kpis.data ? <Egp value={kpis.data.totalRevenue ?? 0} /> : <Skeleton className="h-6 w-24" />}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-bw-small text-bw-ink-soft">
              المبالغ والإيرادات محجوبة تلقائيًا لمنع تسريب بيانات الأرباح أثناء التشغيل الميداني.
            </p>
          )}
        </section>
      ) : null}

      {/* ── Operational Visualizations (Pipeline & Trend) ─────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Visual 1: Fulfillment Pipeline Breakdown */}
        <Section
          title="مسار تجهيز وشحن الطلبات (Fulfillment Pipeline)"
          aside={
            <span className="text-bw-small text-bw-ink-soft">
              عينة حديثة (<Code>{pipelineStats.totalSample}</Code> طلب)
            </span>
          }
        >
          <div className="space-y-4">
            {/* Visual Segments Bar */}
            <div
              className="flex h-4 w-full overflow-hidden rounded-full bg-bw-sunken ring-1 ring-bw-line"
              role="progressbar"
              aria-label="توزيع مراحل شحن الطلبات"
            >
              <div
                style={{ width: `${(pipelineStats.placed / pipelineStats.totalSample) * 100}%` }}
                className="bg-bw-warn transition-all duration-bw-normal"
                title={`مستني التوفير: ${pipelineStats.placed}`}
              />
              <div
                style={{ width: `${(pipelineStats.confirmed / pipelineStats.totalSample) * 100}%` }}
                className="bg-bw-info transition-all duration-bw-normal"
                title={`مؤكد: ${pipelineStats.confirmed}`}
              />
              <div
                style={{ width: `${(pipelineStats.packing / pipelineStats.totalSample) * 100}%` }}
                className="bg-bw-action transition-all duration-bw-normal"
                title={`في المخزن: ${pipelineStats.packing}`}
              />
              <div
                style={{ width: `${(pipelineStats.shipped / pipelineStats.totalSample) * 100}%` }}
                className="bg-bw-action-hover transition-all duration-bw-normal"
                title={`مع المندوب: ${pipelineStats.shipped}`}
              />
              <div
                style={{ width: `${(pipelineStats.delivered / pipelineStats.totalSample) * 100}%` }}
                className="bg-bw-ok transition-all duration-bw-normal"
                title={`تم التسليم: ${pipelineStats.delivered}`}
              />
              <div
                style={{ width: `${(pipelineStats.terminal / pipelineStats.totalSample) * 100}%` }}
                className="bg-bw-danger transition-all duration-bw-normal"
                title={`مرتجع أو ملغي: ${pipelineStats.terminal}`}
              />
            </div>

            {/* Stages Legend and Direct Filter Grid */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { key: 'placed', label: 'مستني التوفير', count: pipelineStats.placed, tone: 'warn' as Tone, color: 'bg-bw-warn' },
                { key: 'confirmed', label: 'مؤكد التوفر', count: pipelineStats.confirmed, tone: 'info' as Tone, color: 'bg-bw-info' },
                { key: 'packing', label: 'في المخزن', count: pipelineStats.packing, tone: 'pending' as Tone, color: 'bg-bw-action' },
                { key: 'shipped', label: 'مع المندوب', count: pipelineStats.shipped, tone: 'neutral' as Tone, color: 'bg-bw-action-hover' },
                { key: 'delivered', label: 'اتسلّم', count: pipelineStats.delivered, tone: 'ok' as Tone, color: 'bg-bw-ok' },
                { key: 'cancelled', label: 'ملغي / مرتجع', count: pipelineStats.terminal, tone: 'danger' as Tone, color: 'bg-bw-danger' },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setOrderStatus(orderStatus === s.key ? '' : s.key)}
                  className={cn(
                    'flex items-center justify-between rounded-bw-field border p-2 text-start transition-colors',
                    orderStatus === s.key ? 'border-bw-action bg-bw-action-soft' : 'border-bw-line bg-bw-sunken hover:bg-bw-surface',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('size-2.5 rounded-full shrink-0', s.color)} aria-hidden />
                    <span className="text-bw-small text-bw-ink">{s.label}</span>
                  </div>
                  <Code className="text-bw-small font-semibold text-bw-ink">{s.count}</Code>
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Visual 2: Order Inflow Activity Distribution */}
        <Section
          title="تدفق الطلبات اليوم (Order Inflow Trend)"
          aside={
            <span className="text-bw-small text-bw-ink-soft">
              توزيع أوقات الطلب خلال اليوم
            </span>
          }
        >
          <div className="space-y-3">
            <div className="flex h-36 items-end gap-1.5 rounded-bw-card border border-bw-line bg-bw-sunken p-3">
              {hourlyInflow.hours.map((h) => {
                const heightPct = Math.round((h.count / hourlyInflow.maxCount) * 100)
                return (
                  <div key={h.hour} className="group relative flex flex-1 flex-col items-center justify-end h-full">
                    {/* Tooltip on hover */}
                    <div className="absolute -top-7 z-10 hidden whitespace-nowrap rounded bg-bw-surface px-1.5 py-0.5 text-[10px] text-bw-ink ring-1 ring-bw-line group-hover:block">
                      <Code>{h.label}</Code>: <Code>{h.count}</Code> طلب
                    </div>
                    <div
                      style={{ height: `${Math.max(heightPct, 6)}%` }}
                      className={cn(
                        'w-full rounded-t-sm transition-all duration-bw-normal',
                        h.count > 0 ? 'bg-bw-action hover:bg-bw-action-hover' : 'bg-bw-line/40',
                      )}
                    />
                    <span className="mt-1 text-[10px] text-bw-ink-subtle">
                      <Code>{h.hour}</Code>
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-between text-bw-small text-bw-ink-soft">
              <span>الساعات (8:00 ص إلى 8:00 م)</span>
              <span className="text-bw-ink-subtle">الارتفاع يعكس كثافة تسجيل الطلبات</span>
            </div>
          </div>
        </Section>
      </div>

      {/* ── Action-Required Attention Queue ───────────────────────────── */}
      <Section
        title={`محتاج تدخل فوري (${waitingTotal ?? 0})`}
        aside={
          <span className="text-bw-small text-bw-ink-soft">
            كل طلب أو بند مستني قرار بشري
          </span>
        }
      >
        {/* Category Filters */}
        <div role="group" aria-label="تصفية حسب نوع المشكلة" className="mb-4 flex flex-wrap gap-2">
          {(
            [
              ['all', 'الكل', waitingTotal ?? 0],
              ['supply', 'عجز التوريد', a?.supplyActionRequired.total ?? 0],
              ['customer', 'قرارات العملاء', a?.customerDecisionsPending.total ?? 0],
              ['distribution', 'توزيع الشراء', a?.distributionRequired.total ?? 0],
              ['delivery', 'توصيل متعثر', a?.failedDeliveries.total ?? 0],
              ['cash', 'فروق نقدية', (a?.cashVariances.short.total ?? 0) + (a?.cashVariances.over.total ?? 0)],
              ['unsettled', 'كاش للتسوية', a?.deliveredUnsettled.total ?? 0],
              ['events', 'أحداث النظام', (a?.eventFailures.failed.length ?? 0) + (a?.eventFailures.dead.length ?? 0)],
              ['support', 'حالات الدعم', a?.openCases.total ?? 0],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              aria-pressed={queueFilter === key}
              onClick={() => setQueueFilter(key as QueueCategory)}
              className={cn(
                'inline-flex h-bw-control items-center gap-1.5 rounded-full border px-3 text-bw-small transition-colors',
                queueFilter === key
                  ? 'border-bw-ink bg-bw-ink font-semibold text-bw-surface'
                  : 'border-bw-line-field bg-bw-surface text-bw-ink hover:bg-bw-sunken',
              )}
            >
              <span>{label}</span>
              <Code className="text-xs">{count}</Code>
            </button>
          ))}
        </div>

        {/* Empty state */}
        {a && waitingTotal === 0 ? (
          <StateBlock
            kind="empty"
            title="مافيش أي حاجة محتاجة تدخل دلوقتي"
            body="كل الطلبات وأوامر الشروح والتوصيلات تسير بصورة طبيعية بدون استثناءات معلقة."
          />
        ) : null}

        {/* Queue Items List */}
        {a && waitingTotal && waitingTotal > 0 ? (
          <ul className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-surface">
            {/* Supply Action Required */}
            {(queueFilter === 'all' || queueFilter === 'supply') &&
              a.supplyActionRequired.items.map((i) => (
                <QueueRow
                  key={`supply-${i.orderId}-${i.category}`}
                  tone="warn"
                  title={
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-bw-ink">عجز توفير محتاج قرار</span>
                      {orderLink(i.orderId, i.orderNumber)}
                    </div>
                  }
                  detail={
                    <>
                      كمية غير مغطاة: <Code>{i.unresolvedQuantity}</Code> وحدة · التصنيف: {i.category}
                    </>
                  }
                  meta={formatDateTime(i.since)}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() =>
                        inspectException({
                          id: i.orderId,
                          category: 'supply',
                          categoryLabel: 'عجز توفير',
                          title: `عجز توفير بالطلب ${i.orderNumber ?? shortId(i.orderId)}`,
                          orderId: i.orderId,
                          orderNumber: i.orderNumber,
                          tone: 'warn',
                          facts: [
                            ['رقم الطلب', orderLink(i.orderId, i.orderNumber)],
                            ['الكمية المعلقة', <Code key="q">{i.unresolvedQuantity}</Code>],
                            ['التصنيف', i.category],
                            ['تاريخ التسجيل', formatDateTime(i.since)],
                          ],
                          nextStep: 'راجع الموردين البديلين في أوامر الشراء أو اطلب قرار العميل بالاستبدال أو الإلغاء.',
                          destinationHref: `/admin/orders/${i.orderId}`,
                          destinationLabel: 'فتح الطلب',
                        })
                      }
                    >
                      مراجعة
                    </Button>
                  }
                />
              ))}

            {/* Customer Decisions Pending */}
            {(queueFilter === 'all' || queueFilter === 'customer') &&
              a.customerDecisionsPending.items.map((i) => (
                <QueueRow
                  key={`cust-${i.orderId}-${i.reason}`}
                  tone="pending"
                  title={
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-bw-ink">في انتظار رد العميل</span>
                      {orderLink(i.orderId, i.orderNumber)}
                    </div>
                  }
                  detail={
                    <>
                      السبب: {i.reason} · الكمية: <Code>{i.unresolvedQuantity}</Code>
                    </>
                  }
                  meta={<>ينتهي {formatDateTime(i.expiresAt)}</>}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() =>
                        inspectException({
                          id: i.orderId,
                          category: 'customer',
                          categoryLabel: 'قرار عميل',
                          title: `قرار العميل معلق للطلب ${i.orderNumber}`,
                          orderId: i.orderId,
                          orderNumber: i.orderNumber,
                          tone: 'pending',
                          facts: [
                            ['الطلب', orderLink(i.orderId, i.orderNumber)],
                            ['سبب التعديل', i.reason],
                            ['الكمية المتأثرة', <Code key="uq">{i.unresolvedQuantity}</Code>],
                            ['انتهاء مهلة الرد', formatDateTime(i.expiresAt)],
                          ],
                          nextStep: 'في حال انتهاء المهلة بدون رد، يتولى النظام الإلغاء التلقائي للبند أو الطلب وفق السياسة.',
                          destinationHref: `/admin/orders/${i.orderId}`,
                          destinationLabel: 'فتح تفاصيل الطلب',
                        })
                      }
                    >
                      مراجعة
                    </Button>
                  }
                />
              ))}

            {/* Distribution Required */}
            {(queueFilter === 'all' || queueFilter === 'distribution') &&
              a.distributionRequired.items.map((i) => (
                <QueueRow
                  key={`dist-${i.lineId}`}
                  tone="warn"
                  title={<>توزيع كمية جزئية من أمر الشراء <Code>{shortId(i.purchaseOrderId)}</Code></>}
                  detail={
                    <>
                      المؤكد من المورد: <Code>{`${i.confirmedQuantity ?? 0} / ${i.requestedQuantity}`}</Code> عبر{' '}
                      <Code>{i.orderAllocations}</Code> طلبات
                    </>
                  }
                  action={
                    <Button
                      variant="secondary"
                      onClick={() =>
                        inspectException({
                          id: i.lineId,
                          category: 'distribution',
                          categoryLabel: 'توزيع كمية شراء',
                          title: `توزيع أمر الشراء ${shortId(i.purchaseOrderId)}`,
                          tone: 'warn',
                          facts: [
                            ['أمر الشراء', <Code key="po">{shortId(i.purchaseOrderId)}</Code>],
                            ['الكمية المطلوبة', <Code key="req">{i.requestedQuantity}</Code>],
                            ['الكمية المؤكدة', <Code key="conf">{i.confirmedQuantity ?? 0}</Code>],
                            ['عدد الطلبات المتأثرة', <Code key="all">{i.orderAllocations}</Code>],
                          ],
                          nextStep: 'افتح شاشة أوامر الشراء لتحديد حصة كل طلب من الكمية المتاحة باعتماد موثق.',
                          destinationHref: '/admin/sourcing',
                          destinationLabel: 'توزيع أوامر الشراء',
                        })
                      }
                    >
                      توزيع الحصص
                    </Button>
                  }
                />
              ))}

            {/* Failed Deliveries */}
            {(queueFilter === 'all' || queueFilter === 'delivery') &&
              a.failedDeliveries.items.map((i) => (
                <QueueRow
                  key={`fail-${i.orderId}`}
                  tone="danger"
                  title={
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-bw-ink">تعثر محاولة توصيل</span>
                      {orderLink(i.orderId, i.orderNumber)}
                    </div>
                  }
                  detail={
                    <>
                      السبب: {i.reasonCode ? FAILURE_REASONS[i.reasonCode] ?? i.reasonCode : 'غير محدد'}
                    </>
                  }
                  meta={formatDateTime(i.failedAt)}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() =>
                        inspectException({
                          id: i.orderId,
                          category: 'delivery',
                          categoryLabel: 'توصيل متعثر',
                          title: `تعثر تسليم ${i.orderNumber ?? shortId(i.orderId)}`,
                          orderId: i.orderId,
                          orderNumber: i.orderNumber,
                          tone: 'danger',
                          facts: [
                            ['الطلب', orderLink(i.orderId, i.orderNumber)],
                            ['سبب التعثر', i.reasonCode ? FAILURE_REASONS[i.reasonCode] ?? i.reasonCode : 'غير محدد'],
                            ['توقيت المحاولة', formatDateTime(i.failedAt)],
                          ],
                          nextStep: 'تواصل مع العميل لتصحيح العنوان/الدبوس أو جدول موعد إعادة المحاولة أو استرجاع الطرد.',
                          destinationHref: `/admin/orders/${i.orderId}`,
                          destinationLabel: 'معالجة التعثر',
                        })
                      }
                    >
                      معالجة
                    </Button>
                  }
                />
              ))}

            {/* Cash Variances */}
            {(queueFilter === 'all' || queueFilter === 'cash') &&
              [...a.cashVariances.short.items, ...a.cashVariances.over.items].map((i) => (
                <QueueRow
                  key={`cash-${i.orderId}-${i.variance}`}
                  tone="danger"
                  title={
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-bw-ink">فرق نقدية في العد</span>
                      <Link href={`/admin/orders/${i.orderId}`} className="underline font-semibold">
                        <Code>{i.orderNumber}</Code>
                      </Link>
                    </div>
                  }
                  detail={
                    <>
                      المتوقع: <Egp value={i.expectedAmount} /> · المسلم: <Egp value={i.declaredAmount} /> · بعد العد:{' '}
                      <Egp value={i.countedAmount} /> · الفرق: <Egp value={i.variance} />
                    </>
                  }
                  action={
                    <Button
                      variant="secondary"
                      onClick={() =>
                        inspectException({
                          id: i.orderId,
                          category: 'cash',
                          categoryLabel: 'فروق نقدية',
                          title: `فرق تحصيل بالطلب ${i.orderNumber}`,
                          orderId: i.orderId,
                          orderNumber: i.orderNumber,
                          tone: 'danger',
                          facts: [
                            ['الطلب', <Code key="co">{i.orderNumber}</Code>],
                            ['المبلغ المتوقع', <Egp key="exp" value={i.expectedAmount} />],
                            ['المعلن من المندوب', <Egp key="dec" value={i.declaredAmount} />],
                            ['المعدود بالخزينة', <Egp key="cnt" value={i.countedAmount} />],
                            ['الفرق', <Egp key="diff" value={i.variance} />],
                          ],
                          nextStep: 'افتح شاشة التسويات لاعتماد الفرق أو طلب إعادة العد بالتنسيق مع المشرف.',
                          destinationHref: '/admin/cash',
                          destinationLabel: 'شاشة التسويات',
                        })
                      }
                    >
                      تسوية
                    </Button>
                  }
                />
              ))}

            {/* Delivered Unsettled Cash */}
            {(queueFilter === 'all' || queueFilter === 'unsettled') &&
              a.deliveredUnsettled.items.map((i) => (
                <QueueRow
                  key={`unsettled-${i.orderId}`}
                  tone="warn"
                  title={
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-bw-ink">كاش معلن مستني العد بالمخزن</span>
                      <Link href={`/admin/orders/${i.orderId}`} className="underline font-semibold">
                        <Code>{i.orderNumber}</Code>
                      </Link>
                    </div>
                  }
                  detail={<>أعلن المندوب تحصيل: <Egp value={i.declaredAmount} /></>}
                  action={
                    <Link
                      href="/admin/cash"
                      className="inline-flex h-bw-control items-center gap-1 rounded-bw-field border border-bw-line-field bg-bw-surface px-3 text-bw-small font-semibold hover:bg-bw-sunken"
                    >
                      عد النقدية
                    </Link>
                  }
                />
              ))}

            {/* Event Failures */}
            {(queueFilter === 'all' || queueFilter === 'events') &&
              [...a.eventFailures.failed, ...a.eventFailures.dead].map((e) => (
                <QueueRow
                  key={`event-${e.id}`}
                  tone="danger"
                  title={<>فشل حدث نظام: <Code>{e.eventType}</Code></>}
                  detail={
                    <>
                      المستهلك: {e.consumer} · المحاولات: <Code>{e.attempts}</Code> {e.lastError ? `· ${e.lastError}` : ''}
                    </>
                  }
                  action={
                    <Button
                      variant="secondary"
                      onClick={() =>
                        inspectException({
                          id: e.id,
                          category: 'events',
                          categoryLabel: 'أخطاء نظام',
                          title: `فشل حدث ${e.eventType}`,
                          tone: 'danger',
                          facts: [
                            ['نوع الحدث', <Code key="et">{e.eventType}</Code>],
                            ['المستهلك', e.consumer],
                            ['المعرف المرتبط', <Code key="ag">{shortId(e.aggregateId)}</Code>],
                            ['عدد المحاولات', <Code key="at">{e.attempts}</Code>],
                            ['آخر خطأ مسجل', e.lastError ?? '—'],
                          ],
                          nextStep: 'تحقق من صحة المعاملة وسلامة خادم الأحداث لإعادة المحاولة.',
                          destinationHref: `/admin/orders/${e.aggregateId}`,
                          destinationLabel: 'فحص الكيان المرتبط',
                        })
                      }
                    >
                      فحص
                    </Button>
                  }
                />
              ))}

            {/* Open Support Cases */}
            {(queueFilter === 'all' || queueFilter === 'support') &&
              a.openCases.items.map((c) => (
                <QueueRow
                  key={`case-${c.id}`}
                  tone={c.priority === 'critical' || c.priority === 'high' ? 'danger' : 'warn'}
                  title={c.title}
                  detail={c.orderId ? <>مرتبط بطلب: {orderLink(c.orderId, null)}</> : 'استفسار عام'}
                  meta={formatDateTime(c.createdAt)}
                  action={
                    c.orderId ? (
                      <Link
                        href={`/admin/orders/${c.orderId}`}
                        className="inline-flex h-bw-control items-center gap-1 rounded-bw-field border border-bw-line-field bg-bw-surface px-3 text-bw-small font-semibold hover:bg-bw-sunken"
                      >
                        فتح الطلب
                      </Link>
                    ) : undefined
                  }
                />
              ))}
          </ul>
        ) : null}
      </Section>

      {/* ── Recent Orders Table & Operational Filtering ───────────────── */}
      <Section
        title="أحدث الطلبات والعمليات"
        aside={
          <Link href="/admin/orders" className="text-bw-small font-semibold text-bw-action-ink underline hover:text-bw-action">
            عرض كافة الطلبات (<Code>{orders.data?.total ?? 0}</Code>)
          </Link>
        }
      >
        {/* Controls: Search, Status, Date Window */}
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-bw-card border border-bw-line bg-bw-sunken p-3">
          <div className="min-w-48 flex-1 space-y-1">
            <label htmlFor="overview-order-search" className="block text-bw-small font-semibold text-bw-ink">
              بحث سريع
            </label>
            <div className="relative">
              <input
                id="overview-order-search"
                value={orderQueryInput}
                onChange={(e) => setOrderQueryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setActiveQuery(orderQueryInput.trim())
                }}
                placeholder="رقم الطلب، اسم العميل، أو الموبايل"
                className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface pe-9 ps-3 text-bw-body text-bw-ink placeholder:text-bw-ink-subtle"
              />
              <button
                type="button"
                onClick={() => setActiveQuery(orderQueryInput.trim())}
                aria-label="تنفيذ البحث"
                className="absolute end-2 top-2.5 text-bw-ink-soft hover:text-bw-ink"
              >
                <Search className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="w-48 space-y-1">
            <Select
              label="حالة الطلب"
              value={orderStatus}
              onChange={(val) => setOrderStatus(val)}
              options={[['', 'كل الحالات'], ...Object.entries(ORDER_STATUS).map(([k, [t]]) => [k, t] as [string, string])]}
            />
          </div>

          <div className="w-40 space-y-1">
            <Select
              label="النطاق الزمني"
              value={dateFilter}
              onChange={(val) => setDateFilter(val as 'all' | 'today')}
              options={[
                ['all', 'كافة المسجل'],
                ['today', 'طلبات اليوم فقط'],
              ]}
            />
          </div>

          <Button
            variant="secondary"
            onClick={() => {
              setOrderQueryInput('')
              setActiveQuery('')
              setOrderStatus('')
              setDateFilter('all')
            }}
          >
            إلغاء الفلاتر
          </Button>
        </div>

        {/* Loading skeleton */}
        {orders.loading && !orders.data ? <Skeleton className="h-64 w-full" /> : null}

        {/* Empty state */}
        {orders.data && filteredOrders.length === 0 ? (
          <StateBlock
            kind="empty"
            title="لا توجد طلبات مطابقة للشروط"
            body="جرب تغيير معايير البحث أو اختيار حالة أخرى."
          />
        ) : null}

        {/* Orders Table */}
        {filteredOrders.length > 0 ? (
          <DataTable
            caption="قائمة أحدث الطلبات التشغيلية"
            head={['الطلب', 'العميل', 'المحافظة والمنطقة', 'الحالة', 'المطلوب عند التسليم', 'القطع', 'تاريخ الطلب', 'إجراء']}
          >
            {filteredOrders.map((o) => (
              <tr key={o.id} className="hover:bg-bw-sunken/40">
                <td>
                  <Link href={`/admin/orders/${o.id}`} className="font-semibold text-bw-action-ink underline hover:text-bw-action">
                    <Code>{o.orderNumber}</Code>
                  </Link>
                </td>
                <td className="font-medium text-bw-ink">{o.customerName}</td>
                <td>
                  <span className="text-bw-body">
                    {[o.area, o.governorate].filter(Boolean).join('، ') || '—'}
                  </span>
                  {o.hasPin ? (
                    <span className="ms-1.5 inline-flex items-center text-xs text-bw-ok font-medium">
                      ✓ دبوس
                    </span>
                  ) : (
                    <span className="ms-1.5 inline-flex items-center text-xs text-bw-ink-subtle">
                      بدون دبوس
                    </span>
                  )}
                </td>
                <td>
                  <Status map={ORDER_STATUS} value={o.status} />
                </td>
                <td>
                  <div className="flex flex-col">
                    <Egp value={o.codAmount ?? o.totalAmount} className="font-semibold" />
                    <span className="text-[11px] text-bw-ink-subtle">{o.paymentMethod}</span>
                  </div>
                </td>
                <td>
                  <Code>{o.itemCount}</Code>
                </td>
                <td className="text-bw-small text-bw-ink-soft">
                  {formatDateTime(o.createdAt)}
                </td>
                <td>
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="inline-flex min-h-6 items-center gap-1 text-bw-small font-semibold text-bw-action hover:underline"
                  >
                    فتح
                    <ArrowLeft className="size-3.5" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : null}
      </Section>

      {/* ── Inspection Drawer for Selected Exception ─────────────────── */}
      <Dialog
        dialogRef={drawer.ref}
        variant="drawer"
        title={selectedException?.categoryLabel ?? 'تفاصيل التدخل المطلوب'}
        onClose={() => setSelectedException(null)}
        footer={
          selectedException ? (
            <div className="flex w-full items-center justify-between gap-2">
              <Button variant="secondary" onClick={() => drawer.close()}>
                إغلاق
              </Button>
              <Link
                href={selectedException.destinationHref}
                className="inline-flex h-bw-control items-center justify-center gap-2 rounded-bw-field bg-bw-action px-4 text-bw-small font-semibold text-bw-on-action hover:bg-bw-action-hover"
              >
                {selectedException.destinationLabel}
                <ArrowLeft className="size-4" aria-hidden />
              </Link>
            </div>
          ) : undefined
        }
      >
        {selectedException ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <StatusLabel tone={selectedException.tone}>{selectedException.categoryLabel}</StatusLabel>
              </div>
              <h3 className="text-bw-heading font-semibold text-bw-ink">
                {selectedException.title}
              </h3>
            </div>

            <dl className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-sunken">
              {selectedException.facts.map(([label, val]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-bw-small">
                  <dt className="text-bw-ink-soft">{label}</dt>
                  <dd className="font-semibold text-bw-ink">{val}</dd>
                </div>
              ))}
            </dl>

            <Notice tone="neutral" title="الخطوة التشغيلية المعتمدة">
              {selectedException.nextStep}
            </Notice>
          </div>
        ) : null}
      </Dialog>
    </Page>
  )
}
