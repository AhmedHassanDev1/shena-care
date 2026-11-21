'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * Area/line chart for one real series. No decoration: a flat or empty series renders words, not a line.
 * Mirrored for RTL (oldest on the inline-start side), keyboard and pointer readable, with a table for screen readers.
 */

export type TrendPoint = { key: string; label: string; short: string; value: number }

const DEFAULT_HEIGHT = 160
/* Axis labels live on the inline-start (right) edge; the plot is mirrored so the oldest point is nearest them. */
const PAD = { top: 14, bottom: 26, left: 14, right: 40 }

function niceMax(max: number) {
  if (max <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(max))
  const n = max / pow
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((candidate) => n <= candidate) ?? 10
  return step * pow
}

function smooth(pts: Array<[number, number]>) {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const t = 0.18
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t]
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t]
    // Keep the curve inside the plot: a control point never dips below a neighbouring value.
    const lo = Math.max(p1[1], p2[1])
    const hi = Math.min(p1[1], p2[1])
    c1[1] = Math.min(lo, Math.max(hi, c1[1]))
    c2[1] = Math.min(lo, Math.max(hi, c2[1]))
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

export function TrendChart({ points, formatValue, formatAxis, ariaLabel, emptyLabel, tone = 'cobalt', height = DEFAULT_HEIGHT }: {
  points: TrendPoint[]
  formatValue: (value: number) => string
  formatAxis?: (value: number) => string
  ariaLabel: string
  emptyLabel: string
  tone?: 'cobalt' | 'emerald'
  height?: number
}) {
  const HEIGHT = height
  const wrap = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(320)
  const [active, setActive] = React.useState<number | null>(null)
  const uid = React.useId().replace(/:/g, '')

  React.useEffect(() => {
    const node = wrap.current
    if (!node) return
    const update = () => {
      const w = node.getBoundingClientRect().width
      if (w > 0) setWidth(Math.max(240, Math.round(w)))
    }
    update()
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) {
        setWidth(Math.max(240, Math.round(entry.contentRect.width)))
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const total = points.reduce((sum, point) => sum + point.value, 0)
  if (points.length === 0) {
    return <p style={{ height: Math.min(height, 160) }} className="grid place-items-center text-center text-bw-small text-bw-ink-subtle">{emptyLabel}</p>
  }

  const isAllZero = total === 0
  const color = tone === 'emerald' ? 'var(--color-bw-emerald)' : 'var(--color-bw-cobalt)'
  const max = niceMax(Math.max(...points.map((p) => p.value), 0))
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  // Mirrored: index 0 (oldest) sits on the inline-start (right) side.
  const x = (i: number) => (points.length === 1 ? PAD.left + plotW / 2 : width - PAD.right - (i / (points.length - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH
  const coords = points.map((p, i): [number, number] => [x(i), y(p.value)])
  const line = smooth(coords)
  const area = `${line} L${coords[coords.length - 1][0]},${PAD.top + plotH} L${coords[0][0]},${PAD.top + plotH} Z`
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const labelEvery = Math.ceil(points.length / Math.max(2, Math.floor(plotW / 64)))
  const axis = formatAxis ?? ((v: number) => String(v))
  const showDots = points.length <= 14

  const move = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect()
    if (!rect) return
    let best = 0
    let dist = Infinity
    coords.forEach(([cx], i) => {
      const d = Math.abs(rect.left + cx - clientX)
      if (d < dist) { dist = d; best = i }
    })
    setActive(best)
  }
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Escape') return
    event.preventDefault()
    if (event.key === 'Escape') return setActive(null)
    const next = (active ?? (event.key === 'ArrowLeft' ? points.length - 1 : 0)) + (event.key === 'ArrowLeft' ? 1 : -1)
    setActive(Math.min(points.length - 1, Math.max(0, next)))
  }

  const current = active === null ? null : points[active]
  const isLatestPoint = active === points.length - 1
  const tipLeft = active === null ? 0 : Math.min(width - 165, Math.max(10, coords[active][0] - 80))

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden">
      <div
        ref={wrap}
        className="relative w-full max-w-full overflow-hidden touch-pan-y outline-none focus-visible:rounded-bw-field focus-visible:ring-2 focus-visible:ring-bw-focus/60"
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(e) => move(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        dir="ltr"
      >
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block w-full max-w-full overflow-hidden"
          style={{ width: '100%', maxWidth: '100%', height: HEIGHT }}
          aria-hidden
        >
          <defs>
            <linearGradient id={`a${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right + 8}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? 'var(--color-bw-veil-4)' : 'var(--color-bw-veil-2)'}
                strokeDasharray={t === 0 ? undefined : '3 5'}
              />
              <text x={width - 2} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--color-bw-ink-subtle)" className="tabular-nums font-mono">{axis(t)}</text>
            </g>
          ))}
          <path d={area} fill={`url(#a${uid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {showDots ? coords.map(([cx, cy], i) => (
            <circle
              key={points[i].key}
              cx={cx}
              cy={cy}
              r={points[i].value > 0 ? 2.5 : 2}
              fill={points[i].value > 0 ? 'var(--color-bw-surface)' : 'var(--color-bw-page)'}
              stroke={points[i].value > 0 ? color : 'var(--color-bw-line-field)'}
              strokeWidth="1.5"
            />
          )) : null}
          {points.map((p, i) => {
            const isFirst = i === 0
            const isLast = i === points.length - 1
            const isInterval = i % labelEvery === 0
            if (!isFirst && !isLast && isInterval && (points.length - 1 - i < labelEvery * 0.6)) return null
            if (!isFirst && !isLast && !isInterval) return null
            return (
              <text
                key={p.key}
                x={coords[i][0]}
                y={HEIGHT - 7}
                textAnchor="middle"
                fontSize="10.5"
                fill={isLast ? 'var(--color-bw-ink)' : 'var(--color-bw-ink-subtle)'}
                fontWeight={isLast ? '600' : 'normal'}
              >
                {p.short}
              </text>
            )
          })}
          {active !== null ? (
            <g>
              <line x1={coords[active][0]} x2={coords[active][0]} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-bw-veil-4)" strokeDasharray="2 3" />
              <circle cx={coords[active][0]} cy={coords[active][1]} r="4.5" fill={color} stroke="var(--color-bw-page)" strokeWidth="2" />
            </g>
          ) : null}
        </svg>
        {isAllZero ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-full border border-bw-line bg-bw-surface/90 px-3.5 py-1 text-bw-small text-bw-ink-subtle shadow-bw-card">
              {emptyLabel}
            </span>
          </div>
        ) : null}
        {current ? (
          <div
            dir="rtl"
            className={cn('bw-glass-raised pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-bw-field px-3 py-2 text-bw-small shadow-bw-card')}
            style={{ left: tipLeft }}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-bw-ink-soft">
              <span className={cn('size-1.5 rounded-full shrink-0', tone === 'emerald' ? 'bg-bw-emerald' : 'bg-bw-cobalt')} />
              <span className="font-medium truncate">{current.label}</span>
              <span className="text-bw-ink-subtle">({current.short})</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="font-bold tabular-nums text-bw-ink text-sm sm:text-base">
                {formatValue(current.value)}
              </span>
              {isLatestPoint && points.length > 1 ? (
                <span className="rounded bg-bw-veil-3 px-1.5 py-0.5 text-[9px] font-semibold text-bw-ink-subtle">
                  اليوم (حتى الآن)
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {points.map((p) => <tr key={p.key}><th scope="row">{p.label} {p.short}</th><td>{formatValue(p.value)}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}
