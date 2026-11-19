'use client'

import * as React from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  History,
  MapPin,
  Package,
  XCircle,
} from 'lucide-react'
import { Code, Skeleton, StateBlock } from '@/components/bw/primitives'
import { CopyId } from '@/components/workspace/copy-id'
import { Egp } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { FAILURE_REASONS, formatDateTime } from '@/lib/labels'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

interface HistoryItem {
  stopId: string
  outcome: string
  closedAt: string | null
  orderNumber: string | null
  area: string | null
  reasonCode: string | null
  cashDeclared: number | null
}

/**
 * Driver Closed Attempts History — سجل المشاوير والتسليمات السابقة
 * Mobile-first visual history cards with clear color-coding and minimal text.
 */
export default function DriverHistory() {
  const { data, error, loading, reload } = useApi<{ total: number; items: HistoryItem[] }>(
    '/fulfillment/driver/history?take=50'
  )

  const items = data?.items ?? []
  const deliveredCount = items.filter((h) => h.outcome === 'delivered').length
  const failedCount = items.filter((h) => h.outcome !== 'delivered').length

  return (
    <RoleShell role="driver" active="history" mode="mobile">
      <div className="space-y-3.5 p-3 sm:p-4 pb-24 max-w-lg mx-auto">
        {/* Title */}
        <div>
          <h1 className="font-bw-display text-xl sm:text-2xl font-bold text-bw-ink flex items-center gap-2">
            <History className="size-5 text-bw-cobalt" aria-hidden />
            <span>السجل</span>
          </h1>
          <p className="text-xs text-bw-ink-soft mt-0.5">
            الطلبات التي تم إغلاقها أو تسويتها
          </p>
        </div>

        {error ? <LoadError message={error.message} onRetry={reload} /> : null}

        {/* Quick Summary Pill Bar */}
        {items.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-center">
              <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />
              <span className="text-xs text-emerald-300 font-bold">
                تم تسليمها: {deliveredCount}
              </span>
            </div>
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-950/20 p-2.5 text-center">
              <XCircle className="size-4 text-rose-400" aria-hidden />
              <span className="text-xs text-rose-300 font-bold">
                تعذر / مرتجع: {failedCount}
              </span>
            </div>
          </div>
        ) : null}

        {!data && loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ) : null}

        {data && items.length === 0 ? (
          <StateBlock
            kind="empty"
            title="لسه مافيش محاولات مقفولة"
            body="أول ما تسلّم طلبات أو تسجّل مرتجعات هتظهر هنا في السجل تلقائياً."
          />
        ) : null}

        {/* Visual History Cards */}
        <div className="space-y-2.5">
          {items.map((h) => {
            const isDelivered = h.outcome === 'delivered'

            return (
              <div
                key={h.stopId}
                className={cn(
                  'rounded-2xl border bg-bw-surface p-3.5 space-y-2 shadow-sm transition-all',
                  isDelivered ? 'border-emerald-500/30' : 'border-rose-500/30'
                )}
              >
                {/* Header: Order ID + Status badge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-bw-ink-soft">
                    <span className="font-mono text-xs font-semibold">
                      #{h.orderNumber ? h.orderNumber.replace(/^ORD-/, '').slice(0, 8) : '—'}
                    </span>
                    {h.orderNumber ? <CopyId value={h.orderNumber} muted className="text-[11px]" /> : null}
                  </div>

                  {isDelivered ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      اتسلّم
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold bg-rose-950/60 text-rose-400 border border-rose-500/30">
                      <XCircle className="size-3.5" aria-hidden />
                      تعذر التسليم
                    </span>
                  )}
                </div>

                {/* Outcome Info */}
                <div className="text-xs">
                  {isDelivered && h.cashDeclared !== null ? (
                    <p className="font-semibold text-bw-ink">
                      المبلغ المحصل: <span className="text-emerald-400 font-bold"><Egp value={h.cashDeclared} /></span>
                    </p>
                  ) : !isDelivered && h.reasonCode ? (
                    <p className="font-semibold text-rose-300">
                      السبب: {FAILURE_REASONS[h.reasonCode] ?? h.reasonCode}
                    </p>
                  ) : null}
                </div>

                {/* Footer: Area and Date/Time */}
                <div className="flex items-center justify-between text-[11px] text-bw-ink-subtle pt-1 border-t border-bw-line/40">
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3" aria-hidden />
                    {h.area || 'منطقة التوصيل'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" aria-hidden />
                    {formatDateTime(h.closedAt)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </RoleShell>
  )
}
