'use client'

import * as React from 'react'
import Link from 'next/link'
import { TrendingUp } from 'lucide-react'
import { Code, Money } from '@/components/bw/primitives'
import type { OrderDistributionItem, OrderStatusKey, OverviewDays, SalesChartPoint } from './overview-types'

/* ── Compact Real-Data Sparkline ─────────────────────────────────────── */

type SparklineTone = 'cobalt' | 'emerald' | 'amber' | 'neutral'

const SPARKLINE_TONE_CLASS: Record<SparklineTone, string> = {
  cobalt: 'text-bw-cobalt',
  emerald: 'text-bw-emerald',
  amber: 'text-bw-amber',
  neutral: 'text-bw-ink-soft',
}

export function Sparkline({
  data,
  tone = 'cobalt',
  className = '',
}: {
  data: number[]
  tone?: SparklineTone
  className?: string
}) {
  const width = 88
  const height = 28
  const padding = 3
  const gradId = React.useId()

  if (!data || data.length === 0) {
    return (
      <div className={`flex items-center justify-center text-[10px] text-bw-ink-subtle ${className}`}>
        —
      </div>
    )
  }

  const allZero = data.every((v) => v === 0)
  if (allZero) {
    return (
      <div className={`h-7 w-20 flex items-center text-bw-ink-subtle ${className}`}>
        <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} aria-hidden>
          <line
            x1="2"
            y1={height / 2}
            x2={width - 2}
            y2={height / 2}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            strokeOpacity="0.4"
          />
          <circle cx={width - 2} cy={height / 2} r="2" fill="currentColor" opacity="0.5" />
        </svg>
      </div>
    )
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((val, idx) => {
    const x = padding + (idx / Math.max(data.length - 1, 1)) * (width - 2 * padding)
    const y = height - padding - ((val - min) / range) * (height - 2 * padding)
    return { x, y }
  })

  let pathD = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const midX = (prev.x + curr.x) / 2
    pathD += ` C ${midX.toFixed(1)},${prev.y.toFixed(1)} ${midX.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`
  }

  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const areaD = `${pathD} L ${lastPoint.x.toFixed(1)},${height} L ${firstPoint.x.toFixed(1)},${height} Z`

  return (
    <div className={`h-7 w-20 ${SPARKLINE_TONE_CLASS[tone]} ${className}`}>
      <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradId})`} />
        <path
          d={pathD}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="4" fill="currentColor" fillOpacity="0.2" />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="2.2" fill="currentColor" />
      </svg>
    </div>
  )
}

/* ── Sales Performance Chart (EGP Area/Line + Optional Previous Period) ─ */

function buildSmoothPath(pts: Array<{ x: number; y: number }>) {
  if (pts.length === 0) return ''
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    const midX = (prev.x + curr.x) / 2
    d += ` C ${midX.toFixed(1)},${prev.y.toFixed(1)} ${midX.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`
  }
  return d
}

function formatAxisEgp(value: number): string {
  if (value >= 1000) {
    const k = value / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
  }
  return String(Math.round(value))
}

export function SalesPerformanceChart({
  series,
  days,
  granularity,
  hasFinancialAccess,
  hasPreviousComparison,
  onDaysChange,
  loading = false,
}: {
  series: SalesChartPoint[]
  days: OverviewDays
  granularity: 'hourly' | 'daily'
  hasFinancialAccess: boolean
  hasPreviousComparison: boolean
  onDaysChange: (d: OverviewDays) => void
  loading?: boolean
}) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)
  const gradientId = React.useId()

  if (loading && series.length === 0) {
    return (
      <div className="rounded-bw-card border border-bw-line bg-bw-surface p-5 shadow-bw-card animate-pulse space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 w-40 rounded bg-bw-sunken" />
          <div className="h-8 w-44 rounded bg-bw-sunken" />
        </div>
        <div className="h-44 w-full rounded bg-bw-sunken" />
      </div>
    )
  }

  const width = 680
  const height = 185
  const paddingStart = 12
  const paddingEnd = 12
  const paddingTop = 18
  const paddingBottom = 16
  const plotWidth = width - paddingStart - paddingEnd
  const plotHeight = height - paddingTop - paddingBottom

  const useSalesMode = hasFinancialAccess
  const primaryValues = series.map((s) => (useSalesMode ? (s.sales ?? 0) : s.orders))
  const secondaryValues = series.map((s) =>
    useSalesMode ? (hasPreviousComparison ? (s.previousSales ?? 0) : 0) : s.delivered,
  )

  const maxPrimary = Math.max(...primaryValues, 0)
  const maxSecondary = Math.max(...secondaryValues, 0)
  const rawMax = Math.max(maxPrimary, maxSecondary, useSalesMode ? 100 : 4)
  const maxVal = rawMax > 0 ? rawMax * 1.12 : 4

  const primaryPoints = series.map((_, idx) => {
    const x = paddingStart + (idx / Math.max(series.length - 1, 1)) * plotWidth
    const y = height - paddingBottom - (primaryValues[idx] / maxVal) * plotHeight
    return { x, y }
  })

  const secondaryPoints = series.map((_, idx) => {
    const x = paddingStart + (idx / Math.max(series.length - 1, 1)) * plotWidth
    const y = height - paddingBottom - (secondaryValues[idx] / maxVal) * plotHeight
    return { x, y }
  })

  const showSecondaryLine = useSalesMode ? hasPreviousComparison : true
  const pathPrimary = buildSmoothPath(primaryPoints)
  const pathSecondary = showSecondaryLine ? buildSmoothPath(secondaryPoints) : ''
  const areaPrimary =
    primaryPoints.length > 0
      ? `${pathPrimary} L ${primaryPoints[primaryPoints.length - 1].x.toFixed(1)},${(height - paddingBottom).toFixed(1)} L ${primaryPoints[0].x.toFixed(1)},${(height - paddingBottom).toFixed(1)} Z`
      : ''

  const activeIndex = hoveredIndex !== null && hoveredIndex < series.length ? hoveredIndex : null
  const activePoint = activeIndex !== null ? series[activeIndex] : null
  const activePrimaryPt = activeIndex !== null ? primaryPoints[activeIndex] : null

  const totalSales = useSalesMode
    ? Math.round(series.reduce((sum, s) => sum + (s.sales ?? 0), 0) * 100) / 100
    : 0
  const totalOrders = series.reduce((sum, s) => sum + s.orders, 0)
  const totalDelivered = series.reduce((sum, s) => sum + s.delivered, 0)
  const allZero = primaryValues.every((v) => v === 0) && (!showSecondaryLine || secondaryValues.every((v) => v === 0))

  const tickValues = [maxVal, maxVal / 2, 0]

  const rangeOptions: Array<{ value: OverviewDays; label: string }> = [
    { value: 1, label: 'اليوم' },
    { value: 7, label: '7 أيام' },
    { value: 30, label: '30 يوم' },
  ]

  const xLabelVisible = (idx: number) => {
    if (granularity === 'hourly') return idx === 0 || idx === 6 || idx === 12 || idx === 18 || idx === 23
    if (days === 30) return idx === 0 || idx % 6 === 0 || idx === series.length - 1
    return true
  }

  // Clamp tooltip anchor percentage so it stays cleanly inside the chart box on mobile & desktop
  const tooltipLeftPct = activePrimaryPt
    ? Math.min(82, Math.max(18, (activePrimaryPt.x / width) * 100))
    : 50

  return (
    <section
      aria-label={useSalesMode ? 'أداء المبيعات' : 'حركة الطلبات'}
      className="flex flex-col justify-between rounded-bw-card border border-bw-line bg-bw-surface p-5 shadow-bw-card transition-colors duration-150 hover:border-bw-cobalt/30"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-bw-field border border-bw-cobalt/20 bg-bw-cobalt-soft text-bw-cobalt">
              <TrendingUp className="size-3.5" aria-hidden />
            </span>
            <h2 className="text-bw-heading font-semibold text-bw-ink">
              {useSalesMode ? 'أداء المبيعات المحققة' : 'حركة الطلبات'}
            </h2>
          </div>
          <p className="text-xs text-bw-ink-subtle">
            {useSalesMode ? (
              <>
                صافي مبيعات البضاعة المسلمة: <Money value={totalSales} className="font-semibold text-bw-ink" />{' '}
                · <Code className="text-bw-emerald font-semibold">{totalDelivered}</Code> طلب مكتمل من أصل <Code className="text-bw-ink-soft">{totalOrders}</Code> طلب جديد
              </>
            ) : (
              <>
                <Code className="text-bw-cobalt font-semibold">{totalOrders}</Code> طلب جديد · <Code className="text-bw-emerald font-semibold">{totalDelivered}</Code> طلب مكتمل (بيانات المبيعات متاحة للإدارة فقط)
              </>
            )}
          </p>
        </div>

        {/* Date-range switcher */}
        <div
          role="group"
          aria-label="الفترة الزمنية للرسم البياني"
          className="inline-flex items-center gap-0.5 rounded-bw-field border border-bw-line bg-bw-page p-0.5 text-xs"
        >
          {rangeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={days === opt.value}
              onClick={() => onDaysChange(opt.value)}
              className={`rounded-md border px-2.5 py-1 font-medium transition-colors duration-150 ${
                days === opt.value
                  ? 'border-bw-cobalt/35 bg-bw-cobalt-soft text-bw-cobalt font-semibold'
                  : 'border-transparent text-bw-ink-subtle hover:bg-bw-sunken/70 hover:text-bw-ink'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-bw-ink-subtle">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-2 border-bw-cobalt" />
          <span className="font-medium text-bw-ink">
            {useSalesMode ? 'المبيعات المحققة (ج.م)' : 'الطلبات الجديدة'}
          </span>
        </div>
        {showSecondaryLine ? (
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block w-4 border-t-2 border-dashed ${
                useSalesMode ? 'border-bw-ink-subtle' : 'border-bw-emerald'
              }`}
            />
            <span className={useSalesMode ? 'text-bw-ink-subtle' : 'text-bw-emerald'}>
              {useSalesMode ? 'الفترة السابقة' : 'تم التسليم'}
            </span>
          </div>
        ) : null}
      </div>

      {/* Plot area: chronological LTR canvas with Y-axis EGP ticks */}
      <div className="mt-3 flex items-stretch gap-2" dir="ltr">
        {/* Y-Axis Labels */}
        <div className="flex flex-col justify-between py-4 text-[10px] font-mono text-bw-ink-subtle tabular-nums select-none text-end min-w-[34px]">
          {tickValues.map((val, i) => (
            <span key={i}>{useSalesMode ? formatAxisEgp(val) : Math.round(val)}</span>
          ))}
        </div>

        <div
          className="relative flex-1 h-48 select-none"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {/* Horizontal grid lines */}
          <div className="pointer-events-none absolute inset-x-0 top-[18px] bottom-[16px] flex flex-col justify-between">
            <div className="h-px w-full bg-bw-line/55" />
            <div className="h-px w-full bg-bw-line/40" />
            <div className="h-px w-full bg-bw-line/55" />
          </div>

          {allZero ? (
            <div
              dir="rtl"
              className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-bw-ink-subtle"
            >
              {useSalesMode
                ? 'لا توجد مبيعات محققة مسجلة في هذه الفترة'
                : 'لا توجد حركة طلبات مسجلة في هذه الفترة'}
            </div>
          ) : null}

          <svg
            className="h-full w-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={useSalesMode ? 'منحنى أداء المبيعات' : 'منحنى حركة الطلبات'}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: 'var(--color-bw-cobalt)' }} stopOpacity="0.28" />
                <stop offset="65%" style={{ stopColor: 'var(--color-bw-cobalt)' }} stopOpacity="0.06" />
                <stop offset="100%" style={{ stopColor: 'var(--color-bw-cobalt)' }} stopOpacity="0" />
              </linearGradient>
            </defs>

            {areaPrimary ? <path d={areaPrimary} fill={`url(#${gradientId})`} /> : null}

            {pathSecondary ? (
              <path
                d={pathSecondary}
                fill="none"
                className={useSalesMode ? 'stroke-bw-ink-subtle' : 'stroke-bw-emerald'}
                strokeWidth="1.5"
                strokeDasharray="4 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.6"
              />
            ) : null}

            {pathPrimary ? (
              <path
                d={pathPrimary}
                fill="none"
                className="stroke-bw-cobalt"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            {activePrimaryPt ? (
              <line
                x1={activePrimaryPt.x}
                y1={paddingTop}
                x2={activePrimaryPt.x}
                y2={height - paddingBottom}
                className="stroke-bw-cobalt"
                strokeOpacity="0.45"
                strokeDasharray="3 3"
                strokeWidth="1.2"
              />
            ) : null}

            {primaryPoints.map((pt, idx) => (
              <React.Fragment key={`p-${idx}`}>
                {hoveredIndex === idx ? (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={8}
                    className="fill-bw-cobalt"
                    fillOpacity="0.18"
                  />
                ) : null}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredIndex === idx ? 4.5 : series.length > 15 ? 2 : 3}
                  className={`stroke-bw-cobalt transition-all duration-150 ${
                    hoveredIndex === idx ? 'fill-bw-cobalt' : 'fill-bw-surface'
                  }`}
                  strokeWidth="2"
                />
              </React.Fragment>
            ))}

            {primaryPoints.map((pt, idx) => {
              const colWidth = plotWidth / Math.max(series.length, 1)
              return (
                <rect
                  key={`hit-${idx}`}
                  x={pt.x - colWidth / 2}
                  y={0}
                  width={colWidth}
                  height={height}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onFocus={() => setHoveredIndex(idx)}
                />
              )
            })}
          </svg>

          {/* Floating RTL Tooltip */}
          {activePoint && activePrimaryPt ? (
            <div
              dir="rtl"
              className="pointer-events-none absolute top-1 z-20 transition-all duration-100"
              style={{
                left: `${tooltipLeftPct}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="min-w-[172px] rounded-bw-field border border-bw-cobalt/35 bg-bw-kohl px-3.5 py-2.5 text-start shadow-bw-overlay">
                <div className="mb-1.5 flex items-center justify-between gap-3 border-b border-bw-line pb-1.5 text-xs">
                  <span className="font-semibold text-bw-on-kohl">{activePoint.label}</span>
                  <span className="font-mono text-[11px] text-bw-ink-subtle">
                    <bdi>{activePoint.shortLabel}</bdi>
                  </span>
                </div>
                <div className="space-y-1 text-xs">
                  {useSalesMode ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-bw-ink-soft">
                          <span className="size-1.5 rounded-full bg-bw-cobalt" aria-hidden />
                          المبيعات:
                        </span>
                        <span className="font-mono font-bold text-bw-cobalt">
                          <Money value={activePoint.sales ?? 0} />
                        </span>
                      </div>
                      {hasPreviousComparison ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-1.5 text-bw-ink-subtle">
                            <span className="size-1.5 rounded-full bg-bw-ink-subtle" aria-hidden />
                            الفترة السابقة:
                          </span>
                          <span className="font-mono text-bw-ink-soft">
                            <Money value={activePoint.previousSales ?? 0} />
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-bw-ink-subtle">طلبات جديدة:</span>
                    <span className="font-mono font-semibold text-bw-ink">
                      <Code>{activePoint.orders}</Code>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-bw-ink-subtle">
                      <span className="size-1.5 rounded-full bg-bw-emerald" aria-hidden />
                      تم تسليمها:
                    </span>
                    <span className="font-mono font-semibold text-bw-emerald">
                      <Code>{activePoint.delivered}</Code>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* X-Axis Labels aligned with chronological plot */}
      <div dir="ltr" className="mt-1 flex items-center justify-between border-t border-bw-line pt-2 ps-10 pe-3 text-[11px] text-bw-ink-subtle">
        {series.map((s, idx) => {
          if (!xLabelVisible(idx)) return <span key={s.key} className="w-0 overflow-hidden" aria-hidden />
          const isLast = idx === series.length - 1
          return (
            <span
              key={s.key}
              className={isLast ? 'font-semibold text-bw-cobalt' : ''}
            >
              {granularity === 'hourly' ? s.shortLabel : days === 30 ? s.shortLabel : s.label}
            </span>
          )
        })}
      </div>
    </section>
  )
}

/* ── Compact Order Status Distribution ───────────────────────────────── */

const STATUS_META: Record<
  OrderStatusKey,
  { label: string; barClass: string; dotClass: string; hoverClass: string }
> = {
  placed:    { label: 'انتظار التوريد', barClass: 'bg-bw-amber',     dotClass: 'bg-bw-amber',     hoverClass: 'hover:border-bw-amber/35' },
  confirmed: { label: 'تأكد التوفر',    barClass: 'bg-bw-cobalt',    dotClass: 'bg-bw-cobalt',    hoverClass: 'hover:border-bw-cobalt/35' },
  packing:   { label: 'قيد التجهيز',    barClass: 'bg-bw-violet/70', dotClass: 'bg-bw-violet/70', hoverClass: 'hover:border-bw-violet/35' },
  shipped:   { label: 'مع المندوب',     barClass: 'bg-bw-violet',    dotClass: 'bg-bw-violet',    hoverClass: 'hover:border-bw-violet/40' },
  delivered: { label: 'مكتملة',         barClass: 'bg-bw-emerald',   dotClass: 'bg-bw-emerald',   hoverClass: 'hover:border-bw-emerald/35' },
  cancelled: { label: 'ملغاة',          barClass: 'bg-bw-rose',      dotClass: 'bg-bw-rose',      hoverClass: 'hover:border-bw-rose/35' },
  returned:  { label: 'مرتجعة',         barClass: 'bg-bw-rose/60',   dotClass: 'bg-bw-rose/60',   hoverClass: 'hover:border-bw-rose/30' },
}

export function OrderDistributionBar({
  total,
  items,
  loading = false,
}: {
  total: number
  items: OrderDistributionItem[]
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card animate-pulse space-y-3">
        <div className="h-4 w-36 rounded bg-bw-sunken" />
        <div className="h-3 w-full rounded-full bg-bw-sunken" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="h-6 rounded bg-bw-sunken" />
          <div className="h-6 rounded bg-bw-sunken" />
          <div className="h-6 rounded bg-bw-sunken" />
          <div className="h-6 rounded bg-bw-sunken" />
        </div>
      </div>
    )
  }

  const nonZeroItems = items.filter((item) => item.count > 0)

  return (
    <section
      aria-label="توزيع حالات الطلبات"
      className="rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-bw-ink">توزيع حالات الطلبات</h3>
        <span className="text-xs text-bw-ink-subtle">
          الإجمالي: <Code className="font-semibold text-bw-ink">{total.toLocaleString('en-US')}</Code> طلب
        </span>
      </div>

      {/* Segmented Bar */}
      <div
        className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-bw-sunken"
        role="img"
        aria-label="شريط توزيع حالات الطلبات"
      >
        {total === 0 ? (
          <div className="h-full w-full bg-bw-sunken" />
        ) : (
          nonZeroItems.map((item) => (
            <div
              key={item.status}
              className={`${STATUS_META[item.status].barClass} h-full transition-all duration-300 border-e border-bw-surface last:border-e-0`}
              style={{ width: `${Math.max(item.percentage, 1.5)}%` }}
              title={`${STATUS_META[item.status].label}: ${item.count} (${item.percentage}%)`}
            />
          ))
        )}
      </div>

      {/* Compact clickable status legend */}
      {total === 0 ? (
        <p className="mt-3 text-xs text-bw-ink-subtle">لا توجد طلبات مسجلة حتى الآن.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map((item) => {
            const meta = STATUS_META[item.status]
            return (
              <Link
                key={item.status}
                href={item.href}
                className={`inline-flex items-center gap-1.5 rounded-bw-field border border-bw-line bg-bw-sunken/60 px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-bw-sunken ${meta.hoverClass} ${
                  item.count === 0 ? 'opacity-75 hover:opacity-100' : ''
                }`}
              >
                <span className={`size-2 rounded-full shrink-0 ${meta.dotClass}`} aria-hidden />
                <span className="text-bw-ink-soft">{meta.label}</span>
                <Code className="font-semibold text-bw-ink">{item.count}</Code>
                <span className="text-[11px] text-bw-ink-subtle">
                  (<Code>{item.percentage}%</Code>)
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
