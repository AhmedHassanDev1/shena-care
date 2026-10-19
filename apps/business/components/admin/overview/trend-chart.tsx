'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface ChartPoint {
  time: string
  displayTime: string
  current: number
  previous: number
  rate: number
}

export function OrderFlowChart({ timeRange }: { timeRange: 'today' | '7d' | '30d' }) {
  const [activeIdx, setActiveIdx] = React.useState<number>(8)
  const [showComparison, setShowComparison] = React.useState<boolean>(true)

  const dataset = React.useMemo(() => {
    if (timeRange === '7d') {
      const data: ChartPoint[] = [
        { time: 'السبت', displayTime: 'السبت، 10 أكتوبر', current: 180, previous: 165, rate: 93 },
        { time: 'الأحد', displayTime: 'الأحد، 11 أكتوبر', current: 210, previous: 190, rate: 94 },
        { time: 'الإثنين', displayTime: 'الإثنين، 12 أكتوبر', current: 245, previous: 220, rate: 95 },
        { time: 'الثلاثاء', displayTime: 'الثلاثاء، 13 أكتوبر', current: 220, previous: 215, rate: 91 },
        { time: 'الأربعاء', displayTime: 'الأربعاء، 14 أكتوبر', current: 275, previous: 240, rate: 96 },
        { time: 'الخميس', displayTime: 'الخميس، 15 أكتوبر', current: 310, previous: 280, rate: 97 },
        { time: 'الجمعة', displayTime: 'الجمعة، 16 أكتوبر', current: 244, previous: 232, rate: 94 },
      ]
      return {
        data,
        title: 'تدفق الطلبات اليومي (آخر 7 أيام)',
        subtitle: 'مقارنة بالأسبوع السابق لنفس الأيام في القاهرة والجيزة',
        total: 1684,
        avg: '240.5 طلب / يوم',
        peak: 'الخميس (310 طلب)',
        deltaPct: '+14.8%',
        cmpLabel: 'مقارنة بالأسبوع السابق',
      }
    }
    if (timeRange === '30d') {
      const data: ChartPoint[] = [
        { time: 'أسبوع 1', displayTime: '1 - 7 أكتوبر', current: 1580, previous: 1420, rate: 93 },
        { time: 'أسبوع 2', displayTime: '8 - 14 أكتوبر', current: 1720, previous: 1510, rate: 94 },
        { time: 'أسبوع 3', displayTime: '15 - 21 أكتوبر', current: 1890, previous: 1640, rate: 95 },
        { time: 'أسبوع 4', displayTime: '22 - 28 أكتوبر', current: 1930, previous: 1680, rate: 96 },
      ]
      return {
        data,
        title: 'تدفق الطلبات الأسبوعي (آخر 30 يوم)',
        subtitle: 'مقارنة بالشهر السابق في كافة قطاعات القاهرة والجيزة',
        total: 7120,
        avg: '1,780 طلب / أسبوع',
        peak: 'أسبوع 4 (1,930 طلب)',
        deltaPct: '+18.2%',
        cmpLabel: 'مقارنة بالشهر السابق',
      }
    }
    // Default: 'today'
    const data: ChartPoint[] = [
      { time: '00:00', displayTime: '12:00 ص', current: 4, previous: 5, rate: 90 },
      { time: '02:00', displayTime: '02:00 ص', current: 2, previous: 3, rate: 85 },
      { time: '04:00', displayTime: '04:00 ص', current: 3, previous: 2, rate: 88 },
      { time: '06:00', displayTime: '06:00 ص', current: 8, previous: 6, rate: 92 },
      { time: '08:00', displayTime: '08:00 ص', current: 18, previous: 14, rate: 94 },
      { time: '10:00', displayTime: '10:00 ص', current: 26, previous: 22, rate: 95 },
      { time: '12:00', displayTime: '12:00 م', current: 34, previous: 28, rate: 96 },
      { time: '14:00', displayTime: '02:00 م', current: 31, previous: 29, rate: 93 },
      { time: '16:00', displayTime: '04:00 م', current: 42, previous: 33, rate: 96 },
      { time: '18:00', displayTime: '06:00 م', current: 24, previous: 18, rate: 94 },
      { time: '20:00', displayTime: '08:00 م', current: 15, previous: 10, rate: 95 },
      { time: '22:00', displayTime: '10:00 م', current: 7, previous: 2, rate: 92 },
    ]
    return {
      data,
      title: 'تدفق الطلبات بالساعات (اليوم)',
      subtitle: 'مقارنة بساعات الأمس في قطاعي القاهرة والجيزة',
      total: 214,
      avg: '285.50 ج.م / طلب',
      peak: '04:00 م (42 طلب)',
      deltaPct: '+24.4%',
      cmpLabel: 'مقارنة بالأمس',
    }
  }, [timeRange])

  const chartData = dataset.data
  const maxVal = Math.max(...chartData.map((d) => Math.max(d.current, d.previous))) * 1.15 || 50
  const width = 800
  const height = 220
  const padLeft = 40
  const padRight = 30
  const padTop = 20
  const padBottom = 35
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom

  const points = chartData.map((d, i) => {
    const x = padLeft + (i / (chartData.length - 1)) * plotWidth
    const y = padTop + plotHeight - (d.current / maxVal) * plotHeight
    return { x, y }
  })

  const cmpPoints = chartData.map((d, i) => {
    const x = padLeft + (i / (chartData.length - 1)) * plotWidth
    const y = padTop + plotHeight - (d.previous / maxVal) * plotHeight
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
  const cmpLineD = getBezier(cmpPoints)
  const areaD = `${lineD} L ${points[points.length - 1].x.toFixed(1)} ${padTop + plotHeight} L ${points[0].x.toFixed(1)} ${padTop + plotHeight} Z`

  const safeIdx = Math.min(activeIdx, chartData.length - 1)
  const activeData = chartData[safeIdx] || chartData[0]
  const activePt = points[safeIdx] || points[0]

  return (
    <div className="sc-trend">
      <div className="sc-trend-tools flex flex-wrap items-center justify-between gap-3 mb-2">
        <div>
          <h2 className="sc-card-title">{dataset.title}</h2>
          <p className="sc-caption mt-0.5">{dataset.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => setShowComparison(!showComparison)}
          className="sc-btn sm cursor-pointer"
          aria-pressed={showComparison}
        >
          <span className={cn('sc-sw cmp', !showComparison && 'opacity-40')} />
          <span>{dataset.cmpLabel}</span>
        </button>
      </div>

      <div className="sc-chart-wrap relative mt-2">
        {/* Floating Tooltip */}
        <div
          className="sc-tip on"
          style={{
            top: `${Math.max(10, activePt.y - 65)}px`,
            left: `${Math.max(10, Math.min(activePt.x - 70, plotWidth - 110))}px`,
          }}
        >
          <div className="text-[11px] font-semibold text-[#f4f4f5]">{activeData.displayTime}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="sc-num text-sm font-bold text-[#34d27b]">{activeData.current} طلب</span>
            <span className="text-[11px] text-[#a1a1aa] font-mono">
              ({activeData.current >= activeData.previous ? '+' : ''}{activeData.current - activeData.previous} طلب)
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-[#82828c] border-t border-white/[0.08] pt-1">
            <span>نسبة استكمال المرحلة:</span>
            <span className="font-semibold text-emerald-400">{activeData.rate}%</span>
          </div>
        </div>

        {/* SVG Graphic */}
        <div className="sc-chart">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
            <defs>
              <linearGradient id="order-glow-area-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d27b" stopOpacity="0.28" />
                <stop offset="60%" stopColor="#34d27b" stopOpacity="0.06" />
                <stop offset="100%" stopColor="#34d27b" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Gridlines */}
            <g className="grid">
              <line x1={padLeft} y1={padTop} x2={width - padRight} y2={padTop} />
              <line x1={padLeft} y1={padTop + plotHeight * 0.33} x2={width - padRight} y2={padTop + plotHeight * 0.33} />
              <line x1={padLeft} y1={padTop + plotHeight * 0.66} x2={width - padRight} y2={padTop + plotHeight * 0.66} />
              <line x1={padLeft} y1={padTop + plotHeight} x2={width - padRight} y2={padTop + plotHeight} />
            </g>

            {/* Area Fill */}
            <path d={areaD} fill="url(#order-glow-area-grad)" />

            {/* Comparison Line */}
            {showComparison && <path d={cmpLineD} className="line-cmp" />}

            {/* Main Green Line */}
            <path d={lineD} className="line" />

            {/* Active Vertical Guideline */}
            <line
              x1={activePt.x}
              y1={padTop}
              x2={activePt.x}
              y2={padTop + plotHeight}
              className="focus-line"
            />

            {/* Active Dot */}
            <circle cx={activePt.x} cy={activePt.y} r="5" className="focus-dot" />

            {/* Interactive Circles */}
            {chartData.map((d, i) => (
              <circle
                key={i}
                cx={points[i].x}
                cy={points[i].y}
                r="16"
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => setActiveIdx(i)}
              />
            ))}

            {/* X-Axis Ticks */}
            {chartData.map((d, i) => (
              <text
                key={i}
                x={points[i].x}
                y={padTop + plotHeight + 20}
                textAnchor="middle"
                className={cn('tick-x text-[11px]', i === safeIdx && 'fill-[#34d27b] font-bold')}
              >
                {d.time}
              </text>
            ))}
          </svg>
        </div>
      </div>

      {/* Chart Footer with Metrics */}
      <div className="sc-chart-foot grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-white/[0.08] mt-2">
        <div className="sc-foot-block">
          <span className="lbl text-xs text-bw-ink-subtle block">إجمالي طلبات الفترة</span>
          <div className="sc-foot-val flex items-baseline gap-1.5 mt-0.5">
            <span className="sc-num font-bold text-base text-white">{dataset.total.toLocaleString('en-US')}</span>
            <span className="sc-kdelta t-success text-xs font-mono">{dataset.deltaPct}</span>
          </div>
        </div>

        <div className="sc-foot-block">
          <span className="lbl text-xs text-bw-ink-subtle block">معدل الطلب</span>
          <div className="sc-foot-val mt-0.5">
            <span className="text-xs font-semibold text-white">{dataset.avg}</span>
          </div>
        </div>

        <div className="sc-foot-block">
          <span className="lbl text-xs text-bw-ink-subtle block">ذروة التدفق</span>
          <div className="sc-foot-val mt-0.5">
            <span className="sc-num text-xs font-bold text-[#34d27b]">{dataset.peak}</span>
          </div>
        </div>

        <div className="sc-foot-range text-[11px] text-[#a1a1aa] flex items-center justify-end">
          تحديث تشغيلي مستمر · القاهرة والجيزة
        </div>
      </div>
    </div>
  )
}
