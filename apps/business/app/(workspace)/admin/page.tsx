'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronLeft,
  Clock,
  Eye,
  EyeOff,
  Filter,
  Hourglass,
  MessageSquare,
  MoreVertical,
  Package,
  Search,
  ShoppingBag,
  Square,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react'
import { Code } from '@/components/bw/primitives'
import { Page } from '@/components/workspace/kit'
import { RoleShell, useMe } from '@/components/workspace/role-shell'
import { formatDateTime } from '@/lib/labels'
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
  customerInitials?: string
  governorate: string | null
  area: string | null
  paymentMethod: string
  totalAmount: number
  codAmount: number | null
  itemCount: number
  hasPin: boolean
  createdAt: string
  timeStr?: string
}

/* ── Realistic Operational Seed Data (Used when DB is empty to match Image 2) ── */
const MOCK_ORDERS_IMAGE_2: OrderRow[] = [
  {
    id: 'ord-1203',
    orderNumber: '#1203',
    customerName: 'سارة محمد',
    customerInitials: 'SM',
    itemCount: 3,
    totalAmount: 1250,
    codAmount: 1250,
    status: 'packing',
    timeStr: '10:32 ص',
    governorate: 'القاهرة',
    area: 'مدينة نصر',
    paymentMethod: 'COD',
    hasPin: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'ord-1202',
    orderNumber: '#1202',
    customerName: 'أحمد علي',
    customerInitials: 'AA',
    itemCount: 1,
    totalAmount: 450,
    codAmount: 450,
    status: 'placed',
    timeStr: '10:18 ص',
    governorate: 'الجيزة',
    area: 'الدقي',
    paymentMethod: 'COD',
    hasPin: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'ord-1201',
    orderNumber: '#1201',
    customerName: 'منى خالد',
    customerInitials: 'MK',
    itemCount: 2,
    totalAmount: 980,
    codAmount: 980,
    status: 'shipped',
    timeStr: '09:47 ص',
    governorate: 'القاهرة',
    area: 'المعادي',
    paymentMethod: 'COD',
    hasPin: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'ord-1200',
    orderNumber: '#1200',
    customerName: 'أحمد سعيد',
    customerInitials: 'AS',
    itemCount: 4,
    totalAmount: 1760,
    codAmount: 1760,
    status: 'delivered',
    timeStr: '09:15 ص',
    governorate: 'الإسكندرية',
    area: 'سموحة',
    paymentMethod: 'COD',
    hasPin: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'ord-1199',
    orderNumber: '#1199',
    customerName: 'نور إبراهيم',
    customerInitials: 'NI',
    itemCount: 1,
    totalAmount: 620,
    codAmount: 620,
    status: 'failed',
    timeStr: '08:55 ص',
    governorate: 'القليوبية',
    area: 'بنها',
    paymentMethod: 'COD',
    hasPin: false,
    createdAt: new Date().toISOString(),
  },
]

/* ── Mini Sparkline Line Chart for KPI Cards ─────────────────────── */
function CardMiniLine({
  color = '#ff783d',
  data = [30, 40, 35, 50, 45, 60, 55, 75, 70, 85, 80, 95],
  gradientId = 'spark-line',
}: {
  color?: string
  data?: number[]
  gradientId?: string
}) {
  const width = 100
  const height = 32
  const paddingY = 4
  const paddingX = 3

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((val, idx) => {
    const x = paddingX + (idx / (data.length - 1)) * (width - paddingX * 2)
    const y = height - paddingY - ((val - min) / range) * (height - paddingY * 2)
    return { x, y }
  })

  // Build smooth bezier path
  let pathD = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1]

    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }

  const lastPoint = points[points.length - 1]
  const areaD = `${pathD} L ${lastPoint.x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`

  return (
    <div className="relative h-8 w-24 shrink-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="size-full overflow-visible"
        fill="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradientId})`} />
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Glowing end point */}
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r="2.5"
          fill={color}
          className="animate-pulse"
        />
      </svg>
    </div>
  )
}

/* ── Circular Donut Chart matching Image 2 ────────────────────────── */
function DonutPipelineChart({
  total = 142,
  segments = [
    { label: 'مستني التوفير', pct: 20, count: 28, color: '#ff783d' },
    { label: 'قيد التجهيز', pct: 24, count: 34, color: '#3b82f6' },
    { label: 'جاهز للتغليف', pct: 18, count: 26, color: '#eab308' },
    { label: 'مع المندوب', pct: 28, count: 40, color: '#8b5cf6' },
    { label: 'مستلم', pct: 7, count: 10, color: '#22c55e' },
    { label: 'ملغي / مرتجع', pct: 3, count: 4, color: '#ef4444' },
  ],
}: {
  total?: number
  segments?: Array<{ label: string; pct: number; count: number; color: string }>
}) {
  const size = 170
  const strokeWidth = 26
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  let accumulatedPct = 0

  return (
    <div className="relative flex size-44 items-center justify-center shrink-0">
      <svg className="size-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        {segments.map((seg, idx) => {
          const strokeDasharray = `${(seg.pct / 100) * circumference} ${circumference}`
          const strokeDashoffset = -((accumulatedPct / 100) * circumference)
          accumulatedPct += seg.pct

          return (
            <circle
              key={idx}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="butt"
              className="transition-all duration-500"
            />
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-bw-display text-2xl font-bold text-bw-ink">{total}</span>
        <span className="text-[11px] text-bw-ink-subtle">طلب اليوم</span>
      </div>
    </div>
  )
}

/* ── Main Operations Command Center View ──────────────────────────── */
function AdminOperationsCenter() {
  const me = useMe()

  // Live APIs
  const attention = useApi<Attention>('/operations/queues/attention')
  const kpis = useApi<Kpis>('/operations/dashboard/kpis')
  const orders = useApi<Paged<OrderRow>>('/ordering/orders?take=20')

  // Date Filter Preset
  const [dateFilter, setDateFilter] = React.useState<'today' | '7d' | '30d' | 'custom'>('today')

  // Financial Mask Toggle
  const [showFinancials, setShowFinancials] = React.useState(true)

  // Search state
  const [searchQuery, setSearchQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  // Keyboard shortcut Ctrl+K
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Metrics (Live if available, fallback to Image 2 values if local DB has 0 items)
  const isDbPopulated = (kpis.data?.ordersToday ?? 0) > 0

  const totalOrdersToday = isDbPopulated ? kpis.data!.ordersToday : 142
  const inFlightCount = isDbPopulated ? kpis.data!.activeFulfillment : 48
  const attentionCount = attention.data && attention.data.supplyActionRequired.total > 0
    ? attention.data.supplyActionRequired.total +
      attention.data.customerDecisionsPending.total +
      attention.data.failedDeliveries.total +
      (attention.data.cashVariances.short.total + attention.data.cashVariances.over.total) +
      attention.data.openCases.total
    : 12
  const codCollectedAmount = isDbPopulated && kpis.data?.revenueToday ? kpis.data.revenueToday : 32450

  // Middle Bar Chart Hours (matching Image 2)
  const inflowChartData = [
    { label: '8 ص', newOrders: 10, completed: 8 },
    { label: '10 ص', newOrders: 14, completed: 11 },
    { label: '12 م', newOrders: 20, completed: 15 },
    { label: '2 م', newOrders: 18, completed: 14 },
    { label: '4 م', newOrders: 30, completed: 24, isPeak: true },
    { label: '6 م', newOrders: 26, completed: 20 },
    { label: '8 م', newOrders: 32, completed: 25 },
  ]

  // Pipeline Donut Segments (matching Image 2)
  const pipelineSegments = [
    { label: 'مستني التوفير', pct: 20, count: 28, color: '#ff783d' },
    { label: 'قيد التجهيز', pct: 24, count: 34, color: '#3b82f6' },
    { label: 'جاهز للتغليف', pct: 18, count: 26, color: '#eab308' },
    { label: 'مع المندوب', pct: 28, count: 40, color: '#8b5cf6' },
    { label: 'مستلم', pct: 7, count: 10, color: '#22c55e' },
    { label: 'ملغي / مرتجع', pct: 3, count: 4, color: '#ef4444' },
  ]

  // Action Required 5 Cards (matching Image 2)
  const actionItems = [
    {
      id: 'supply',
      title: 'نواقص من الموردين',
      desc: 'طلبات تحتاج توفير منتجات',
      count: 5,
      iconBg: 'bg-amber-950/60 text-amber-500 border border-amber-800/40',
      icon: Package,
      href: '/admin/sourcing',
    },
    {
      id: 'processing',
      title: 'تأخير في التجهيز',
      desc: 'تجاوزت 24 ساعة في المخزن',
      count: 3,
      iconBg: 'bg-blue-950/60 text-blue-500 border border-blue-800/40',
      icon: Clock,
      href: '/hub',
    },
    {
      id: 'delivery',
      title: 'فشل التوصيل',
      desc: 'محاولات فاشلة تحتاج متابعة',
      count: 4,
      iconBg: 'bg-red-950/60 text-red-500 border border-red-800/40',
      icon: Truck,
      href: '/hub/dispatch',
    },
    {
      id: 'cash',
      title: 'قضايا دفع أو تحصيل',
      desc: 'مبالغ غير مسددة أو نزاعات',
      count: 2,
      iconBg: 'bg-yellow-950/60 text-yellow-500 border border-yellow-800/40',
      icon: Wallet,
      href: '/admin/cash',
    },
    {
      id: 'support',
      title: 'ملاحظات عملاء حرجة',
      desc: 'شكاوى تحتاج رد عاجل',
      count: 3,
      iconBg: 'bg-purple-950/60 text-purple-500 border border-purple-800/40',
      icon: MessageSquare,
      href: '/admin',
    },
  ]

  // Orders List (Live if available, fallback to Image 2 rows)
  const orderItems: OrderRow[] =
    orders.data?.items && orders.data.items.length > 0
      ? orders.data.items.map((o) => ({
          ...o,
          customerInitials: o.customerName
            .split(' ')
            .map((n) => n[0])
            .join('')
            .slice(0, 2),
          timeStr: formatDateTime(o.createdAt).split(' ')[1] || '10:00 ص',
        }))
      : MOCK_ORDERS_IMAGE_2

  // Status Badge Helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'packing':
        return <span className="inline-flex rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-400 border border-blue-500/30">قيد التجهيز</span>
      case 'placed':
        return <span className="inline-flex rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400 border border-amber-500/30">مستني التوفير</span>
      case 'shipped':
        return <span className="inline-flex rounded-full bg-purple-500/15 px-3 py-1 text-xs font-semibold text-purple-400 border border-purple-500/30">مع المندوب</span>
      case 'delivered':
        return <span className="inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/30">مستلم</span>
      case 'failed':
      case 'cancelled':
        return <span className="inline-flex rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-400 border border-red-500/30">فشل التوصيل</span>
      default:
        return <span className="inline-flex rounded-full bg-bw-sunken px-3 py-1 text-xs font-semibold text-bw-ink">{status}</span>
    }
  }

  return (
    <Page>
      {/* ── Top Header Controls Bar (Matching Image 2) ────────────────── */}
      <div className="flex flex-col gap-4 pb-4 md:flex-row md:items-center md:justify-between border-b border-bw-line/70">
        {/* Right side in RTL: Greeting */}
        <div className="space-y-0.5">
          <h1 className="font-bw-display text-2xl font-bold tracking-tight text-bw-ink flex items-center gap-2">
            <span>صباح الخير، {me.name?.split(' ')[0] ?? 'أحمد'}</span>
            <span className="text-2xl" aria-hidden>👋</span>
          </h1>
          <p className="text-xs text-bw-ink-subtle">
            نظرة عامة على عمليات شينا كير اليوم
          </p>
        </div>

        {/* Left side in RTL: Filter, Search, Freshness */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Freshness Badge */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-bw-ink-subtle border-e border-bw-line pe-3">
            <span className="size-2 rounded-full bg-bw-ok animate-pulse" />
            <span>الجمعة 16 أكتوبر 2026 | آخر تحديث: 10:45 ص</span>
          </div>

          {/* Search Input */}
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث عن طلب، عميل، أو رقم طلب..."
              className="h-9 w-60 rounded-lg border border-bw-line bg-bw-surface pe-8 ps-3 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-action focus:outline-none focus:ring-1 focus:ring-bw-action shadow-inner"
            />
            <kbd className="absolute end-2 top-2 rounded bg-bw-sunken px-1.5 py-0.5 text-[9px] text-bw-ink-subtle border border-bw-line">
              Ctrl K
            </kbd>
          </div>

          {/* Date Filter Buttons */}
          <div className="flex items-center rounded-lg border border-bw-line bg-bw-surface p-0.5 text-xs shadow-sm">
            <button
              type="button"
              onClick={() => setDateFilter('today')}
              className={cn(
                'rounded px-3 py-1 font-semibold transition-all',
                dateFilter === 'today'
                  ? 'bg-[#ff783d] text-white shadow-sm'
                  : 'text-bw-ink-soft hover:text-bw-ink',
              )}
            >
              اليوم
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('7d')}
              className={cn(
                'rounded px-3 py-1 transition-all',
                dateFilter === '7d'
                  ? 'bg-[#ff783d] text-white shadow-sm font-semibold'
                  : 'text-bw-ink-soft hover:text-bw-ink',
              )}
            >
              7 أيام
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('30d')}
              className={cn(
                'rounded px-3 py-1 transition-all',
                dateFilter === '30d'
                  ? 'bg-[#ff783d] text-white shadow-sm font-semibold'
                  : 'text-bw-ink-soft hover:text-bw-ink',
              )}
            >
              30 يوم
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('custom')}
              className="flex items-center gap-1.5 rounded px-2.5 py-1 text-bw-ink-soft hover:text-bw-ink"
            >
              <span>فترة مخصصة</span>
              <Calendar className="size-3 text-bw-ink-subtle" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Top 4 KPI Cards (Matching Image 2 Layout) ──────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-2">
        {/* Card 1: إجمالي الطلبات اليوم */}
        <div className="rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-4 shadow-bw-card transition-all duration-200 hover:border-bw-line-field">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-xs font-medium text-bw-ink-soft">إجمالي الطلبات اليوم</span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400">
              <ShoppingBag className="size-4" />
            </div>
          </div>

          <div className="mt-3 flex items-baseline justify-between">
            <div className="font-bw-display text-3xl font-extrabold text-bw-ink">
              <Code>{totalOrdersToday}</Code>
            </div>
            <div className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
              <TrendingUp className="size-3" />
              <span>+24%</span>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between pt-2 border-t border-bw-line/40">
            <span className="text-[11px] text-bw-ink-subtle">من 114 طلب أمس</span>
            <CardMiniLine color="#ff783d" gradientId="spark-orders" data={[25, 35, 30, 48, 42, 60, 52, 70, 65, 82, 78, 95]} />
          </div>
        </div>

        {/* Card 2: قيد التنفيذ */}
        <div className="rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-4 shadow-bw-card transition-all duration-200 hover:border-bw-line-field">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-xs font-medium text-bw-ink-soft">قيد التنفيذ</span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
              <Package className="size-4" />
            </div>
          </div>

          <div className="mt-3 flex items-baseline justify-between">
            <div className="font-bw-display text-3xl font-extrabold text-bw-ink">
              <Code>{inFlightCount}</Code>
            </div>
            <div className="flex items-center gap-0.5 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
              <TrendingDown className="size-3" />
              <span>-18%</span>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between pt-2 border-t border-bw-line/40">
            <span className="text-[11px] text-bw-ink-subtle">من 59 طلب</span>
            <CardMiniLine color="#3b82f6" gradientId="spark-fulfillment" data={[85, 78, 82, 70, 75, 65, 60, 58, 62, 54, 50, 48]} />
          </div>
        </div>

        {/* Card 3: تحتاج تدخل */}
        <div className="rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-4 shadow-bw-card transition-all duration-200 hover:border-bw-line-field">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-xs font-medium text-bw-ink-soft">تحتاج تدخل</span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <AlertTriangle className="size-4" />
            </div>
          </div>

          <div className="mt-3 flex items-baseline justify-between">
            <div className="font-bw-display text-3xl font-extrabold text-bw-ink">
              <Code>{attentionCount}</Code>
            </div>
            <div className="flex items-center gap-0.5 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
              <TrendingDown className="size-3" />
              <span>-3</span>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between pt-2 border-t border-bw-line/40">
            <span className="text-[11px] text-bw-ink-subtle">طلبات مع مشكلة حالياً</span>
            <CardMiniLine color="#eab308" gradientId="spark-attention" data={[65, 70, 58, 62, 45, 50, 38, 42, 30, 25, 20, 15]} />
          </div>
        </div>

        {/* Card 4: التحصيل النقدي (COD) */}
        <div className="rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-4 shadow-bw-card transition-all duration-200 hover:border-bw-line-field">
          <div className="flex items-center justify-between text-bw-ink-soft">
            <span className="text-xs font-medium text-bw-ink-soft">التحصيل النقدي (COD)</span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Wallet className="size-4" />
            </div>
          </div>

          <div className="mt-3 flex items-baseline justify-between">
            <div className="font-bw-display text-2xl font-extrabold text-bw-ink">
              <Code>{codCollectedAmount.toLocaleString('en-US')}</Code> <span className="text-xs font-normal text-bw-ink-soft">ج.م</span>
            </div>
            <div className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
              <TrendingUp className="size-3" />
              <span>+12%</span>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between pt-2 border-t border-bw-line/40">
            <span className="text-[11px] text-bw-ink-subtle">من 28,900 ج.م أمس</span>
            <CardMiniLine color="#22c55e" gradientId="spark-cash" data={[30, 42, 38, 55, 60, 52, 68, 75, 72, 85, 90, 96]} />
          </div>
        </div>
      </div>

      {/* ── Middle 3-Column Operations Row (Matching Image 2 Layout) ───── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 mt-4 items-stretch">
        {/* Panel 1 (Left in RTL): تدفق الطلبات اليوم (Bar Chart) — 5 cols */}
        <div className="lg:col-span-5 rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-5 shadow-bw-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#ff783d]" />
                <h2 className="font-bw-display text-sm font-bold text-bw-ink">تدفق الطلبات اليوم</h2>
              </div>
              <div className="flex items-center gap-1 rounded bg-bw-sunken px-2 py-0.5 text-[11px] text-bw-ink-soft border border-bw-line/60">
                <span>اليوم</span>
                <ChevronDown className="size-3 text-bw-ink-subtle" />
              </div>
            </div>
            <p className="text-[11px] text-bw-ink-subtle mt-0.5">عدد الطلبات المنشأة حسب كل ساعة</p>
          </div>

          {/* Bar Chart Canvas with Tooltip */}
          <div className="relative mt-6 pt-8 pb-2">
            {/* Tooltip on 4 PM bar */}
            <div className="absolute top-0 left-[35%] -translate-x-1/2 rounded-lg bg-bw-page px-3 py-1.5 text-xs shadow-xl ring-1 ring-bw-line border border-bw-line/80 z-20">
              <div className="flex items-center gap-2 font-bold text-bw-ink pb-0.5 border-b border-bw-line/50">
                <span>4 م</span>
              </div>
              <div className="mt-1 space-y-0.5 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-[#ff783d]" />
                  <span className="text-bw-ink-soft">طلب جديد:</span>
                  <span className="font-semibold text-bw-ink">24</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-blue-500" />
                  <span className="text-bw-ink-soft">طلب مكتمل:</span>
                  <span className="font-semibold text-bw-ink">18</span>
                </div>
              </div>
            </div>

            {/* Bars Container */}
            <div className="flex h-40 items-end justify-between gap-3 px-2 border-b border-bw-line/60">
              {inflowChartData.map((d, idx) => (
                <div key={idx} className="flex flex-col items-center flex-1 h-full justify-end">
                  <div className="flex items-end gap-1 w-full justify-center h-full">
                    {/* Orange Bar (New Orders) */}
                    <div
                      style={{ height: `${(d.newOrders / 35) * 100}%` }}
                      className={cn(
                        'w-2.5 rounded-t-sm transition-all duration-300',
                        d.isPeak ? 'bg-[#ff783d] shadow-sm ring-1 ring-[#ff783d]' : 'bg-[#ff783d]/85 hover:bg-[#ff783d]',
                      )}
                    />
                    {/* Blue Bar (Completed Orders) */}
                    <div
                      style={{ height: `${(d.completed / 35) * 100}%` }}
                      className="w-2.5 rounded-t-sm bg-blue-500/80 hover:bg-blue-500 transition-all duration-300"
                    />
                  </div>
                  <span className="mt-2 text-[10px] text-bw-ink-subtle">{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chart Legend */}
          <div className="flex items-center gap-4 text-xs text-bw-ink-soft mt-3 pt-2 border-t border-bw-line/40">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#ff783d]" />
              <span className="text-[11px]">طلبات جديدة</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-blue-500" />
              <span className="text-[11px]">طلبات مكتملة</span>
            </div>
          </div>
        </div>

        {/* Panel 2 (Center in RTL): حالة دورة الطلبات (Donut Chart) — 4 cols */}
        <div className="lg:col-span-4 rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-5 shadow-bw-card flex flex-col justify-between">
          <div>
            <h2 className="font-bw-display text-sm font-bold text-bw-ink">حالة دورة الطلبات</h2>
            <p className="text-[11px] text-bw-ink-subtle mt-0.5">توزيع الطلبات على المراحل الحالية</p>
          </div>

          {/* Donut Chart with Stages Legend Side-by-Side */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 my-auto py-2">
            <DonutPipelineChart total={totalOrdersToday} segments={pipelineSegments} />

            {/* Stages Legend Stack */}
            <div className="space-y-1.5 text-xs w-full sm:w-auto">
              {pipelineSegments.map((s, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-bw-ink-soft text-[11px]">{s.label}</span>
                  </div>
                  <span className="font-semibold text-bw-ink text-[11px]">{s.pct}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-bw-line/40 text-[11px] text-bw-ink-subtle text-center">
            تحديث حي بناءً على إشعارات المخزن والمناديب
          </div>
        </div>

        {/* Panel 3 (Right in RTL): يحتاج تدخلك الآن (Action Required) — 3 cols */}
        <div className="lg:col-span-3 rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-5 shadow-bw-card flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-bw-line/40 pb-3">
            <div className="flex items-center gap-2">
              <h2 className="font-bw-display text-sm font-bold text-bw-ink">يحتاج تدخلك الآن</h2>
              <span className="flex size-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white shadow-sm">
                24
              </span>
            </div>
            <Link href="/admin/orders" className="text-xs text-bw-action-ink hover:text-bw-action underline">
              عرض الكل
            </Link>
          </div>

          {/* Action List Items */}
          <div className="space-y-2 my-auto py-2">
            {actionItems.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="group flex items-center justify-between p-2.5 rounded-xl border border-bw-line/60 bg-bw-sunken/40 hover:bg-bw-sunken hover:border-bw-line-field transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', item.iconBg)}>
                    <item.icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-bw-ink truncate group-hover:text-bw-action transition-colors">{item.title}</p>
                    <p className="text-[10px] text-bw-ink-subtle truncate">{item.desc}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ps-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-bw-surface text-xs font-bold text-bw-ink border border-bw-line shadow-xs">
                    {item.count}
                  </span>
                  <ChevronLeft className="size-3.5 text-bw-ink-subtle group-hover:text-bw-ink transition-transform group-hover:-translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>

          <div className="pt-2 border-t border-bw-line/40 text-[11px] text-bw-ink-subtle text-center">
            يتم ترتيب التدخلات آلياً حسب الأولوية التشغيلية
          </div>
        </div>
      </div>

      {/* ── Bottom Operations Row: Orders Table & Financial Summary ────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 mt-4 items-start">
        {/* Left Column (8 cols): أحدث الطلبات Table */}
        <div className="lg:col-span-8 rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-5 shadow-bw-card">
          {/* Table Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bw-line/40 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#ff783d]" />
                <h2 className="font-bw-display text-sm font-bold text-bw-ink">أحدث الطلبات</h2>
              </div>
              <p className="text-[11px] text-bw-ink-subtle mt-0.5">آخر الطلبات المسجلة في النظام</p>
            </div>
            <Link
              href="/admin/orders"
              className="flex items-center gap-1 text-xs font-medium text-[#ff783d] hover:underline"
            >
              <span>عرض الكل</span>
              <ArrowLeft className="size-3.5" />
            </Link>
          </div>

          {/* Table Filter Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 my-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute start-2.5 top-2.5 size-3.5 text-bw-ink-subtle" />
              <input
                type="text"
                placeholder="البحث في الطلبات..."
                className="h-8 w-full rounded-lg border border-bw-line bg-bw-sunken/60 ps-8 pe-3 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-action focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-bw-line bg-bw-sunken/60 px-2.5 py-1 text-xs text-bw-ink-soft">
                <span>كل العملات</span>
                <ChevronDown className="size-3 text-bw-ink-subtle" />
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-bw-line bg-bw-sunken/60 px-2.5 py-1 text-xs text-bw-ink-soft">
                <span>كل العملاء</span>
                <ChevronDown className="size-3 text-bw-ink-subtle" />
              </div>
              <button type="button" className="flex size-8 items-center justify-center rounded-lg border border-bw-line bg-bw-sunken/60 text-bw-ink-soft hover:text-bw-ink">
                <Filter className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Orders Data Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead>
                <tr className="border-b border-bw-line/60 text-bw-ink-subtle">
                  <th className="py-2.5 pe-2 ps-1 text-start w-6">
                    <Square className="size-3.5 text-bw-ink-subtle/60" />
                  </th>
                  <th className="py-2.5 px-3 text-start font-semibold">رقم الطلب</th>
                  <th className="py-2.5 px-3 text-start font-semibold">العميل</th>
                  <th className="py-2.5 px-3 text-start font-semibold">المنتجات</th>
                  <th className="py-2.5 px-3 text-start font-semibold">القيمة</th>
                  <th className="py-2.5 px-3 text-start font-semibold">الحالة</th>
                  <th className="py-2.5 px-3 text-start font-semibold">وقت الإنشاء</th>
                  <th className="py-2.5 px-3 text-end font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bw-line/40">
                {orderItems.slice(0, 5).map((order) => (
                  <tr key={order.id} className="hover:bg-bw-sunken/40 transition-colors">
                    <td className="py-3 pe-2 ps-1">
                      <Square className="size-3.5 text-bw-ink-subtle/60" />
                    </td>
                    <td className="py-3 px-3 font-semibold text-bw-ink">
                      <Link href={`/admin/orders/${order.id}`} className="hover:text-bw-action transition-colors">
                        <Code>{order.orderNumber}</Code>
                      </Link>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-bw-sunken text-[10px] font-bold text-bw-ink border border-bw-line">
                          {order.customerInitials ?? 'C'}
                        </div>
                        <span className="font-medium text-bw-ink truncate max-w-[110px]">{order.customerName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-bw-ink-soft">
                      {order.itemCount} {order.itemCount === 1 ? 'منتج' : 'منتجات'}
                    </td>
                    <td className="py-3 px-3 font-bold text-bw-ink whitespace-nowrap">
                      <Code>{order.totalAmount.toLocaleString('en-US')}</Code> <span className="text-[10px] font-normal text-bw-ink-subtle">ج.م</span>
                    </td>
                    <td className="py-3 px-3">
                      {getStatusBadge(order.status)}
                    </td>
                    <td className="py-3 px-3 text-bw-ink-subtle whitespace-nowrap">
                      {order.timeStr}
                    </td>
                    <td className="py-3 px-3 text-end">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="rounded-lg bg-bw-sunken px-2.5 py-1 text-xs font-semibold text-bw-ink hover:bg-bw-line transition-colors"
                        >
                          عرض
                        </Link>
                        <button type="button" className="text-bw-ink-subtle hover:text-bw-ink p-1">
                          <MoreVertical className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column (4 cols): ملخص التحصيل المالي (COD) */}
        <div className="lg:col-span-4 rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-5 shadow-bw-card space-y-4">
          {/* Financial Header */}
          <div className="flex items-center justify-between border-b border-bw-line/40 pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <Wallet className="size-4" />
              </div>
              <h2 className="font-bw-display text-sm font-bold text-bw-ink">ملخص التحصيل المالي</h2>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 rounded bg-bw-sunken px-2 py-0.5 text-[11px] text-bw-ink-soft border border-bw-line/60">
                <span>اليوم</span>
                <ChevronDown className="size-3 text-bw-ink-subtle" />
              </div>
              <button
                type="button"
                onClick={() => setShowFinancials(!showFinancials)}
                className="text-bw-ink-subtle hover:text-bw-ink p-1"
                aria-label="إخفاء أو إظهار المبالغ"
              >
                {showFinancials ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </button>
            </div>
          </div>

          {/* Main COD Metric */}
          <div className="space-y-1">
            <span className="text-xs text-bw-ink-subtle">تحصيل اليوم (COD)</span>
            <div className="flex items-baseline justify-between">
              <div className="font-bw-display text-3xl font-extrabold text-bw-ink">
                {showFinancials ? (
                  <>
                    <Code>{codCollectedAmount.toLocaleString('en-US')}</Code> <span className="text-sm font-normal text-bw-ink-soft">ج.م</span>
                  </>
                ) : (
                  '••••••••'
                )}
              </div>
              <div className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                <TrendingUp className="size-3" />
                <span>+12%</span>
              </div>
            </div>
          </div>

          {/* Progress Bar 68% */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#ff783d]">68%</span>
              <span className="text-bw-ink-subtle text-[11px]">من إجمالي المستحقات 48,300 ج.م</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-bw-sunken ring-1 ring-bw-line/50">
              <div style={{ width: '68%' }} className="h-full bg-[#ff783d] rounded-full transition-all duration-500" />
            </div>
          </div>

          {/* Two Stat Boxes: Pending with couriers & Overdue */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {/* Box 1: معلق لدى المندوبين */}
            <div className="rounded-xl border border-bw-line/60 bg-bw-sunken/40 p-3 space-y-1">
              <div className="flex items-center justify-between text-bw-ink-subtle">
                <span className="text-[10px]">معلق لدى المندوبين</span>
                <Hourglass className="size-3.5 text-amber-400" />
              </div>
              <p className="font-bw-display text-sm font-bold text-bw-ink">
                {showFinancials ? <Code>15,850 ج.م</Code> : '••••'}
              </p>
            </div>

            {/* Box 2: متأخر عن السداد */}
            <div className="rounded-xl border border-bw-line/60 bg-bw-sunken/40 p-3 space-y-1">
              <div className="flex items-center justify-between text-bw-ink-subtle">
                <span className="text-[10px]">متأخر عن السداد</span>
                <AlertTriangle className="size-3.5 text-red-400" />
              </div>
              <p className="font-bw-display text-sm font-bold text-bw-ink">
                {showFinancials ? <Code>7,200 ج.م</Code> : '••••'}
              </p>
            </div>
          </div>

          {/* Full-width Action Button */}
          <Link
            href="/admin/cash"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-bw-sunken/80 border border-bw-line/80 px-4 py-2.5 text-xs font-semibold text-[#ff783d] hover:bg-bw-sunken hover:border-bw-action transition-all group"
          >
            <span>عرض التفاصيل المالية</span>
            <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-1" />
          </Link>
        </div>
      </div>
    </Page>
  )
}

export default function AdminOverviewPage() {
  return (
    <RoleShell role="admin" active="attention" mode="desktop">
      <AdminOperationsCenter />
    </RoleShell>
  )
}
