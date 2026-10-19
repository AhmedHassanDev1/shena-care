'use client'

import * as React from 'react'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Sparkline({
  color,
  data,
  height = 84,
}: {
  color: string
  data: number[]
  height?: number
}) {
  const width = 160
  const padding = 6
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((val, idx) => {
    const x = padding + (idx / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - ((val - min) / range) * (height - padding * 2)
    return { x, y }
  })

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
  const gradientId = `spark-grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <div className="sc-spark">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradientId})`} />
        <path d={pathD} className="s-line" stroke={color} />
      </svg>
    </div>
  )
}

export function OverviewKpiCard({
  title,
  subtitle,
  value,
  trendText,
  trendPositive,
  comparisonLabel,
  colorClass,
  sparkColor,
  sparkData,
  valueColorClass,
}: {
  title: string
  subtitle: string
  value: string | number
  trendText: string
  trendPositive?: boolean
  comparisonLabel: string
  colorClass: string
  sparkColor: string
  sparkData: number[]
  valueColorClass?: string
}) {
  return (
    <div className={cn('sc-kpi', colorClass)}>
      <div className="sc-kpi-title">{title}</div>
      <div className="sc-kpi-sub">{subtitle}</div>
      <div className="sc-kpi-value">
        <span className={cn('sc-num', valueColorClass || 'text-white')}>{value}</span>
      </div>
      <div className="sc-kpi-foot">
        <span className={cn('sc-kdelta', trendPositive ? 't-success' : 't-danger')}>
          <span className="sc-num font-mono">{trendText}</span>
        </span>
        <span className="sc-caption">{comparisonLabel}</span>
      </div>
      <Sparkline color={sparkColor} data={sparkData} />
    </div>
  )
}
