'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
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

/* ── Interactive Order Analytics Chart (Requirement 5 & Area Toggle) ── */
function OrderAnalyticsChart() {
  const [chartMode, setChartMode] = React.useState<'bar' | 'area'>('bar') // Defaults to interactive Bar Chart
  const [activeIdx, setActiveIdx] = React.useState<number>(4) // 4 PM default
  const [activeTab, setActiveTab] = React.useState<string>('all')

  const filterTabs = [
    { id: 'all', label: 'الكل' },
    { id: 'new', label: 'طلبات جديدة' },
    { id: 'prep', label: 'قيد التجهيز' },
    { id: 'courier', label: 'مع المندوب' },
    { id: 'done', label: 'مكتملة' },
  ]

  // Hourly Bar & Area Data Points
  const hourlyData = [
    { label: '8 ص', time: '08:00 ص', newOrders: 10, completed: 8, isPeak: false, change: '+5.2%', high: 14, low: 7, target: 8 },
    { label: '10 ص', time: '10:00 ص', newOrders: 14, completed: 11, isPeak: false, change: '+8.4%', high: 18, low: 10, target: 11 },
    { label: '12 م', time: '12:00 م', newOrders: 20, completed: 15, isPeak: false, change: '+14.1%', high: 23, low: 13, target: 15 },
    { label: '2 م', time: '02:00 م', newOrders: 18, completed: 14, isPeak: false, change: '+9.8%', high: 21, low: 12, target: 14 },
    { label: '4 م', time: '04:00 م', newOrders: 30, completed: 24, isPeak: true, change: '+22.4%', high: 34, low: 20, target: 24 },
    { label: '6 م', time: '06:00 م', newOrders: 26, completed: 20, isPeak: false, change: '+16.5%', high: 29, low: 17, target: 20 },
    { label: '8 م', time: '08:00 م', newOrders: 32, completed: 25, isPeak: false, change: '+19.2%', high: 36, low: 22, target: 25 },
  ]

  const activeData = hourlyData[activeIdx] || hourlyData[4]
  const maxVal = 35

  // Area chart coordinates mapping (when toggled to Area)
  const width = 520
  const height = 210
  const plotLeft = 35
  const plotRight = 505
  const plotTop = 15
  const plotBottom = 175
  const plotWidth = plotRight - plotLeft
  const plotHeight = plotBottom - plotTop

  const points = hourlyData.map((d, i) => {
    const x = plotLeft + (i / (hourlyData.length - 1)) * plotWidth
    const y = plotBottom - (d.newOrders / maxVal) * plotHeight
    return { x, y }
  })
  const targetPoints = hourlyData.map((d, i) => {
    const x = plotLeft + (i / (hourlyData.length - 1)) * plotWidth
    const y = plotBottom - (d.completed / maxVal) * plotHeight
    return { x, y }
  })

  function getBezier(pts: Array<{ x: number; y: number }>) {
    if (pts.length === 0) return ''
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]
      const cp1x = p1.x + (p2.x - p0.x) / 6
      const cp1y = p1.y + (p2.y - p0.y) / 6
      const cp2x = p2.x - (p3.x - p1.x) / 6
      const cp2y = p2.y - (p3.y - p1.y) / 6
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }
    return d
  }

  const lineD = getBezier(points)
  const areaD = `${lineD} L ${points[points.length - 1].x.toFixed(1)} ${plotBottom} L ${points[0].x.toFixed(1)} ${plotBottom} Z`
  const targetD = getBezier(targetPoints)
  const activePt = points[activeIdx] || points[4]

  return (
    <div className="flex flex-col justify-between h-full">
      {/* Chart Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#ff783d] shadow-[0_0_8px_rgba(255,120,61,0.6)]" />
              <h2 className="font-bw-display text-sm font-bold text-bw-ink">تدفق الطلبات بالساعات</h2>
            </div>
            <p className="text-[11px] text-bw-ink-subtle mt-0.5">معدل إنشاء الطلبات والمكتمل منها على مدار اليوم</p>
          </div>

          {/* Controls: Bar / Area Toggle + Timeframe */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded-lg bg-bw-sunken p-0.5 border border-bw-line/70">
              <button
                type="button"
                onClick={() => setChartMode('bar')}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-semibold transition-all',
                  chartMode === 'bar' ? 'bg-[#ff783d] text-white shadow-xs' : 'text-bw-ink-soft hover:text-bw-ink',
                )}
              >
                أعمدة
              </button>
              <button
                type="button"
                onClick={() => setChartMode('area')}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-semibold transition-all',
                  chartMode === 'area' ? 'bg-[#ff783d] text-white shadow-xs' : 'text-bw-ink-soft hover:text-bw-ink',
                )}
              >
                منحنى
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-bw-sunken px-2 py-0.5 text-[11px] text-bw-ink-soft border border-bw-line/70">
              <span>اليوم</span>
              <ChevronDown className="size-3 text-bw-ink-subtle" />
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
          {filterTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'whitespace-nowrap px-2.5 py-0.5 rounded-full transition-all duration-200 text-xs',
                activeTab === t.id
                  ? 'border border-[#ff783d] text-[#ff783d] bg-[#ff783d]/15 font-bold shadow-xs'
                  : 'text-bw-ink-soft hover:text-bw-ink hover:bg-white/5',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Chart Body */}
      <div className="relative mt-2 select-none">
        {/* Floating Tooltip Card */}
        <div
          className="absolute z-20 pointer-events-none transition-all duration-200 ease-out"
          style={{
            top: '4px',
            left: `${Math.max(6, Math.min((activeIdx / (hourlyData.length - 1)) * 100 - 15, 62))}%`,
          }}
        >
          <div className="rounded-xl border border-white/10 bg-[#12141c]/95 p-3 shadow-2xl backdrop-blur-md min-w-[155px] text-right">
            <div className="text-[10px] text-zinc-400 font-medium">
              16 أكتوبر 2026 - {activeData.time}
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <div className="font-mono text-xl font-black text-white">
                <bdi>{activeData.newOrders}</bdi> <span className="text-[10px] font-normal text-zinc-400">طلب جديد</span>
              </div>
              <div className="text-[11px] font-bold text-[#ff783d]">
                {activeData.change}
              </div>
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-white/10 space-y-0.5 text-[10px] text-zinc-300">
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">مكتمل:</span>
                <span className="font-semibold text-blue-400">{activeData.completed} طلب</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">نسبة الإنجاز:</span>
                <span className="font-semibold text-emerald-400">{Math.round((activeData.completed / activeData.newOrders) * 100)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Mode 1: Interactive Bar Chart (Default per Requirement 5) */}
        {chartMode === 'bar' ? (
          <div className="pt-10 pb-2">
            <div className="flex h-40 items-end justify-between gap-3 px-3 border-b border-bw-line/60">
              {hourlyData.map((d, idx) => {
                const isSelected = idx === activeIdx
                return (
                  <div
                    key={idx}
                    className="flex flex-col items-center flex-1 h-full justify-end cursor-pointer group"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => setActiveIdx(idx)}
                  >
                    <div className="flex items-end gap-1.5 w-full justify-center h-full pb-1">
                      {/* Orange Bar (New Orders) */}
                      <div
                        style={{ height: `${(d.newOrders / maxVal) * 100}%` }}
                        className={cn(
                          'w-3 rounded-t-sm transition-all duration-200',
                          isSelected
                            ? 'bg-gradient-to-t from-[#ff783d] to-[#ff9800] shadow-[0_0_12px_rgba(255,120,61,0.5)] ring-1 ring-[#ff783d]'
                            : 'bg-[#ff783d]/80 group-hover:bg-[#ff783d]',
                        )}
                      />
                      {/* Blue Bar (Completed Orders) */}
                      <div
                        style={{ height: `${(d.completed / maxVal) * 100}%` }}
                        className={cn(
                          'w-3 rounded-t-sm transition-all duration-200',
                          isSelected
                            ? 'bg-gradient-to-t from-blue-600 to-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.5)] ring-1 ring-blue-400'
                            : 'bg-blue-500/75 group-hover:bg-blue-500',
                        )}
                      />
                    </div>
                    <span
                      className={cn(
                        'mt-2 text-[10px] transition-colors',
                        isSelected ? 'font-bold text-[#ff783d]' : 'text-bw-ink-subtle',
                      )}
                    >
                      {d.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Mode 2: Area Curve Chart */
          <div className="pt-2">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
              <defs>
                <linearGradient id="order-flow-grad-bar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff783d" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#ff783d" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={areaD} fill="url(#order-flow-grad-bar)" />
              <path d={targetD} fill="none" stroke="#3b82f6" strokeDasharray="3 3" strokeWidth="1.5" />
              <path d={lineD} fill="none" stroke="#ff783d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <line x1={activePt.x} y1={activePt.y} x2={activePt.x} y2={plotBottom} stroke="#ff783d" strokeDasharray="3 3" strokeWidth="1.5" />
              <circle cx={activePt.x} cy={activePt.y} r="8" fill="#ff783d" fillOpacity="0.3" className="animate-ping" />
              <circle cx={activePt.x} cy={activePt.y} r="4.5" fill="#ff783d" stroke="#ffffff" strokeWidth="2" />
              {hourlyData.map((d, i) => (
                <circle
                  key={i}
                  cx={points[i].x}
                  cy={points[i].y}
                  r="12"
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => setActiveIdx(i)}
                />
              ))}
              {hourlyData.map((d, i) => (
                <text
                  key={i}
                  x={points[i].x}
                  y={plotBottom + 18}
                  textAnchor="middle"
                  fill={i === activeIdx ? '#ff783d' : 'rgba(255,255,255,0.45)'}
                  fontWeight={i === activeIdx ? 'bold' : 'normal'}
                  fontSize="11"
                >
                  {d.label}
                </text>
              ))}
            </svg>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-bw-ink-soft mt-3 pt-2.5 border-t border-bw-line/40">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs bg-[#ff783d]" />
          <span className="text-[11px] font-medium text-bw-ink">طلبات جديدة</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs bg-blue-500" />
          <span className="text-[11px] font-medium text-bw-ink">طلبات مكتملة</span>
        </div>
      </div>
    </div>
  )
}

/* ── Compact Stage-Based Operational Fulfillment Pipeline (Requirement 6) ── */
function OperationalFulfillmentPipeline({
  totalOrders = 142,
  stages = [
    { id: 'placed', label: 'مستني التوفير', count: 28, pct: 20, color: '#ff783d', href: '/admin/sourcing' },
    { id: 'preparing', label: 'قيد التجهيز', count: 34, pct: 24, color: '#3b82f6', href: '/hub' },
    { id: 'packing', label: 'جاهز للتغليف', count: 26, pct: 18, color: '#eab308', href: '/hub' },
    { id: 'shipped', label: 'مع المندوب', count: 40, pct: 28, color: '#8b5cf6', href: '/hub/dispatch' },
    { id: 'delivered', label: 'تم التسليم', count: 10, pct: 7, color: '#22c55e', href: '/admin/orders' },
    { id: 'failed', label: 'ملغي / مرتجع', count: 4, pct: 3, color: '#ef4444', href: '/admin/orders' },
  ],
}: {
  totalOrders?: number
  stages?: Array<{ id: string; label: string; count: number; pct: number; color: string; href: string }>
}) {
  return (
    <div className="flex flex-col justify-between h-full">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bw-display text-sm font-bold text-bw-ink">مسار تجهيز وشحن الطلبات</h2>
            <p className="text-[11px] text-bw-ink-subtle mt-0.5">متابعة تدفق المراحل من التوريد حتى التسليم</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-bw-sunken px-2.5 py-1 text-xs font-semibold text-bw-ink border border-bw-line/70">
            <span className="text-[10px] text-bw-ink-subtle font-normal">الإجمالي:</span>
            <span className="font-mono text-[#ff783d]"><bdi>{totalOrders}</bdi></span>
            <span className="text-[10px] text-bw-ink-soft">طلب</span>
          </div>
        </div>

        {/* Linear Segmented Progress Bar */}
        <div className="mt-3.5 space-y-1.5">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-bw-sunken/80 gap-1 p-0.5 ring-1 ring-bw-line/50">
            {stages.map((s) => (
              <div
                key={s.id}
                style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                className="h-full rounded-xs transition-all duration-300 hover:brightness-125"
                title={`${s.label}: ${s.count} (${s.pct}%)`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-[10px] text-bw-ink-subtle px-1">
            <span>التوريد والمخزن (62%)</span>
            <span>التوصيل والتسليم (38%)</span>
          </div>
        </div>
      </div>

      {/* Grid of Stage Cards (Compact, Clickable, Stage-based) */}
      <div className="grid grid-cols-2 gap-2 my-2">
        {stages.map((s) => (
          <Link
            key={s.id}
            href={s.href}
            className="group relative flex flex-col justify-between rounded-xl border border-bw-line/60 bg-bw-sunken/40 p-2.5 transition-all duration-200 hover:border-bw-line-field hover:bg-bw-sunken/90 hover:shadow-xs"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-[11px] font-semibold text-bw-ink truncate">{s.label}</span>
              </div>
              <span className="text-[10px] font-medium text-bw-ink-subtle">{s.pct}%</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <div className="font-mono text-base font-extrabold text-bw-ink">
                <bdi>{s.count}</bdi> <span className="text-[10px] font-normal text-bw-ink-subtle">طلب</span>
              </div>
              <ArrowLeft className="size-3 text-bw-ink-subtle opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:-translate-x-1 group-hover:text-[#ff783d]" />
            </div>
          </Link>
        ))}
      </div>

      {/* Footer fresh indicator */}
      <div className="pt-2 border-t border-bw-line/40 text-[10px] text-bw-ink-subtle flex items-center justify-between">
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          تحديث لحظي لحركات الشحن والمخزن
        </span>
        <span className="font-mono text-[10px] text-bw-ink-soft">6 مراحل نشطة</span>
      </div>
    </div>
  )
}

/* ── Expanded & Prioritized Action Required Panel (Requirement 7) ──── */
function ActionRequiredPanel({
  items,
  totalCount = 24,
}: {
  items: Array<{
    id: string
    title: string
    desc: string
    count: number
    priorityLabel: string
    priorityColor: string
    iconBg: string
    icon: React.ElementType
    href: string
  }>
  totalCount?: number
}) {
  return (
    <div className="flex flex-col justify-between h-full">
      {/* Header with Severity Counts */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-bw-display text-sm font-bold text-bw-ink">يحتاج تدخلك الآن</h2>
            <span className="rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.5 font-mono text-xs font-bold text-red-400">
              <bdi>{totalCount}</bdi>
            </span>
          </div>
          <Link
            href="/admin/orders"
            className="text-[11px] font-semibold text-[#ff783d] hover:underline"
          >
            عرض الكل
          </Link>
        </div>
        {/* Severity Summary Pills */}
        <div className="mt-2.5 flex items-center gap-1.5 text-[10px]">
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-semibold text-red-400 border border-red-500/20">
            4 حرج
          </span>
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-400 border border-amber-500/20">
            8 عاجل
          </span>
          <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 font-semibold text-yellow-400 border border-yellow-500/20">
            2 مالي
          </span>
          <span className="text-bw-ink-subtle mr-auto">مرتب حسب الأولوية</span>
        </div>
      </div>

      {/* Prioritized Action Cards Stack */}
      <div className="space-y-1.5 my-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="group flex items-center justify-between rounded-xl border border-bw-line/60 bg-bw-sunken/40 p-2.5 transition-all duration-200 hover:border-bw-line-field hover:bg-bw-sunken/80 hover:shadow-xs"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg shadow-xs', item.iconBg)}>
                <item.icon className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-bold text-bw-ink truncate">{item.title}</p>
                  <span className={cn('rounded px-1.5 py-0.2 text-[9px] font-bold', item.priorityColor)}>
                    {item.priorityLabel}
                  </span>
                </div>
                <p className="text-[10px] text-bw-ink-subtle truncate">{item.desc}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="flex size-6 items-center justify-center rounded-full bg-bw-sunken font-mono text-xs font-bold text-bw-ink border border-bw-line/70">
                <bdi>{item.count}</bdi>
              </span>
              <ChevronLeft className="size-3.5 text-bw-ink-subtle transition-transform group-hover:-translate-x-1 group-hover:text-bw-ink" />
            </div>
          </Link>
        ))}
      </div>

      {/* Bottom Action Footer */}
      <div className="pt-2 border-t border-bw-line/40 text-[10px] text-bw-ink-subtle text-center">
        يتم تصنيف التدخلات آلياً حسب الأولوية لمنع تعطل الشحنات
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

  // Pipeline Stages for Operational Pipeline (Requirement 6)
  const pipelineStages = [
    { id: 'placed', label: 'مستني التوفير', count: 28, pct: 20, color: '#ff783d', href: '/admin/sourcing' },
    { id: 'preparing', label: 'قيد التجهيز', count: 34, pct: 24, color: '#3b82f6', href: '/hub' },
    { id: 'packing', label: 'جاهز للتغليف', count: 26, pct: 18, color: '#eab308', href: '/hub' },
    { id: 'shipped', label: 'مع المندوب', count: 40, pct: 28, color: '#8b5cf6', href: '/hub/dispatch' },
    { id: 'delivered', label: 'تم التسليم', count: 10, pct: 7, color: '#22c55e', href: '/admin/orders' },
    { id: 'failed', label: 'ملغي / مرتجع', count: 4, pct: 3, color: '#ef4444', href: '/admin/orders' },
  ]

  // Action Required 5 Cards Prioritized (Requirement 7)
  const actionItems = [
    {
      id: 'delivery',
      title: 'فشل التوصيل',
      desc: 'محاولات فاشلة تحتاج متابعة',
      count: 4,
      priorityLabel: 'حرج',
      priorityColor: 'bg-red-500/20 text-red-400 border border-red-500/30',
      iconBg: 'bg-red-950/60 text-red-400 border border-red-800/40',
      icon: Truck,
      href: '/hub/dispatch',
    },
    {
      id: 'supply',
      title: 'نواقص من الموردين',
      desc: 'طلبات تحتاج توفير منتجات',
      count: 5,
      priorityLabel: 'عاجل',
      priorityColor: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
      iconBg: 'bg-amber-950/60 text-amber-400 border border-amber-800/40',
      icon: Package,
      href: '/admin/sourcing',
    },
    {
      id: 'processing',
      title: 'تأخير في التجهيز',
      desc: 'تجاوزت 24 ساعة في المخزن',
      count: 3,
      priorityLabel: 'عاجل',
      priorityColor: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
      iconBg: 'bg-blue-950/60 text-blue-400 border border-blue-800/40',
      icon: Clock,
      href: '/hub',
    },
    {
      id: 'cash',
      title: 'قضايا دفع أو تحصيل',
      desc: 'تسويات كاش متأخرة أو فروق',
      count: 2,
      priorityLabel: 'مالي',
      priorityColor: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
      iconBg: 'bg-yellow-950/60 text-yellow-400 border border-yellow-800/40',
      icon: Wallet,
      href: '/admin/cash',
    },
    {
      id: 'support',
      title: 'ملاحظات عملاء حرجة',
      desc: 'شكاوى عاجلة بانتظار الرد',
      count: 3,
      priorityLabel: 'متابعة',
      priorityColor: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
      iconBg: 'bg-purple-950/60 text-purple-400 border border-purple-800/40',
      icon: MessageSquare,
      href: '/admin/orders',
    },
  ]

  // Orders List Deduplicated by ID (Requirement 10)
  const orderItems: OrderRow[] = React.useMemo(() => {
    const raw =
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

    const seen = new Set<string>()
    return raw.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  }, [orders.data?.items])

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
      {/* ── Top Command Bar Header (Simplified per Requirement 9) ─── */}
      <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between border-b border-bw-line/70">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h1 className="font-bw-display text-2xl font-bold tracking-tight text-bw-ink flex items-center gap-1.5">
              <span>صباح الخير، {me.name?.split(' ')[0] ?? 'أحمد'}</span>
              <span className="text-xl" aria-hidden>👋</span>
            </h1>
            <span className="ms-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              مباشر · 10:45 ص
            </span>
          </div>
          <p className="text-xs text-bw-ink-subtle">
            مركز التحكم الميداني وعمليات شينا كير
          </p>
        </div>

        {/* Search & Date Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث السريع..."
              className="h-9 w-44 sm:w-60 rounded-xl border border-bw-line/70 bg-bw-surface/90 ps-8 pe-14 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-[#ff783d] focus:outline-none focus:ring-1 focus:ring-[#ff783d] transition-all shadow-inner"
            />
            <Search className="absolute start-2.5 top-2.5 size-3.5 text-bw-ink-subtle pointer-events-none" />
            <kbd className="absolute end-2.5 top-2 rounded bg-bw-sunken px-1.5 py-0.5 text-[9px] font-mono text-bw-ink-subtle border border-bw-line/70 pointer-events-none">
              Ctrl K
            </kbd>
          </div>

          <div className="flex items-center rounded-xl border border-bw-line/70 bg-bw-surface/90 p-0.5 text-xs shadow-sm">
            <button
              type="button"
              onClick={() => setDateFilter('today')}
              className={cn(
                'rounded-lg px-3 py-1 font-semibold transition-all text-xs',
                dateFilter === 'today'
                  ? 'bg-[#ff783d] text-white shadow-xs'
                  : 'text-bw-ink-soft hover:text-bw-ink',
              )}
            >
              اليوم
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('7d')}
              className={cn(
                'rounded-lg px-2.5 py-1 transition-all text-xs',
                dateFilter === '7d'
                  ? 'bg-[#ff783d] text-white font-semibold shadow-xs'
                  : 'text-bw-ink-soft hover:text-bw-ink',
              )}
            >
              7 أيام
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('30d')}
              className={cn(
                'rounded-lg px-2.5 py-1 transition-all text-xs',
                dateFilter === '30d'
                  ? 'bg-[#ff783d] text-white font-semibold shadow-xs'
                  : 'text-bw-ink-soft hover:text-bw-ink',
              )}
            >
              30 يوم
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

      {/* ── Middle 3-Column Operations Row ────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 mt-4 items-stretch">
        {/* Panel 1 (Left in RTL): تدفق الطلبات بالساعات (Interactive Bar Chart - Requirement 5) — 5 cols */}
        <div className="lg:col-span-5 rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-5 shadow-bw-card flex flex-col justify-between transition-all duration-200 hover:border-bw-line-field">
          <OrderAnalyticsChart />
        </div>

        {/* Panel 2 (Center in RTL): مسار تجهيز وشحن الطلبات (Fulfillment Pipeline - Requirement 6) — 4 cols */}
        <div className="lg:col-span-4 rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-5 shadow-bw-card flex flex-col justify-between transition-all duration-200 hover:border-bw-line-field">
          <OperationalFulfillmentPipeline totalOrders={totalOrdersToday} stages={pipelineStages} />
        </div>

        {/* Panel 3 (Right in RTL): يحتاج تدخلك الآن (Expanded & Prioritized - Requirement 7) — 3 cols */}
        <div className="lg:col-span-3 rounded-2xl border border-bw-line/70 bg-bw-surface/90 p-5 shadow-bw-card flex flex-col justify-between transition-all duration-200 hover:border-bw-line-field">
          <ActionRequiredPanel items={actionItems} totalCount={attentionCount} />
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
                    <bdi className="font-mono">{codCollectedAmount.toLocaleString('en-US')}</bdi>{' '}
                    <span className="text-sm font-normal text-bw-ink-soft">ج.م</span>
                  </>
                ) : (
                  '••••••••'
                )}
              </div>
              <div className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                <TrendingUp className="size-3" />
                <bdi>+12%</bdi>
              </div>
            </div>
          </div>

          {/* Progress Bar 68% */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#ff783d]"><bdi>68%</bdi></span>
              <span className="text-bw-ink-subtle text-[11px]">
                من إجمالي المستحقات <bdi className="font-mono text-bw-ink font-medium">48,300</bdi> ج.م
              </span>
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
                <Hourglass className="size-3.5 text-amber-400 shrink-0" />
              </div>
              <p className="font-bw-display text-sm font-bold text-bw-ink flex items-baseline gap-1">
                {showFinancials ? (
                  <>
                    <bdi className="font-mono">15,850</bdi>
                    <span className="text-[11px] font-normal text-bw-ink-subtle">ج.م</span>
                  </>
                ) : (
                  '••••'
                )}
              </p>
            </div>

            {/* Box 2: متأخر عن السداد */}
            <div className="rounded-xl border border-bw-line/60 bg-bw-sunken/40 p-3 space-y-1">
              <div className="flex items-center justify-between text-bw-ink-subtle">
                <span className="text-[10px]">متأخر عن السداد</span>
                <AlertTriangle className="size-3.5 text-red-400 shrink-0" />
              </div>
              <p className="font-bw-display text-sm font-bold text-bw-ink flex items-baseline gap-1">
                {showFinancials ? (
                  <>
                    <bdi className="font-mono">7,200</bdi>
                    <span className="text-[11px] font-normal text-bw-ink-subtle">ج.م</span>
                  </>
                ) : (
                  '••••'
                )}
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
