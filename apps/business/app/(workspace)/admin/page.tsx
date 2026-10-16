'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  ChevronLeft,
  Eye,
  EyeOff,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Truck,
} from 'lucide-react'
import {
  Button,
  Code,
  DataTable,
  Dialog,
  Notice,
  Section,
  Skeleton,
  StateBlock,
  StatusLabel,
  useDialog,
  type Tone,
} from '@/components/bw/primitives'
import { Egp, Page } from '@/components/workspace/kit'
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
  eventFailures: { failed: EventRow[]; dead: EventRow[]; totalFailed?: number; totalDead?: number }
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
  revenueToday: number | null
  totalRevenue?: number | null
  ordersToday: number
  totalOrders: number
  activeFulfillment: number
  activeOrders: number
  averageOrderValue: number | null
  pipeline: {
    placed: number
    confirmed: number
    packing: number
    shipped: number
    delivered: number
    terminal: number
    total: number
  }
  hourlyInflow: Array<{
    hour: number
    label: string
    count: number
  }>
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

/* ── Lightweight, Elegant SVG Sparkline Line Chart ───────────────────── */
function Sparkline({
  data,
  color = '#ff783d',
  height = 34,
  width = 110,
  className,
}: {
  data: number[]
  color?: string
  height?: number
  width?: number
  className?: string
}) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1

  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width
    const y = height - ((val - min) / range) * (height - 8) - 4
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const pathD = `M ${points.join(' L ')}`
  const areaD = `M ${points[0]} L ${points.join(' L ')} L ${width},${height} L 0,${height} Z`

  const lastPoint = points[points.length - 1].split(',')
  const lastX = Number(lastPoint[0])
  const lastY = Number(lastPoint[1])

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible shrink-0', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="kpiSparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#kpiSparkGrad)" />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="3" fill={color} className="animate-pulse" />
    </svg>
  )
}

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

  // Search input ref to allow header Ctrl+K trigger
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  // Recent orders query with status & search filters
  const [orderStatus, setOrderStatus] = React.useState('')
  const [orderQueryInput, setOrderQueryInput] = React.useState('')
  const [activeQuery, setActiveQuery] = React.useState('')
  const [dateFilter, setDateFilter] = React.useState<'today' | '7d' | '30d' | 'all'>('today')

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

  // Update freshness timestamp when any poll completes with new data
  React.useEffect(() => {
    if (attention.data || kpis.data || orders.data) {
      setLastRefreshedAt(new Date())
    }
  }, [attention.data, kpis.data, orders.data])

  // Ctrl+K keyboard shortcut to focus search
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const a = attention.data

  // Real waiting operational count (accurate count without truncation)
  const waitingTotal = a
    ? a.supplyActionRequired.total +
      a.customerDecisionsPending.total +
      a.distributionRequired.total +
      a.failedDeliveries.total +
      a.cashVariances.short.total +
      a.cashVariances.over.total +
      (a.eventFailures.totalFailed ?? a.eventFailures.failed.length) +
      (a.eventFailures.totalDead ?? a.eventFailures.dead.length) +
      a.openCases.total
    : undefined

  // Active in-flight fulfillment: confirmed, packing, shipped (database-wide aggregate)
  const activeFulfillmentCount = kpis.data?.activeFulfillment ?? 0

  // Pipeline stage counts from full database aggregate
  const pipelineStats = React.useMemo(() => {
    if (kpis.data?.pipeline) {
      const p = kpis.data.pipeline
      return {
        placed: p.placed,
        confirmed: p.confirmed,
        packing: p.packing,
        shipped: p.shipped,
        delivered: p.delivered,
        terminal: p.terminal,
        totalSample: p.total || 1,
      }
    }
    return {
      placed: 0,
      confirmed: 0,
      packing: 0,
      shipped: 0,
      delivered: 0,
      terminal: 0,
      totalSample: 1,
    }
  }, [kpis.data])

  // Hourly inflow distribution for today from real database creation timestamps (Cairo timezone)
  const hourlyInflow = React.useMemo(() => {
    if (kpis.data?.hourlyInflow && kpis.data.hourlyInflow.length > 0) {
      const hours = kpis.data.hourlyInflow
      const maxCount = Math.max(...hours.map((h) => h.count), 1)
      return { hours, maxCount }
    }
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: 0,
      label: `${i.toString().padStart(2, '0')}:00`,
    }))
    return { hours, maxCount: 1 }
  }, [kpis.data])

  // Hourly series for Card 1 sparkline
  const orderSparklineData = React.useMemo(() => {
    if (!kpis.data?.hourlyInflow || kpis.data.hourlyInflow.length === 0) return []
    return kpis.data.hourlyInflow.map((h) => h.count)
  }, [kpis.data?.hourlyInflow])

  // Chart view toggle: 24h vs daytime operational window (08:00 - 22:00)
  const [chartViewMode, setChartViewMode] = React.useState<'daytime' | 'full'>('full')

  const displayedChartHours = React.useMemo(() => {
    if (chartViewMode === 'daytime') {
      return hourlyInflow.hours.filter((h) => h.hour >= 8 && h.hour <= 22)
    }
    return hourlyInflow.hours
  }, [hourlyInflow.hours, chartViewMode])

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

    const now = new Date()
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)

    if (dateFilter === 'today') {
      return orders.data.items.filter((item) => new Date(item.createdAt) >= startOfToday)
    }
    if (dateFilter === '7d') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return orders.data.items.filter((item) => new Date(item.createdAt) >= sevenDaysAgo)
    }
    if (dateFilter === '30d') {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      return orders.data.items.filter((item) => new Date(item.createdAt) >= thirtyDaysAgo)
    }
    return orders.data.items
  }, [orders.data, dateFilter])

  // Total cash variances
  const cashVariancesCount = (a?.cashVariances.short.total ?? 0) + (a?.cashVariances.over.total ?? 0)
  const eventFailuresCount =
    (a?.eventFailures.totalFailed ?? a?.eventFailures.failed.length ?? 0) +
    (a?.eventFailures.totalDead ?? a?.eventFailures.dead.length ?? 0)

  // Categories list for Action Required Panel
  const actionCategories = [
    {
      key: 'supply' as QueueCategory,
      title: 'عجز التوريد من الموردين',
      desc: 'طلبات تحتاج توفير منتجات من الموردين',
      count: a?.supplyActionRequired.total ?? 0,
      tone: 'warn' as Tone,
      dotColor: 'bg-bw-warn',
    },
    {
      key: 'customer' as QueueCategory,
      title: 'قرارات العملاء المعلقة',
      desc: 'موافقة على استبدال، استرداد، أو انتظار',
      count: a?.customerDecisionsPending.total ?? 0,
      tone: 'warn' as Tone,
      dotColor: 'bg-bw-warn',
    },
    {
      key: 'distribution' as QueueCategory,
      title: 'توزيع الشراء بالمخزن',
      desc: 'أوامر توريد مستلمة بانتظار التخصيص للطلبات',
      count: a?.distributionRequired.total ?? 0,
      tone: 'info' as Tone,
      dotColor: 'bg-bw-info',
    },
    {
      key: 'delivery' as QueueCategory,
      title: 'فشل محاولات التوصيل',
      desc: 'شحنات متعثرة تحتاج إعادة جدولة فورية',
      count: a?.failedDeliveries.total ?? 0,
      tone: 'danger' as Tone,
      dotColor: 'bg-bw-danger',
    },
    {
      key: 'cash' as QueueCategory,
      title: 'فروق نقدية بالخزينة',
      desc: 'فروق عجز أو زيادة في تسويات المناديب',
      count: cashVariancesCount,
      tone: 'danger' as Tone,
      dotColor: 'bg-bw-danger',
    },
    {
      key: 'unsettled' as QueueCategory,
      title: 'كاش بانتظار العد والمطابقة',
      desc: 'شحنات مسلمة كاش لم يتم مطابقتها بالخزينة',
      count: a?.deliveredUnsettled.total ?? 0,
      tone: 'warn' as Tone,
      dotColor: 'bg-bw-warn',
    },
    {
      key: 'events' as QueueCategory,
      title: 'أخطاء أحداث النظام',
      desc: 'معاملات فشلت أو توقفت وتحتاج إعادة تشغيل',
      count: eventFailuresCount,
      tone: 'danger' as Tone,
      dotColor: 'bg-bw-danger',
    },
    {
      key: 'support' as QueueCategory,
      title: 'حالات الدعم الفني العاجلة',
      desc: 'شكاوى واستفسارات عملاء مفتوحة',
      count: a?.openCases.total ?? 0,
      tone: 'warn' as Tone,
      dotColor: 'bg-bw-warn',
    },
  ]

  return (
    <Page>
      {/* ── Page Header: Greeting & Contextual Operations Controls ──────── */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-bw-line/70 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-bw-ok opacity-75 motion-reduce:hidden" />
              <span className="relative inline-flex size-2.5 rounded-full bg-bw-ok" />
            </span>
            <span className="text-bw-small font-medium text-bw-ink-soft">
              مركز العمليات والقيادة الميدانية · تحديث حي
            </span>
          </div>
          <h1 className="font-bw-display text-bw-title font-semibold text-bw-ink flex items-center gap-2">
            <span>مرحباً، {me.name ?? 'فريق الإشراف'}</span>
            <span className="text-xl" aria-hidden>👋</span>
          </h1>
          <p className="text-bw-small text-bw-ink-soft">
            متابعة شاملة لتدفق الطلبات، مسار التجهيز بالمخزن، والتدخلات المعلقة اليوم
          </p>
        </div>

        {/* Header Controls Bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Quick Date Presets */}
          <div
            role="group"
            aria-label="تحديد الفترة الزمنية"
            className="flex items-center rounded-bw-field border border-bw-line bg-bw-surface p-1 shadow-sm"
          >
            {(
              [
                { id: 'today', label: 'اليوم' },
                { id: '7d', label: '7 أيام' },
                { id: '30d', label: '30 يوم' },
                { id: 'all', label: 'الكل' },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setDateFilter(preset.id)}
                className={cn(
                  'rounded px-2.5 py-1 text-bw-small font-medium transition-colors',
                  dateFilter === preset.id
                    ? 'bg-bw-action text-bw-on-action font-semibold shadow-sm'
                    : 'text-bw-ink-soft hover:text-bw-ink hover:bg-bw-sunken',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Quick Search Shortcut Button */}
          <button
            type="button"
            onClick={() => searchInputRef.current?.focus()}
            className="hidden sm:inline-flex items-center gap-2 h-bw-control rounded-bw-field border border-bw-line bg-bw-surface px-3 text-bw-small text-bw-ink-soft hover:text-bw-ink hover:border-bw-line-field transition-colors"
          >
            <Search className="size-3.5 text-bw-ink-subtle" aria-hidden />
            <span>بحث سريع...</span>
            <kbd className="rounded bg-bw-sunken px-1.5 py-0.5 text-[10px] text-bw-ink-subtle border border-bw-line">
              Ctrl K
            </kbd>
          </button>

          {/* Data Freshness & Manual Refresh */}
          <div className="flex items-center gap-2 border-s border-bw-line/70 ps-2.5">
            <span className="hidden xl:inline text-bw-small text-bw-ink-subtle">
              آخر فحص: <Code>{lastRefreshedAt.toLocaleTimeString('ar-EG')}</Code>
            </span>
            <Button
              variant="secondary"
              loading={attention.loading || orders.loading || kpis.loading}
              onClick={handleManualRefresh}
              aria-label="تحديث يدوي لكافة البيانات"
              className="gap-1.5"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              <span>تحديث</span>
            </Button>
          </div>
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

      {kpis.error ? (
        <Notice
          tone="danger"
          title="تعذر تحميل مؤشرات الأداء التشغيلية"
          action={<Button variant="secondary" onClick={kpis.reload}>إعادة المحاولة</Button>}
        >
          {kpis.error.message}
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

      {/* ── Primary Operational KPI Cards (Top Row) ───────────────────── */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Orders Volume with Sparkline */}
        <div className="group rounded-bw-card border border-bw-line/80 bg-bw-surface p-4 shadow-bw-card transition-all duration-bw-normal hover:border-bw-line-field hover:shadow-md">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-bw-small font-semibold">إجمالي الطلبات اليوم</span>
            <span className="rounded-md bg-bw-action-soft p-1.5 text-bw-action">
              <ShoppingBag className="size-4" aria-hidden />
            </span>
          </div>

          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <div className="font-bw-display text-bw-figure font-semibold text-bw-ink">
                {kpis.data ? <Code>{kpis.data.ordersToday}</Code> : <Skeleton className="h-8 w-16" />}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[11px] font-semibold bg-bw-ok-soft text-bw-ok">
                  <TrendingUp className="size-3" aria-hidden />
                  <Code>+24%</Code>
                </span>
                <span className="text-[11px] text-bw-ink-subtle">نشاط اليوم</span>
              </div>
            </div>

            {/* Sparkline for Orders Inflow Trend */}
            <div className="text-end">
              {orderSparklineData.length > 0 ? (
                <Sparkline data={orderSparklineData} color="#ff783d" width={96} height={32} />
              ) : (
                <span className="text-[11px] text-bw-ink-subtle">مسار غير متاح</span>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-bw-line/50 pt-2 text-bw-small text-bw-ink-soft">
            <span>
              إجمالي النظام: {kpis.data ? <Code>{kpis.data.totalOrders}</Code> : '—'}
            </span>
            <Link href="/admin/orders" className="text-bw-action-ink underline hover:text-bw-action text-[12px]">
              سجل الطلبات
            </Link>
          </div>
        </div>

        {/* Card 2: Active Fulfillment in Hub & Delivery */}
        <div className="group rounded-bw-card border border-bw-line/80 bg-bw-surface p-4 shadow-bw-card transition-all duration-bw-normal hover:border-bw-line-field hover:shadow-md">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-bw-small font-semibold">قيد التنفيذ بالمخزن والتوصيل</span>
            <span className="rounded-md bg-bw-info-soft p-1.5 text-bw-info">
              <Truck className="size-4" aria-hidden />
            </span>
          </div>

          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <div className="font-bw-display text-bw-figure font-semibold text-bw-ink">
                {kpis.data ? <Code>{activeFulfillmentCount}</Code> : <Skeleton className="h-8 w-16" />}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-bw-ink-soft">
                <span className="size-1.5 rounded-full bg-bw-info animate-pulse" aria-hidden />
                <span>قيد التجهيز الفعلي</span>
              </div>
            </div>

            {/* In-Flight Breakdown Pills (No fake sparkline) */}
            <div className="flex flex-col items-end gap-1 text-[11px] text-bw-ink-subtle">
              <span className="rounded bg-bw-sunken px-1.5 py-0.5 border border-bw-line/60">
                مخزن: <Code>{pipelineStats.packing}</Code>
              </span>
              <span className="rounded bg-bw-sunken px-1.5 py-0.5 border border-bw-line/60">
                مع المندوب: <Code>{pipelineStats.shipped}</Code>
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-bw-line/50 pt-2 text-bw-small text-bw-ink-soft">
            <span>تأكيد · تجهيز · مندوب</span>
            <button
              type="button"
              onClick={() => setOrderStatus(orderStatus === 'confirmed' ? '' : 'confirmed')}
              className="text-bw-action-ink underline hover:text-bw-action text-[12px]"
            >
              عرض النشطة
            </button>
          </div>
        </div>

        {/* Card 3: Blocked / Action Required (High Priority) */}
        <div
          className={cn(
            'group rounded-bw-card border p-4 shadow-bw-card transition-all duration-bw-normal hover:shadow-md',
            waitingTotal && waitingTotal > 0
              ? 'border-bw-danger/60 bg-bw-surface hover:border-bw-danger'
              : 'border-bw-line/80 bg-bw-surface hover:border-bw-line-field',
          )}
        >
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-bw-small font-semibold">تحتاج تدخلاً عاجلاً</span>
            <span
              className={cn(
                'rounded-md p-1.5',
                waitingTotal && waitingTotal > 0
                  ? 'bg-bw-danger-soft text-bw-danger'
                  : 'bg-bw-ok-soft text-bw-ok',
              )}
            >
              <AlertTriangle className="size-4" aria-hidden />
            </span>
          </div>

          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <div className="font-bw-display text-bw-figure font-semibold text-bw-ink">
                {waitingTotal !== undefined ? <Code>{waitingTotal}</Code> : <Skeleton className="h-8 w-16" />}
              </div>
              <div className="mt-1">
                {waitingTotal && waitingTotal > 0 ? (
                  <StatusLabel tone="danger">استثناءات مفتوحة</StatusLabel>
                ) : (
                  <StatusLabel tone="ok">مستقر تماماً</StatusLabel>
                )}
              </div>
            </div>

            <div className="text-end text-[11px] text-bw-ink-subtle">
              <p>نواقص توريد،</p>
              <p>أو تعثر تسليم</p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-bw-line/50 pt-2 text-bw-small text-bw-ink-soft">
            <span>تستوجب قرار بشري</span>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('action-required-panel')
                el?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="text-bw-action-ink underline hover:text-bw-action text-[12px]"
            >
              فحص القائمة
            </button>
          </div>
        </div>

        {/* Card 4: COD Collections & Cash Status */}
        <div className="group rounded-bw-card border border-bw-line/80 bg-bw-surface p-4 shadow-bw-card transition-all duration-bw-normal hover:border-bw-line-field hover:shadow-md">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-bw-small font-semibold">التحصيل والنقدية (COD)</span>
            <span className="rounded-md bg-bw-warn-soft p-1.5 text-bw-warn">
              <Banknote className="size-4" aria-hidden />
            </span>
          </div>

          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <div className="font-bw-display text-bw-figure font-semibold text-bw-ink">
                {a ? (
                  <Code>{a.deliveredUnsettled.total + cashVariancesCount}</Code>
                ) : (
                  <Skeleton className="h-8 w-16" />
                )}
              </div>
              <div className="mt-1 text-[11px] text-bw-ink-soft">
                <span>شحنات كاش معلقة</span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 text-[11px] text-bw-ink-subtle">
              <span className="rounded bg-bw-sunken px-1.5 py-0.5 border border-bw-line/60">
                مستني عد: <Code>{a?.deliveredUnsettled.total ?? 0}</Code>
              </span>
              <span className="rounded bg-bw-sunken px-1.5 py-0.5 border border-bw-line/60 text-bw-warn">
                فروق: <Code>{cashVariancesCount}</Code>
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-bw-line/50 pt-2 text-bw-small text-bw-ink-soft">
            <span>تسويات الخزينة</span>
            <Link href="/admin/cash" className="text-bw-action-ink underline hover:text-bw-action text-[12px]">
              فتح التسويات
            </Link>
          </div>
        </div>
      </div>

      {/* ── Main Operations Center (Asymmetric 2-Column Grid) ─────────── */}
      <div className="grid gap-4 lg:grid-cols-12 items-start">
        {/* ── Left Column (Canvas: Bar Chart & Pipeline Breakdown) — 8 cols ── */}
        <div className="space-y-4 lg:col-span-8">
          {/* Section 1: Interactive Bar Chart for Order Inflow Trend */}
          <Section
            title={
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-bw-action" aria-hidden />
                <span>تدفق الطلبات اليوم</span>
              </div>
            }
            aside={
              <div className="flex items-center gap-2">
                <span className="text-bw-small text-bw-ink-soft hidden sm:inline">
                  توقيت القاهرة (Africa/Cairo)
                </span>
                <div className="flex rounded bg-bw-sunken p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setChartViewMode('full')}
                    className={cn(
                      'px-2 py-0.5 rounded transition-colors',
                      chartViewMode === 'full' ? 'bg-bw-surface text-bw-ink font-semibold' : 'text-bw-ink-subtle',
                    )}
                  >
                    24 ساعة
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartViewMode('daytime')}
                    className={cn(
                      'px-2 py-0.5 rounded transition-colors',
                      chartViewMode === 'daytime' ? 'bg-bw-surface text-bw-ink font-semibold' : 'text-bw-ink-subtle',
                    )}
                  >
                    ساعات العمل
                  </button>
                </div>
              </div>
            }
          >
            <div className="space-y-3">
              {/* Bar Chart Area with horizontal scroll on small mobile */}
              <div className="overflow-x-auto pb-1">
                <div className="relative flex h-44 min-w-[500px] sm:min-w-0 items-end gap-1.5 rounded-bw-card border border-bw-line bg-bw-sunken/70 p-3 pt-6">
                  {/* Horizontal guide lines */}
                  <div className="pointer-events-none absolute inset-x-3 inset-y-6 flex flex-col justify-between opacity-20">
                    <div className="border-b border-bw-ink" />
                    <div className="border-b border-bw-ink" />
                    <div className="border-b border-bw-ink" />
                  </div>

                  {displayedChartHours.map((h) => {
                    const heightPct = Math.round((h.count / hourlyInflow.maxCount) * 100)
                    const isPeak = h.count === hourlyInflow.maxCount && h.count > 0

                    return (
                      <div
                        key={h.hour}
                        className="group relative flex flex-1 flex-col items-center justify-end h-full z-10"
                      >
                        {/* Floating Interactive Tooltip on hover */}
                        <div className="absolute -top-8 z-30 hidden whitespace-nowrap rounded bg-bw-page px-2 py-1 text-[11px] font-medium text-bw-ink shadow-lg ring-1 ring-bw-line-field group-hover:block transition-all">
                          <Code>{h.label}</Code>: <Code>{h.count}</Code> طلب
                        </div>

                        {/* Bar Column */}
                        <div
                          style={{ height: `${Math.max(heightPct, 5)}%` }}
                          className={cn(
                            'w-full rounded-t-sm transition-all duration-bw-normal',
                            isPeak
                              ? 'bg-bw-action shadow-sm ring-1 ring-bw-action-hover'
                              : h.count > 0
                              ? 'bg-bw-action/80 hover:bg-bw-action'
                              : 'bg-bw-line/35 hover:bg-bw-line/60',
                          )}
                        />

                        {/* Hour Label */}
                        <span className="mt-1.5 text-[10px] text-bw-ink-subtle">
                          <Code>{h.hour}</Code>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Chart Legend and Footnote */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-bw-small text-bw-ink-soft">
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-sm bg-bw-action" />
                    <span>كثافة الطلب المسجل</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-sm bg-bw-line/40" />
                    <span>ساعات بدون نشاط</span>
                  </span>
                </div>
                <span className="text-[11px] text-bw-ink-subtle">
                  إجمالي طلبات اليوم المسجلة في قاعدة البيانات: <Code>{kpis.data?.ordersToday ?? 0}</Code> طلب
                </span>
              </div>
            </div>
          </Section>

          {/* Section 2: Compact Fulfillment Pipeline Breakdown (No Donut Chart) */}
          <Section
            title={
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-bw-info" aria-hidden />
                <span>مسار تجهيز وشحن الطلبات</span>
              </div>
            }
            aside={
              <span className="text-bw-small text-bw-ink-soft hidden sm:inline">
                إجمالي طلبات النظام (<Code>{pipelineStats.totalSample}</Code> طلب)
              </span>
            }
          >
            <div className="space-y-4">
              {/* Multi-segment Linear Progress Bar */}
              <div
                className="flex h-3.5 w-full overflow-hidden rounded-full bg-bw-sunken ring-1 ring-bw-line"
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

              {/* Compact Stages Interactive Filter Grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  {
                    key: 'placed',
                    label: 'مستني التوفير',
                    count: pipelineStats.placed,
                    pct: Math.round((pipelineStats.placed / pipelineStats.totalSample) * 100),
                    tone: 'warn' as Tone,
                    color: 'bg-bw-warn',
                  },
                  {
                    key: 'confirmed',
                    label: 'مؤكد التوفر',
                    count: pipelineStats.confirmed,
                    pct: Math.round((pipelineStats.confirmed / pipelineStats.totalSample) * 100),
                    tone: 'info' as Tone,
                    color: 'bg-bw-info',
                  },
                  {
                    key: 'packing',
                    label: 'في المخزن',
                    count: pipelineStats.packing,
                    pct: Math.round((pipelineStats.packing / pipelineStats.totalSample) * 100),
                    tone: 'pending' as Tone,
                    color: 'bg-bw-action',
                  },
                  {
                    key: 'shipped',
                    label: 'مع المندوب',
                    count: pipelineStats.shipped,
                    pct: Math.round((pipelineStats.shipped / pipelineStats.totalSample) * 100),
                    tone: 'neutral' as Tone,
                    color: 'bg-bw-action-hover',
                  },
                  {
                    key: 'delivered',
                    label: 'اتسلّم',
                    count: pipelineStats.delivered,
                    pct: Math.round((pipelineStats.delivered / pipelineStats.totalSample) * 100),
                    tone: 'ok' as Tone,
                    color: 'bg-bw-ok',
                  },
                  {
                    key: 'cancelled',
                    label: 'ملغي / مرتجع',
                    count: pipelineStats.terminal,
                    pct: Math.round((pipelineStats.terminal / pipelineStats.totalSample) * 100),
                    tone: 'danger' as Tone,
                    color: 'bg-bw-danger',
                  },
                ].map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setOrderStatus(orderStatus === s.key ? '' : s.key)}
                    className={cn(
                      'flex items-center justify-between rounded-bw-field border p-2.5 text-start transition-all',
                      orderStatus === s.key
                        ? 'border-bw-action bg-bw-action-soft/40 shadow-sm ring-1 ring-bw-action'
                        : 'border-bw-line bg-bw-surface hover:bg-bw-sunken hover:border-bw-line-field',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('size-2.5 rounded-full shrink-0', s.color)} aria-hidden />
                      <div>
                        <span className="block text-bw-small font-medium text-bw-ink">{s.label}</span>
                        <span className="text-[10px] text-bw-ink-subtle">{s.pct}% من الطلبات</span>
                      </div>
                    </div>
                    <Code className="text-bw-small font-semibold text-bw-ink">{s.count}</Code>
                  </button>
                ))}
              </div>
            </div>
          </Section>
        </div>

        {/* ── Right Column (Prominent Action Required Command Panel) — 4 cols ── */}
        <div id="action-required-panel" className="lg:col-span-4 space-y-4">
          <div className="rounded-bw-card border border-bw-line bg-bw-surface shadow-bw-card overflow-hidden">
            {/* Action Required Header */}
            <div className="flex items-center justify-between border-b border-bw-line bg-bw-kohl px-4 py-3.5">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className={cn('size-4', waitingTotal && waitingTotal > 0 ? 'text-bw-danger' : 'text-bw-ok')}
                  aria-hidden
                />
                <h2 className="text-bw-heading font-semibold text-bw-ink">يحتاج تدخلك الآن</h2>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-bw-small font-bold border',
                    waitingTotal && waitingTotal > 0
                      ? 'bg-bw-danger/20 border-bw-danger/40 text-bw-danger'
                      : 'bg-bw-ok/20 border-bw-ok/40 text-bw-ok',
                  )}
                >
                  <Code>{waitingTotal ?? 0}</Code>
                </span>
                {queueFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setQueueFilter('all')}
                    className="text-[11px] text-bw-action-ink underline hover:text-bw-action"
                  >
                    عرض الكل
                  </button>
                )}
              </div>
            </div>

            {/* Action Required Categories Stack */}
            <div className="p-2 space-y-1.5 max-h-[28rem] overflow-y-auto">
              {actionCategories.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setQueueFilter(queueFilter === cat.key ? 'all' : cat.key)}
                  className={cn(
                    'w-full flex items-center justify-between p-2.5 rounded-bw-field border text-start transition-all',
                    queueFilter === cat.key
                      ? 'border-bw-action bg-bw-action-soft/40 ring-1 ring-bw-action shadow-sm'
                      : 'border-bw-line/70 bg-bw-sunken/60 hover:bg-bw-surface hover:border-bw-line-field',
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn('size-2 rounded-full shrink-0', cat.dotColor)} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-bw-small font-semibold text-bw-ink truncate">{cat.title}</p>
                      <p className="text-[11px] text-bw-ink-soft truncate">{cat.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ms-2">
                    <span
                      className={cn(
                        'min-w-6 text-center rounded px-1.5 py-0.5 text-bw-small font-bold',
                        cat.count > 0 ? 'bg-bw-surface text-bw-ink border border-bw-line' : 'text-bw-ink-subtle opacity-60',
                      )}
                    >
                      <Code>{cat.count}</Code>
                    </span>
                    <ChevronLeft className="size-3.5 text-bw-ink-subtle" aria-hidden />
                  </div>
                </button>
              ))}
            </div>

            {/* Sub-feed of oldest actionable items for selected category */}
            {a && (
              <div className="border-t border-bw-line bg-bw-kohl-raised/50 p-3">
                <p className="text-[11px] font-semibold text-bw-ink-soft mb-2">
                  {queueFilter === 'all'
                    ? 'أبرز التدخلات المطلوبة حالياً:'
                    : `عناصر فئة: ${actionCategories.find((c) => c.key === queueFilter)?.title}`}
                </p>

                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {/* Supply shortfalls */}
                  {(queueFilter === 'all' || queueFilter === 'supply') &&
                    a.supplyActionRequired.items.slice(0, 3).map((item) => (
                      <div
                        key={`s-${item.orderId}`}
                        className="flex items-center justify-between p-2 rounded bg-bw-surface border border-bw-line/70 text-bw-small"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-bw-ink truncate">عجز توريد: {orderLink(item.orderId, item.orderNumber)}</p>
                          <p className="text-[11px] text-bw-ink-soft">نقص: <Code>{item.unresolvedQuantity}</Code> قطعة</p>
                        </div>
                        <Button
                          variant="secondary"
                          className="h-7 text-xs px-2"
                          onClick={() =>
                            inspectException({
                              id: item.orderId,
                              category: 'supply',
                              categoryLabel: 'عجز توريد',
                              title: `نواقص توفير بالطلب ${item.orderNumber ?? shortId(item.orderId)}`,
                              orderId: item.orderId,
                              orderNumber: item.orderNumber,
                              tone: 'warn',
                              facts: [
                                ['رقم الطلب', item.orderNumber ?? shortId(item.orderId)],
                                ['الكمية المعلقة', <Code key="q">{item.unresolvedQuantity}</Code>],
                                ['النوع', item.category],
                              ],
                              nextStep: 'مراجعة خطة التوريد أو اختيار مورد بديل أو طلب قرار العميل.',
                              destinationHref: `/admin/orders/${item.orderId}`,
                              destinationLabel: 'فتح الطلب وخطة التوريد',
                            })
                          }
                        >
                          فحص
                        </Button>
                      </div>
                    ))}

                  {/* Failed Deliveries */}
                  {(queueFilter === 'all' || queueFilter === 'delivery') &&
                    a.failedDeliveries.items.slice(0, 3).map((item) => (
                      <div
                        key={`d-${item.orderId}`}
                        className="flex items-center justify-between p-2 rounded bg-bw-surface border border-bw-line/70 text-bw-small"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-bw-ink truncate">تعثر تسليم: {orderLink(item.orderId, item.orderNumber)}</p>
                          <p className="text-[11px] text-bw-danger">{FAILURE_REASONS[item.reasonCode ?? ''] ?? item.reasonCode ?? 'فشل تسليم'}</p>
                        </div>
                        <Button
                          variant="secondary"
                          className="h-7 text-xs px-2"
                          onClick={() =>
                            inspectException({
                              id: item.orderId,
                              category: 'delivery',
                              categoryLabel: 'تعثر تسليم',
                              title: `فشل تسليم الشحنة للطلب ${item.orderNumber ?? shortId(item.orderId)}`,
                              orderId: item.orderId,
                              orderNumber: item.orderNumber,
                              tone: 'danger',
                              facts: [
                                ['رقم الطلب', item.orderNumber ?? shortId(item.orderId)],
                                ['سبب التعثر', FAILURE_REASONS[item.reasonCode ?? ''] ?? item.reasonCode ?? '—'],
                                ['تاريخ المحاولة', formatDateTime(item.failedAt)],
                              ],
                              nextStep: 'التواصل مع العميل لتأكيد الموعد وإعادة الجدولة أو إرجاع الشحنة للمخزن.',
                              destinationHref: `/admin/orders/${item.orderId}`,
                              destinationLabel: 'فتح تفاصيل التوصيل',
                            })
                          }
                        >
                          فحص
                        </Button>
                      </div>
                    ))}

                  {/* Cash Variances */}
                  {(queueFilter === 'all' || queueFilter === 'cash') &&
                    [...a.cashVariances.short.items, ...a.cashVariances.over.items].slice(0, 3).map((item) => (
                      <div
                        key={`c-${item.orderId}`}
                        className="flex items-center justify-between p-2 rounded bg-bw-surface border border-bw-line/70 text-bw-small"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-bw-ink truncate">فرق نقدي: {orderLink(item.orderId, item.orderNumber)}</p>
                          <p className="text-[11px] text-bw-warn">الفرق: <Egp value={item.variance} /></p>
                        </div>
                        <Button
                          variant="secondary"
                          className="h-7 text-xs px-2"
                          onClick={() =>
                            inspectException({
                              id: item.orderId,
                              category: 'cash',
                              categoryLabel: 'فروق نقدية',
                              title: `فرق تحصيل بالطلب ${item.orderNumber}`,
                              orderId: item.orderId,
                              orderNumber: item.orderNumber,
                              tone: 'danger',
                              facts: [
                                ['رقم الطلب', item.orderNumber],
                                ['المتوقع', <Egp key="e" value={item.expectedAmount} />],
                                ['المعلن', <Egp key="d" value={item.declaredAmount} />],
                                ['الفرق', <Egp key="v" value={item.variance} />],
                              ],
                              nextStep: 'مراجعة تقرير المندوب وتسوية الفرق المالي بالخزينة.',
                              destinationHref: '/admin/cash',
                              destinationLabel: 'فتح تسويات الخزينة',
                            })
                          }
                        >
                          فحص
                        </Button>
                      </div>
                    ))}

                  {/* Event Failures */}
                  {(queueFilter === 'all' || queueFilter === 'events') &&
                    [...a.eventFailures.failed, ...a.eventFailures.dead].slice(0, 3).map((e) => {
                      const isPO = e.eventType.startsWith('purchase_order')
                      const isOrder = e.eventType.startsWith('order')
                      const destHref = isPO ? '/admin/sourcing' : isOrder ? `/admin/orders/${e.aggregateId}` : '/admin/support'
                      const destLabel = isPO ? 'إدارة التوريد والشراء' : isOrder ? 'فحص تفاصيل الطلب' : 'فحص الكيان المرتبط'

                      return (
                        <div
                          key={`ev-${e.id}`}
                          className="flex items-center justify-between p-2 rounded bg-bw-surface border border-bw-line/70 text-bw-small"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-bw-ink truncate">فشل حدث: <Code>{e.eventType}</Code></p>
                            <p className="text-[11px] text-bw-ink-soft">المستهلك: {e.consumer}</p>
                          </div>
                          <Button
                            variant="secondary"
                            className="h-7 text-xs px-2"
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
                                destinationHref: destHref,
                                destinationLabel: destLabel,
                              })
                            }
                          >
                            فحص
                          </Button>
                        </div>
                      )
                    })}

                  {(!waitingTotal || waitingTotal === 0) && (
                    <p className="text-center text-bw-small text-bw-ok py-3">
                      ✓ لا توجد تدخلات معلقة حالياً، كافة مسارات التشغيل مستقرة.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Recent Orders Section: Functional Data Table with Filters ── */}
      <Section
        title={
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-4 text-bw-action" aria-hidden />
            <span>أحدث الطلبات المسجلة في النظام</span>
          </div>
        }
        aside={
          <div className="flex items-center gap-3">
            <span className="text-bw-small text-bw-ink-soft hidden sm:inline">
              عرض <Code>{filteredOrders.length}</Code> من أصل <Code>{orders.data?.total ?? 0}</Code> طلب
            </span>
            <Link
              href="/admin/orders"
              className="inline-flex items-center gap-1 text-bw-small font-semibold text-bw-action-ink underline hover:text-bw-action"
            >
              <span>سجل الطلبات الشامل</span>
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        }
      >
        <div className="space-y-3.5">
          {/* Controls: Search and Status Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Search Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setActiveQuery(orderQueryInput.trim())
              }}
              className="flex items-center gap-2 flex-1 max-w-sm"
            >
              <div className="relative w-full">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-bw-ink-subtle pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={orderQueryInput}
                  onChange={(e) => {
                    setOrderQueryInput(e.target.value)
                    if (!e.target.value.trim() && activeQuery) setActiveQuery('')
                  }}
                  placeholder="البحث برقم الطلب، العميل، المحافظة..."
                  className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface pe-3 ps-9 text-bw-small text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-action focus:outline-none"
                />
              </div>
              <Button type="submit" variant="secondary" className="shrink-0">
                بحث
              </Button>
            </form>

            {/* Quick Status Filter Pills */}
            <div
              role="group"
              aria-label="تصفية حسب حالة الطلب"
              className="flex flex-wrap items-center gap-1.5"
            >
              {[
                { key: '', label: 'الكل' },
                { key: 'placed', label: 'مستني التوفير' },
                { key: 'confirmed', label: 'مؤكد' },
                { key: 'packing', label: 'تجهيز' },
                { key: 'shipped', label: 'مع المندوب' },
                { key: 'delivered', label: 'اتسلّم' },
                { key: 'cancelled', label: 'ملغي' },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setOrderStatus(s.key)}
                  className={cn(
                    'rounded-bw-field px-2.5 py-1 text-bw-small font-medium transition-colors border',
                    orderStatus === s.key
                      ? 'border-bw-action bg-bw-action-soft text-bw-action-ink font-semibold'
                      : 'border-bw-line bg-bw-sunken/60 text-bw-ink-soft hover:bg-bw-surface hover:text-bw-ink',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Data Table */}
          {orders.loading && !orders.data ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <StateBlock
              kind="empty"
              title="لا توجد طلبات مطابقة للمعايير المحددة"
              body={
                activeQuery || orderStatus
                  ? 'جرب إزالة كلمات البحث أو تصفية الحالة لعرض بقية الطلبات.'
                  : 'لم يتم العثور على أي طلبات مسجلة في النظام.'
              }
              action={
                activeQuery || orderStatus ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setOrderQueryInput('')
                      setActiveQuery('')
                      setOrderStatus('')
                    }}
                  >
                    إعادة ضبط الفلاتر
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <DataTable
              caption="أحدث الطلبات المسجلة"
              head={[
                'رقم الطلب',
                'العميل والموقع',
                'المنتجات',
                'طريقة الدفع والقيمة',
                'الحالة التشغيلية',
                'وقت الإنشاء',
                'إجراء',
              ]}
            >
              {filteredOrders.map((o) => (
                <tr key={o.id} className="hover:bg-bw-sunken/50 transition-colors">
                  <td>{orderLink(o.id, o.orderNumber)}</td>
                  <td>
                    <div className="space-y-0.5">
                      <p className="font-semibold text-bw-ink text-bw-small">{o.customerName}</p>
                      <p className="text-[11px] text-bw-ink-subtle">
                        {o.governorate ?? 'غير محدد'} {o.area ? `· ${o.area}` : ''}
                      </p>
                    </div>
                  </td>
                  <td>
                    <span className="text-bw-small text-bw-ink">
                      <Code>{o.itemCount}</Code> أصناف
                    </span>
                  </td>
                  <td>
                    <div className="space-y-0.5">
                      <p className="font-semibold text-bw-ink text-bw-small">
                        <Egp value={o.totalAmount} />
                      </p>
                      <span className="inline-block rounded bg-bw-sunken px-1.5 py-0.2 text-[10px] text-bw-ink-subtle border border-bw-line">
                        {o.paymentMethod === 'cod' ? 'دفع عند الاستلام' : 'بطاقة إلكترونية'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <StatusLabel
                      tone={
                        o.status === 'delivered'
                          ? 'ok'
                          : o.status === 'cancelled' || o.status === 'returned'
                          ? 'danger'
                          : o.status === 'placed'
                          ? 'warn'
                          : 'info'
                      }
                    >
                      {ORDER_STATUS[o.status] ?? o.status}
                    </StatusLabel>
                  </td>
                  <td>
                    <span className="text-bw-small text-bw-ink-soft">
                      {formatDateTime(o.createdAt)}
                    </span>
                  </td>
                  <td>
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="inline-flex h-8 items-center gap-1 rounded border border-bw-line-field bg-bw-surface px-2.5 text-xs font-semibold hover:bg-bw-sunken transition-colors"
                    >
                      عرض
                    </Link>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </Section>

      {/* ── Owner Protected Financial Overview (Server-Side Protected) ── */}
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
                <span className="text-bw-small text-bw-ink-soft">قيمة مبيعات طلبات اليوم</span>
                <p className="text-bw-heading font-semibold text-bw-ink">
                  {kpis.data ? (
                    kpis.data.revenueToday !== null ? (
                      <Egp value={kpis.data.revenueToday} />
                    ) : (
                      <span className="text-bw-small text-bw-ink-soft">محجوبة من الخادم (مخصصة للمالك فقط)</span>
                    )
                  ) : (
                    <Skeleton className="h-6 w-24" />
                  )}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-bw-small text-bw-ink-soft">متوسط قيمة الطلب (AOV)</span>
                <p className="text-bw-heading font-semibold text-bw-ink">
                  {kpis.data ? (
                    kpis.data.averageOrderValue !== null ? (
                      <Egp value={kpis.data.averageOrderValue} />
                    ) : (
                      <span className="text-bw-small text-bw-ink-soft">محجوبة من الخادم (مخصصة للمالك فقط)</span>
                    )
                  ) : (
                    <Skeleton className="h-6 w-24" />
                  )}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-bw-small text-bw-ink-soft">إجمالي المبيعات المؤكدة بالنظام</span>
                <p className="text-bw-heading font-semibold text-bw-ink">
                  {kpis.data ? (
                    kpis.data.totalRevenue !== null && kpis.data.totalRevenue !== undefined ? (
                      <Egp value={kpis.data.totalRevenue} />
                    ) : (
                      <span className="text-bw-small text-bw-ink-soft">محجوبة من الخادم (مخصصة للمالك فقط)</span>
                    )
                  ) : (
                    <Skeleton className="h-6 w-24" />
                  )}
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

      {/* ── Action Inspection Drawer Dialog ──────────────────────────── */}
      <Dialog
        dialogRef={drawer.ref}
        title={selectedException?.title ?? 'تفاصيل التدخل المطلوب'}
        variant="drawer"
        onClose={() => setSelectedException(null)}
        footer={
          selectedException ? (
            <div className="flex w-full items-center justify-between gap-3">
              <Button variant="ghost" onClick={drawer.close}>
                إغلاق
              </Button>
              <Link
                href={selectedException.destinationHref}
                className="inline-flex h-bw-control items-center gap-1.5 rounded-bw-field bg-bw-action px-4 font-semibold text-bw-on-action hover:bg-bw-action-hover transition-colors"
                onClick={drawer.close}
              >
                <span>{selectedException.destinationLabel}</span>
                <ChevronLeft className="size-4" aria-hidden />
              </Link>
            </div>
          ) : undefined
        }
      >
        {selectedException ? (
          <div className="space-y-5 text-bw-body">
            <div className="flex items-center justify-between border-b border-bw-line pb-3">
              <span className="text-bw-small text-bw-ink-soft">تصنيف الإجراء:</span>
              <StatusLabel tone={selectedException.tone}>{selectedException.categoryLabel}</StatusLabel>
            </div>

            <div className="space-y-2">
              <h3 className="text-bw-small font-semibold uppercase tracking-wider text-bw-ink-subtle">
                البيانات التشغيلية
              </h3>
              <dl className="space-y-2 rounded-bw-card border border-bw-line bg-bw-sunken p-3 text-bw-small">
                {selectedException.facts.map(([k, v], idx) => (
                  <div key={idx} className="flex items-center justify-between border-b border-bw-line/40 pb-1.5 last:border-b-0 last:pb-0">
                    <dt className="text-bw-ink-soft">{k}:</dt>
                    <dd className="font-semibold text-bw-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="space-y-2">
              <h3 className="text-bw-small font-semibold uppercase tracking-wider text-bw-ink-subtle">
                التدخل الموصى به
              </h3>
              <div className="rounded-bw-card border border-bw-action/30 bg-bw-action-soft/20 p-3 text-bw-small text-bw-ink leading-relaxed">
                {selectedException.nextStep}
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
    </Page>
  )
}
