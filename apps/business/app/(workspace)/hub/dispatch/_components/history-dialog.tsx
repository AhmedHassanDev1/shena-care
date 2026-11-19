'use client'

import * as React from 'react'
import { Skeleton, StateBlock } from '@/components/bw/primitives'
import { CopyId } from '@/components/workspace/copy-id'
import { Egp } from '@/components/workspace/kit'
import { ResponsiveDialog } from '@/components/workspace/responsive-dialog'
import { LoadError } from '@/components/workspace/role-shell'
import { formatDateTime, shortId } from '@/lib/labels'
import { tripCounts, tripRef, type Run } from '@/lib/trip-ops'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { Disclosure } from './trip-ui'
import type { SettleTarget } from './settlement-dialog'

interface PastBatch {
  id: string
  reference: string
  courierId: string
  totalExpected: string
  totalCollected: string
  settledAt: string
}

interface BatchDetail {
  lines: Array<{ orderId: string; orderNumber?: string; expectedAmount: string }>
}

/** سجل المشاوير: closed trips (read-only summaries) and, secondarily, the cash counts that were recorded. */
export function HistoryDialog({
  hubId,
  courierName,
  onOpenTrip,
  onClose,
}: {
  hubId: string
  courierName: Map<string, string>
  onOpenTrip: (target: SettleTarget) => void
  onClose: () => void
}) {
  const [view, setView] = React.useState<'trips' | 'counts'>('trips')
  const runs = useApi<{ items: Run[] }>(`/fulfillment/locations/${hubId}/runs?status=completed&take=50`)
  const batches = useApi<{ items: PastBatch[] }>(view === 'counts' ? `/ordering/settlements/batches?locationId=${hubId}&take=50` : null)

  return (
    <ResponsiveDialog title="سجل المشاوير" subtitle="المشاوير المغلقة وتسوياتها" onClose={onClose} width="lg">
      <div className="inline-flex rounded-bw-field border border-bw-line bg-bw-sunken p-0.5 text-bw-small" role="group" aria-label="عرض السجل">
        {([['trips', 'المشاوير'], ['counts', 'تسويات النقدية']] as const).map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => setView(key)}
            className={cn('min-h-9 cursor-pointer rounded-bw-field px-3 font-medium transition-colors', view === key ? 'bg-bw-surface text-bw-ink shadow-bw-card' : 'text-bw-ink-soft hover:text-bw-ink')}
          >
            {text}
          </button>
        ))}
      </div>

      {view === 'trips' ? (
        runs.loading && !runs.data ? (
          <Skeleton className="h-32 w-full rounded-bw-card" />
        ) : runs.error ? (
          <LoadError message={runs.error.message} onRetry={runs.reload} />
        ) : (runs.data?.items ?? []).length === 0 ? (
          <StateBlock kind="empty" title="لا توجد مشاوير مغلقة بعد" body="تظهر هنا المشاوير بعد تسوية نقديتها واستلام مرتجعاتها." />
        ) : (
          <ul className="divide-y divide-bw-line/70">
            {runs.data!.items.map((run) => {
              const counts = tripCounts(run)
              const name = run.driverId ? courierName.get(run.driverId) ?? shortId(run.driverId) : '—'
              const variance = run.settlement?.cash.variance ?? 0
              return (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-bw-body font-semibold text-bw-ink">{name}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-bw-ink-subtle">
                      <CopyId value={run.id} display={tripRef(run.id)} label="رقم المشوار" muted />
                      <span>{formatDateTime(run.completedAt)}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-bw-small text-bw-ink-soft">
                    <span><span className="font-semibold tabular-nums text-bw-ink">{counts.delivered}</span>/{counts.total} تم التسليم</span>
                    {run.settlement && run.settlement.cash.codOrders > 0 ? <Egp value={run.settlement.cash.countedTotal} className="font-semibold text-bw-ink" /> : <span>بدون تحصيل</span>}
                    {variance !== 0 ? (
                      <span className={variance < 0 ? 'text-bw-danger' : 'text-bw-warn'}>{variance < 0 ? 'عجز' : 'زيادة'} {Math.abs(variance).toLocaleString('en-US')}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onOpenTrip({ courierId: run.driverId ?? '', courierName: name, runId: run.id })}
                      className="min-h-9 cursor-pointer rounded-bw-field px-2 font-semibold text-bw-ink underline-offset-2 hover:underline"
                    >
                      الملخص
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      ) : batches.loading && !batches.data ? (
        <Skeleton className="h-32 w-full rounded-bw-card" />
      ) : batches.error ? (
        <LoadError message={batches.error.message} onRetry={batches.reload} />
      ) : (batches.data?.items ?? []).length === 0 ? (
        <StateBlock kind="empty" title="لا توجد تسويات مسجلة" />
      ) : (
        <ul className="divide-y divide-bw-line/70">
          {batches.data!.items.map((b) => (
            <BatchRow key={b.id} batch={b} courier={courierName.get(b.courierId) ?? shortId(b.courierId)} />
          ))}
        </ul>
      )}
    </ResponsiveDialog>
  )
}

function BatchRow({ batch, courier }: { batch: PastBatch; courier: string }) {
  const [open, setOpen] = React.useState(false)
  const detail = useApi<BatchDetail>(open ? `/ordering/settlements/batches/${batch.id}` : null)
  const diff = Math.round((Number(batch.totalCollected) - Number(batch.totalExpected)) * 100) / 100
  return (
    <li className="space-y-1 py-2.5 text-bw-small">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold text-bw-ink">{courier}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-bw-ink-subtle">
            <CopyId value={batch.reference} label="مرجع التسوية" muted />
            <span>{formatDateTime(batch.settledAt)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3 text-bw-ink-soft">
          <Egp value={batch.totalCollected} className="font-semibold text-bw-ink" />
          {diff === 0 ? <span className="text-bw-emerald">مطابق</span> : <span className={diff < 0 ? 'text-bw-danger' : 'text-bw-warn'}>{diff < 0 ? 'عجز' : 'زيادة'} {Math.abs(diff).toLocaleString('en-US')}</span>}
        </div>
      </div>
      <Disclosure label="الطلبات" open={open} onToggle={() => setOpen((v) => !v)}>
        {!detail.data && !detail.error ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <ul className="divide-y divide-bw-line/70">
            {(detail.data?.lines ?? []).map((l) => (
              <li key={l.orderId} className="flex items-center justify-between py-1.5">
                <CopyId value={l.orderNumber ?? l.orderId} display={l.orderNumber ?? shortId(l.orderId)} label="رقم الطلب" className="font-semibold text-bw-ink" />
                <Egp value={l.expectedAmount} className="text-bw-ink-soft" />
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </li>
  )
}
