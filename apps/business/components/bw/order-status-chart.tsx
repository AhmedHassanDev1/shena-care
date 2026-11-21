'use client'

import * as React from 'react'
import Link from 'next/link'
import { Skeleton } from '@/components/bw/primitives'
import { cn } from '@/lib/utils'
import type { OrderDistributionItem, OrderStatusKey } from '@/app/(workspace)/admin/overview-types'

const STATUS_META: Record<OrderStatusKey, { label: string; bar: string; dot: string; text: string; bgSoft: string }> = {
  placed: {
    label: 'بانتظار التوفير',
    bar: 'bg-bw-amber',
    dot: 'bg-bw-amber',
    text: 'text-bw-amber',
    bgSoft: 'bg-bw-amber-soft',
  },
  confirmed: {
    label: 'تأكد التوفر',
    bar: 'bg-bw-cobalt',
    dot: 'bg-bw-cobalt',
    text: 'text-bw-cobalt',
    bgSoft: 'bg-bw-cobalt-soft',
  },
  packing: {
    label: 'في المخزن',
    bar: 'bg-bw-violet',
    dot: 'bg-bw-violet',
    text: 'text-bw-violet',
    bgSoft: 'bg-bw-violet-soft',
  },
  shipped: {
    label: 'مع المندوب',
    bar: 'bg-bw-cobalt/70',
    dot: 'bg-bw-cobalt/70',
    text: 'text-bw-cobalt',
    bgSoft: 'bg-bw-cobalt-soft',
  },
  delivered: {
    label: 'مكتملة',
    bar: 'bg-bw-emerald',
    dot: 'bg-bw-emerald',
    text: 'text-bw-emerald',
    bgSoft: 'bg-bw-emerald-soft',
  },
  cancelled: {
    label: 'ملغاة',
    bar: 'bg-bw-rose',
    dot: 'bg-bw-rose',
    text: 'text-bw-rose',
    bgSoft: 'bg-bw-rose-soft',
  },
  returned: {
    label: 'مرتجعة',
    bar: 'bg-bw-rose/50',
    dot: 'bg-bw-rose/50',
    text: 'text-bw-rose',
    bgSoft: 'bg-bw-rose-soft',
  },
}

const NATURAL_STATUS_ORDER: OrderStatusKey[] = [
  'placed',
  'confirmed',
  'packing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
]

export interface OrderStatusHorizontalBarChartProps {
  items: OrderDistributionItem[]
  total: number
  rangeLabel: string
  loading?: boolean
}

export function OrderStatusHorizontalBarChart({
  items,
  total,
  rangeLabel,
  loading,
}: OrderStatusHorizontalBarChartProps) {
  const [hoveredStatus, setHoveredStatus] = React.useState<OrderStatusKey | null>(null)

  // Ensure total matches sum of displayed statuses
  const sumCount = React.useMemo(() => {
    return items.reduce((acc, curr) => acc + (curr.count || 0), 0)
  }, [items])

  const displayTotal = total > 0 ? total : sumCount

  // Sort bars by count (highest first)
  const sortedItems = React.useMemo(() => {
    return [...items].sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count
      }
      return NATURAL_STATUS_ORDER.indexOf(a.status) - NATURAL_STATUS_ORDER.indexOf(b.status)
    })
  }, [items])

  const maxCount = React.useMemo(() => {
    return Math.max(...items.map((i) => i.count), 0)
  }, [items])

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between border-b border-bw-line pb-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="space-y-2.5 pt-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0 || displayTotal === 0) {
    return (
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-bw-line pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-bw-body font-semibold text-bw-ink">حالة الطلبات</h2>
            <span className="rounded bg-bw-veil-3 px-1.5 py-0.5 text-[10px] font-medium text-bw-ink-subtle">{rangeLabel}</span>
          </div>
          <span className="text-bw-small text-bw-ink-subtle">لا توجد طلبات</span>
        </div>
        <p className="py-8 text-center text-bw-small text-bw-ink-subtle">مفيش طلبات مسجلة في الفترة دي ({rangeLabel}).</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Header with matching sum */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-bw-line pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-bw-body font-semibold text-bw-ink">حالة الطلبات</h2>
          <span className="rounded bg-bw-veil-3 px-1.5 py-0.5 text-[10px] font-medium text-bw-ink-subtle">{rangeLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 text-bw-small text-bw-ink-soft">
          <span>إجمالي الطلبات:</span>
          <bdi className="bw-code font-bold text-bw-ink">{sumCount}</bdi>
          <span>طلب</span>
        </div>
      </div>

      {/* Horizontal Bar Chart Rows */}
      <ul role="list" className="mt-2 divide-y divide-bw-line/50">
        {sortedItems.map((item) => {
          const meta = STATUS_META[item.status] ?? {
            label: item.status,
            bar: 'bg-bw-cobalt',
            dot: 'bg-bw-cobalt',
            text: 'text-bw-cobalt',
            bgSoft: 'bg-bw-cobalt-soft',
          }

          const sharePercent = displayTotal > 0
            ? ((item.count / displayTotal) * 100).toFixed(1).replace(/\.0$/, '')
            : '0'

          // Relative width scaling based on highest count (maxCount)
          const barWidth = maxCount > 0
            ? Math.max((item.count / maxCount) * 100, item.count > 0 ? 3 : 0)
            : 0

          const isHovered = hoveredStatus === item.status

          return (
            <li key={item.status} className="relative">
              <Link
                href={item.href}
                onMouseEnter={() => setHoveredStatus(item.status)}
                onMouseLeave={() => setHoveredStatus(null)}
                onFocus={() => setHoveredStatus(item.status)}
                onBlur={() => setHoveredStatus(null)}
                className={cn(
                  'bw-row group flex flex-col gap-1.5 rounded-bw-field px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bw-focus/60',
                  isHovered && 'bg-bw-veil-2',
                )}
                title={`${meta.label}: ${item.count} طلب (${sharePercent}%) — انقر للتصفية في صفحة الطلبات`}
              >
                {/* Status label, count, and percentage */}
                <div className="flex items-center justify-between gap-3 text-bw-small">
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden
                      className={cn(
                        'size-2 shrink-0 rounded-full transition-transform duration-150',
                        item.count === 0 ? 'bg-bw-line-field' : meta.dot,
                        isHovered && 'scale-125',
                      )}
                    />
                    <span className={cn('truncate font-medium', item.count === 0 ? 'text-bw-ink-subtle' : 'text-bw-ink')}>
                      {meta.label}
                    </span>
                  </span>

                  <div className="flex items-center gap-2 shrink-0 tabular-nums">
                    <span className={cn('font-semibold', item.count === 0 ? 'text-bw-ink-subtle' : 'text-bw-ink')}>
                      <bdi className="bw-code">{item.count}</bdi>
                    </span>
                    <span className="text-[11px] text-bw-ink-subtle">
                      ({sharePercent}%)
                    </span>
                  </div>
                </div>

                {/* Horizontal bar track and fill */}
                <div className="relative h-2 sm:h-2.5 w-full overflow-hidden rounded-full bg-bw-veil-3">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-500 ease-out',
                      item.count === 0 ? 'bg-transparent' : meta.bar,
                      isHovered && 'brightness-110 shadow-bw-sheen',
                    )}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </Link>

              {/* Informative Floating Tooltip on Hover / Focus */}
              {isHovered && (
                <div
                  role="tooltip"
                  className="bw-glass-raised pointer-events-none absolute -top-8 start-1/2 -translate-x-1/2 z-20 whitespace-nowrap rounded-bw-field px-2.5 py-1 text-[11px] text-bw-ink shadow-bw-card animate-in fade-in zoom-in-95 duration-150 max-w-[calc(100vw-2rem)] truncate"
                >
                  <span className="font-semibold">{meta.label}: </span>
                  <span><bdi className="bw-code">{item.count}</bdi> طلب ({sharePercent}%) · اضغط للتصفية</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
