'use client'

import * as React from 'react'
import type { ActivityChartPoint } from './overview-types'

/* ── Compact Real-Data Sparkline ─────────────────────────────────────── */

export function Sparkline({
  data,
  className = '',
}: {
  data: number[]
  className?: string
}) {
  const color = 'currentColor'
  const width = 80
  const height = 28
  const padding = 3

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
      <div className={`w-20 h-7 flex items-center text-bw-ink-subtle ${className}`}>
        <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
          <line
            x1="2"
            y1={height / 2}
            x2={width - 2}
            y2={height / 2}
            stroke={color}
            strokeWidth="1.5"
            strokeDasharray="3 3"
            strokeOpacity="0.4"
          />
          <circle cx={width - 2} cy={height / 2} r="2" fill={color} opacity="0.5" />
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

  // Build SVG path
  let pathD = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const midX = (prev.x + curr.x) / 2
    pathD += ` C ${midX.toFixed(1)},${prev.y.toFixed(1)} ${midX.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`
  }

  const lastPoint = points[points.length - 1]

  return (
    <div className={`w-20 h-7 text-bw-ink-soft ${className}`}>
      <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="2.5" fill={color} />
      </svg>
    </div>
  )
}

/* ── Interactive Orders Activity Chart ───────────────────────────────── */

export function OrdersActivityChart({
  series,
  days,
  onDaysChange,
}: {
  series: ActivityChartPoint[]
  days: number
  onDaysChange: (d: number) => void
}) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)

  const width = 700
  const height = 180
  const paddingX = 30
  const paddingTop = 25
  const paddingBottom = 25
  const plotWidth = width - 2 * paddingX
  const plotHeight = height - paddingTop - paddingBottom

  const hasData = series && series.length > 0
  const maxCreated = hasData ? Math.max(...series.map((s) => s.created), 0) : 0
  const maxDelivered = hasData ? Math.max(...series.map((s) => s.delivered), 0) : 0
  const maxVal = Math.max(maxCreated, maxDelivered, 4)

  const pointsCreated: Array<{ x: number; y: number; val: number }> = []
  const pointsDelivered: Array<{ x: number; y: number; val: number }> = []

  if (hasData) {
    const len = series.length
    for (let i = 0; i < len; i++) {
      const x = paddingX + (i / Math.max(len - 1, 1)) * plotWidth
      const yCreated = height - paddingBottom - (series[i].created / maxVal) * plotHeight
      const yDelivered = height - paddingBottom - (series[i].delivered / maxVal) * plotHeight
      pointsCreated.push({ x, y: yCreated, val: series[i].created })
      pointsDelivered.push({ x, y: yDelivered, val: series[i].delivered })
    }
  }

  const buildPath = (pts: Array<{ x: number; y: number }>) => {
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

  const pathCreated = buildPath(pointsCreated)
  const pathDelivered = buildPath(pointsDelivered)
  const areaCreated = pointsCreated.length > 0
    ? `${pathCreated} L ${pointsCreated[pointsCreated.length - 1].x.toFixed(1)},${(height - paddingBottom).toFixed(1)} L ${pointsCreated[0].x.toFixed(1)},${(height - paddingBottom).toFixed(1)} Z`
    : ''

  const activeIndex = hoveredIndex !== null && hoveredIndex < series.length ? hoveredIndex : null
  const activePoint = activeIndex !== null ? series[activeIndex] : null
  const activeCreatedPt = activeIndex !== null ? pointsCreated[activeIndex] : null

  return (
    <div className="flex flex-col justify-between rounded-xl border border-bw-line bg-bw-surface p-5 shadow-sm transition-all hover:border-bw-line-field">
      {/* Chart Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-bw-ink tracking-tight">حركة الطلبات اليومية</h2>
          {/* 7 Days / 30 Days Toggle */}
          <div className="flex items-center rounded-lg border border-bw-line bg-bw-page p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onDaysChange(7)}
              className={`px-2.5 py-1 rounded-md transition-colors font-medium ${
                days === 7
                  ? 'bg-bw-sunken text-bw-ink shadow-xs'
                  : 'text-bw-ink-subtle hover:text-bw-ink'
              }`}
            >
              7 أيام
            </button>
            <button
              type="button"
              onClick={() => onDaysChange(30)}
              className={`px-2.5 py-1 rounded-md transition-colors font-medium ${
                days === 30
                  ? 'bg-bw-sunken text-bw-ink shadow-xs'
                  : 'text-bw-ink-subtle hover:text-bw-ink'
              }`}
            >
              30 يوم
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-4 border-t-2 border-bw-ink" />
            <span className="text-bw-ink font-medium">الطلبات الجديدة</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-bw-ink-subtle" />
            <span className="text-bw-ink-subtle">تم التسليم</span>
          </div>
        </div>
      </div>

      <p className="text-xs text-bw-ink-subtle mb-3">مقارنة وتيرة إنشاء الطلبات مقابل المنفذ فعلياً</p>

      {/* SVG Plot Container */}
      <div className="relative w-full h-52 select-none">
        {/* Background Grid Lines */}
        <div className="absolute inset-x-0 top-6 bottom-6 flex flex-col justify-between pointer-events-none">
          <div className="w-full h-px bg-bw-surface" />
          <div className="w-full h-px bg-bw-surface" />
          <div className="w-full h-px bg-bw-surface" />
          <div className="w-full h-px bg-bw-surface" />
        </div>

        {/* Empty state overlay when all numbers are 0 */}
        {hasData && series.every((s) => s.created === 0 && s.delivered === 0) ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-bw-ink-subtle pointer-events-none">
            لا توجد حركة طلبات مسجلة في هذه الفترة
          </div>
        ) : null}

        <svg
          className="w-full h-full overflow-visible"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="chartGradientFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--color-bw-ink)' }} stopOpacity="0.10" />
              <stop offset="100%" style={{ stopColor: 'var(--color-bw-ink)' }} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Area fill for created */}
          {areaCreated ? <path d={areaCreated} fill="url(#chartGradientFade)" /> : null}

          {/* Delivered line */}
          {pathDelivered ? (
            <path
              d={pathDelivered}
              fill="none"
              className="stroke-bw-ink-subtle"
              strokeWidth="1.75"
              strokeDasharray="5 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {/* Created line */}
          {pathCreated ? (
            <path
              d={pathCreated}
              fill="none"
              className="stroke-bw-ink"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {/* Vertical dashed guideline on hover */}
          {activeCreatedPt ? (
            <line
              x1={activeCreatedPt.x}
              y1={paddingTop - 5}
              x2={activeCreatedPt.x}
              y2={height - paddingBottom}
              className="stroke-bw-line-field"
              strokeDasharray="3 3"
              strokeWidth="1.2"
            />
          ) : null}

          {/* Data points */}
          {pointsDelivered.map((pt, idx) => (
            <circle
              key={`del-${idx}`}
              cx={pt.x}
              cy={pt.y}
              r={hoveredIndex === idx ? 4 : 2.5}
              className="fill-bw-surface stroke-bw-ink-subtle transition-all duration-150"
              strokeWidth="2"
            />
          ))}

          {pointsCreated.map((pt, idx) => (
            <circle
              key={`cre-${idx}`}
              cx={pt.x}
              cy={pt.y}
              r={hoveredIndex === idx ? 4.5 : 3}
              className={`stroke-bw-ink transition-all duration-150 ${hoveredIndex === idx ? 'fill-bw-ink' : 'fill-bw-surface'}`}
              strokeWidth="2"
            />
          ))}

          {/* Invisible interactive hover columns */}
          {pointsCreated.map((pt, idx) => {
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
                onMouseLeave={() => setHoveredIndex(null)}
              />
            )
          })}
        </svg>

        {/* Floating Tooltip */}
        {activePoint && activeCreatedPt ? (
          <div
            className="absolute top-2 pointer-events-none z-20 transition-all duration-150"
            style={{
              left: `${(activeCreatedPt.x / width) * 100}%`,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="rounded-lg border border-bw-line bg-bw-sunken px-3 py-2 shadow-bw-overlay min-w-[140px] text-start">
              <div className="flex items-center justify-between border-b border-bw-line pb-1 mb-1.5 text-xs">
                <span className="font-semibold text-bw-ink">{activePoint.dayName}</span>
                <span className="text-[11px] text-bw-ink-subtle font-mono">{activePoint.shortDate}</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-bw-ink-subtle flex items-center gap-1.5">
                    <span aria-hidden className="inline-block w-3 border-t-2 border-bw-ink" />
                    الجديدة:
                  </span>
                  <span className="font-bold text-bw-ink font-mono">{activePoint.created}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-bw-ink-subtle flex items-center gap-1.5">
                    <span aria-hidden className="inline-block w-3 border-t-2 border-dashed border-bw-ink-subtle" />
                    التسليم:
                  </span>
                  <span className="font-bold text-bw-ok font-mono">{activePoint.delivered}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* X-Axis Day Labels */}
      <div className="flex items-center justify-between pt-2 px-6 text-xs text-bw-ink-subtle border-t border-bw-line">
        {hasData
          ? series.map((s, idx) => {
              const isToday = idx === series.length - 1
              // For 30 days show every 4th or 5th label to prevent clutter
              if (days === 30 && idx % 5 !== 0 && !isToday) return <span key={idx} className="w-1" />
              return (
                <span
                  key={idx}
                  className={`transition-colors ${
                    isToday ? 'font-semibold text-bw-ink' : 'hover:text-bw-ink-soft'
                  }`}
                >
                  {days === 30 ? s.shortDate : s.dayName}
                </span>
              )
            })
          : null}
      </div>
    </div>
  )
}
