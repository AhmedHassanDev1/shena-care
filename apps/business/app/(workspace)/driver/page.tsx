'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Package,
  Route,
  Scan,
  Wallet,
  XCircle,
} from 'lucide-react'
import { Button, Code, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { ContinuousHandoffModal } from '@/components/workspace/continuous-handoff-modal'
import { Egp, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { RUN_STATUS, SHIPMENT_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

export interface DriverStop {
  sequence: number
  shipmentId: string
  status: string
  attemptStatus: string
  handedOver: boolean
  orderNumber: string
  recipientName: string
  recipientPhone: string
  governorate: string | null
  area: string | null
  address: string
  deliveryNotes: string | null
  location: { latitude: number; longitude: number; source: string | null; navigationUrl: string } | null
  operatorInstruction: { note: string; reason: string; latitude: number | null; longitude: number | null } | null
  codDue: number
  cashDeclared: number | null
  currency: string
  itemCount: number
}

export interface DriverRun {
  id: string
  status: string
  dispatchedAt: string | null
  stops: DriverStop[]
}

interface HistorySummaryItem {
  stopId: string
  outcome: string
  closedAt: string | null
  orderNumber: string | null
  area: string | null
  reasonCode: string | null
  cashDeclared: number | null
}

type TabFilter = 'all' | 'active' | 'planning' | 'history'

/**
 * Driver Workspace — My Trips (مشاويري)
 * Redesigned for fast, clear mobile operation in real-world delivery conditions.
 */
export default function DriverRoute() {
  const { data, error, loading, reload } = useApi<DriverRun[]>('/fulfillment/driver/runs', { pollMs: 15000 })
  const history = useApi<{ total: number; items: HistorySummaryItem[] }>('/fulfillment/driver/history?take=10', {
    pollMs: 30000,
  })

  const [activeTab, setActiveTab] = React.useState<TabFilter>('all')
  const [scanningRun, setScanningRun] = React.useState<DriverRun | null>(null)

  const runs = data ?? []
  const activeRuns = runs.filter((r) => r.status === 'dispatched')
  const planningRuns = runs.filter((r) => r.status === 'planning')

  const allStops = runs.flatMap((r) => r.stops)
  const openStops = allStops.filter((s) => s.attemptStatus === 'active')
  const totalCodRemaining = openStops.reduce((sum, s) => sum + (s.status !== 'delivered' ? s.codDue : 0), 0)

  // Filter runs based on tab
  const displayedRuns = React.useMemo(() => {
    if (activeTab === 'active') return activeRuns
    if (activeTab === 'planning') return planningRuns
    return runs
  }, [activeTab, runs, activeRuns, planningRuns])

  return (
    <RoleShell role="driver" active="run" mode="mobile" counts={{ run: openStops.length }}>
      <div className="space-y-3.5 p-3 sm:p-4">
        <PageHeader
          title="مشاويري"
          meta={
            openStops.length > 0
              ? `${openStops.length} طرد متبقي للتسليم اليوم`
              : 'جاهز لأي مشاوير جديدة'
          }
        />

        {error ? <LoadError message={error.message} onRetry={reload} /> : null}

        {/* Compact summary metrics bar */}
        {runs.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 rounded-bw-card border border-bw-line bg-bw-surface p-2.5">
            <div className="flex flex-col items-center justify-center border-e border-bw-line px-1 py-0.5 text-center">
              <span className="flex items-center gap-1 text-[11px] text-bw-ink-soft">
                <Route className="size-3 text-bw-ink-subtle" aria-hidden /> المشاوير
              </span>
              <span className="mt-0.5 font-bw-display text-sm font-bold text-bw-ink">
                <Code>{runs.length}</Code>
              </span>
            </div>
            <div className="flex flex-col items-center justify-center border-e border-bw-line px-1 py-0.5 text-center">
              <span className="flex items-center gap-1 text-[11px] text-bw-ink-soft">
                <Package className="size-3 text-bw-ink-subtle" aria-hidden /> متبقي
              </span>
              <span className="mt-0.5 font-bw-display text-sm font-bold text-bw-ink">
                <Code>{openStops.length}</Code>
              </span>
            </div>
            <div className="flex flex-col items-center justify-center px-1 py-0.5 text-center">
              <span className="flex items-center gap-1 text-[11px] text-bw-ink-soft">
                <Wallet className="size-3 text-bw-ink-subtle" aria-hidden /> تحصيل
              </span>
              <span className="mt-0.5 text-xs font-bold text-bw-action-ink truncate max-w-full">
                <Egp value={totalCodRemaining} />
              </span>
            </div>
          </div>
        ) : null}

        {/* Segmented Filter Tabs */}
        <div className="flex items-center gap-1 rounded-bw-field border border-bw-line bg-bw-sunken p-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={cn(
              'flex-1 rounded-bw-field py-1.5 font-semibold transition-colors',
              activeTab === 'all'
                ? 'bg-bw-surface text-bw-ink shadow-bw-card'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            الكل {runs.length > 0 ? <Code>({runs.length})</Code> : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={cn(
              'flex-1 rounded-bw-field py-1.5 font-semibold transition-colors flex items-center justify-center gap-1',
              activeTab === 'active'
                ? 'bg-bw-surface text-bw-ink shadow-bw-card'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            {activeRuns.length > 0 ? (
              <span className="size-1.5 rounded-full bg-bw-emerald animate-pulse" aria-hidden />
            ) : null}
            جاري التوصيل {activeRuns.length > 0 ? <Code>({activeRuns.length})</Code> : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('planning')}
            className={cn(
              'flex-1 rounded-bw-field py-1.5 font-semibold transition-colors',
              activeTab === 'planning'
                ? 'bg-bw-surface text-bw-ink shadow-bw-card'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            بانتظار الاستلام {planningRuns.length > 0 ? <Code>({planningRuns.length})</Code> : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={cn(
              'flex-1 rounded-bw-field py-1.5 font-semibold transition-colors',
              activeTab === 'history'
                ? 'bg-bw-surface text-bw-ink shadow-bw-card'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            المكتملة
          </button>
        </div>

        {/* Loading skeleton */}
        {!data && loading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full rounded-bw-card" />
            <Skeleton className="h-28 w-full rounded-bw-card" />
          </div>
        ) : null}

        {/* Empty state when no runs */}
        {data && data.length === 0 && activeTab !== 'history' ? (
          <StateBlock
            kind="empty"
            title="مافيش مشاوير متعيّنة ليك دلوقتي"
            body="لما المخزن يجهّز مشوار جديد ليك هيظهر هنا تلقائياً."
          />
        ) : null}

        {/* History Tab View */}
        {activeTab === 'history' ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-bw-small text-bw-ink-soft">
              <span>آخر المحاولات المسجلة</span>
              <Link href="/driver/history" className="inline-flex items-center gap-1 font-semibold text-bw-action-ink underline text-xs">
                فتح السجل بالكامل <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </div>
            {history.loading && !history.data ? <Skeleton className="h-32 w-full" /> : null}
            {history.data && history.data.items.length === 0 ? (
              <StateBlock kind="empty" title="لسه مافيش محاولات مقفولة" />
            ) : null}
            <ul className="space-y-2">
              {history.data?.items.map((item) => (
                <li key={item.stopId} className="rounded-bw-card border border-bw-line bg-bw-surface p-3 text-bw-small space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-bw-ink"><Code>{item.orderNumber ?? '—'}</Code></span>
                    <StatusLabel tone={item.outcome === 'delivered' ? 'ok' : 'danger'}>
                      {item.outcome === 'delivered' ? 'تم التسليم' : item.outcome === 'failed' ? 'تعذر التسليم' : 'مرتجع'}
                    </StatusLabel>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-bw-ink-soft">
                    <span>{item.area ?? ''} · {formatDateTime(item.closedAt)}</span>
                    {item.cashDeclared !== null ? (
                      <span className="font-semibold text-bw-ok">تم تحصيل <Egp value={item.cashDeclared} /></span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Active Runs list */}
        {activeTab !== 'history' ? (
          <div className="space-y-3">
            {displayedRuns.map((run) => (
              <CompactRunCard
                key={run.id}
                run={run}
                onStartContinuousScan={(r) => setScanningRun(r)}
              />
            ))}
          </div>
        ) : null}

        {scanningRun ? (
          <ContinuousHandoffModal
            runId={scanningRun.id}
            runTitle={`مشوار #${shortId(scanningRun.id)}`}
            isOpen={Boolean(scanningRun)}
            onClose={() => setScanningRun(null)}
            onComplete={() => {
              reload()
              setScanningRun(null)
            }}
          />
        ) : null}
      </div>
    </RoleShell>
  )
}

/**
 * Compact, high-clarity trip card designed for mobile screens.
 * Uses a subtle green indicator on active trips without overwhelming the screen.
 */
function CompactRunCard({
  run,
  onStartContinuousScan,
}: {
  run: DriverRun
  onStartContinuousScan: (run: DriverRun) => void
}) {
  const isActive = run.status === 'dispatched'
  const isPlanning = run.status === 'planning'

  const totalStops = run.stops.length
  const deliveredCount = run.stops.filter((s) => s.attemptStatus === 'delivered' || s.status === 'delivered').length
  const failedCount = run.stops.filter((s) => s.status === 'failed' || s.attemptStatus === 'failed').length
  const handedCount = run.stops.filter((s) => s.handedOver).length
  const allHanded = totalStops > 0 && handedCount === totalStops

  // Calculate distinct areas covered by this run
  const distinctAreas = Array.from(new Set(run.stops.map((s) => s.area).filter(Boolean))).slice(0, 3)
  const areasSummary = distinctAreas.length > 0 ? distinctAreas.join(' · ') : 'منطقة المشوار'

  // Delivery progress percentage
  const progressPercent = totalStops > 0 ? Math.round(((deliveredCount + failedCount) / totalStops) * 100) : 0

  return (
    <section
      className={cn(
        'rounded-bw-card border bg-bw-surface transition-all overflow-hidden',
        isActive
          ? 'border-s-4 border-s-bw-emerald border-bw-line shadow-bw-card'
          : 'border-bw-line'
      )}
    >
      {/* Trip header */}
      <div className="p-3 pb-2.5 border-b border-bw-line">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {isActive ? (
              <span className="relative flex size-2.5 shrink-0" aria-label="مشوار نشط">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bw-emerald opacity-75" />
                <span className="relative inline-flex rounded-full size-2.5 bg-bw-emerald" />
              </span>
            ) : null}
            <span className="font-semibold text-bw-ink text-sm truncate">
              مشوار <Code>#{shortId(run.id)}</Code>
            </span>
            <span className="text-xs text-bw-ink-subtle truncate max-w-[120px]">
              {areasSummary}
            </span>
          </div>

          <div>
            {isActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-bw-emerald-soft px-2.5 py-0.5 text-xs font-semibold text-bw-emerald border border-bw-emerald/25">
                <span className="size-1.5 rounded-full bg-bw-emerald" />
                جاري التوصيل
              </span>
            ) : isPlanning ? (
              <StatusLabel tone={allHanded ? 'ok' : 'pending'}>
                {allHanded ? 'جاهز للانطلاق' : 'بانتظار الاستلام'}
              </StatusLabel>
            ) : (
              <Status map={RUN_STATUS} value={run.status} />
            )}
          </div>
        </div>

        {/* Progress & custody state bar */}
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-bw-ink-soft">
            <span className="flex items-center gap-1">
              <Package className="size-3" aria-hidden />
              {deliveredCount} من {totalStops} تم تسليمها
              {failedCount > 0 ? <span className="text-bw-danger">({failedCount} تعذر)</span> : null}
            </span>
            <span>
              {isActive && run.dispatchedAt ? (
                <>خرج {formatDateTime(run.dispatchedAt)}</>
              ) : isPlanning ? (
                allHanded ? (
                  <span className="text-bw-ok">تم استلام كل الطرود في عهدتك</span>
                ) : (
                  <span className="text-bw-warn font-medium">استلمت {handedCount}/{totalStops} طرد</span>
                )
              ) : null}
            </span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bw-sunken">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                isActive ? 'bg-bw-emerald' : 'bg-bw-cobalt'
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Pickup custody hint & Continuous scan button when planning */}
        {isPlanning ? (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-bw-field bg-bw-warn-soft border border-bw-warn/25 p-2 text-xs">
            <div className="flex items-center gap-1.5 text-[11px] text-bw-warn min-w-0 flex-1">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              <span>
                {allHanded
                  ? 'تم استلام جميع طرود المشوار في عهدتك! جاهز للانطلاق.'
                  : 'امسح بوليصة كل طرد لاستلامه في عهدتك قبل الخروج.'}
              </span>
            </div>
            {!allHanded ? (
              <Button
                type="button"
                size="sm"
                onClick={() => onStartContinuousScan(run)}
                className="text-xs shrink-0 font-semibold cursor-pointer"
              >
                <Scan className="size-3.5" aria-hidden />
                <span>بدء الاستلام السريع بالباركود</span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Stops list */}
      <ul className="divide-y divide-bw-line">
        {run.stops.map((stop) => {
          const isStopActive = stop.attemptStatus === 'active'
          const isDelivered = stop.status === 'delivered' || stop.attemptStatus === 'delivered'
          const isFailed = stop.status === 'failed' || stop.attemptStatus === 'failed'

          return (
            <li key={stop.shipmentId}>
              <Link
                href={`/driver/stop/${stop.shipmentId}`}
                className="flex items-center gap-2.5 p-3 hover:bg-bw-veil-1 active:bg-bw-veil-2 transition-colors"
              >
                {/* Sequence badge */}
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold border',
                    isDelivered
                      ? 'bg-bw-emerald-soft text-bw-emerald border-bw-emerald/30'
                      : isFailed
                      ? 'bg-bw-danger-soft text-bw-danger border-bw-danger/30'
                      : isStopActive && stop.handedOver
                      ? 'bg-bw-action-soft text-bw-action-ink border-bw-line'
                      : 'bg-bw-sunken text-bw-ink-soft border-bw-line'
                  )}
                >
                  {isDelivered ? (
                    <CheckCircle2 className="size-4" aria-hidden />
                  ) : isFailed ? (
                    <XCircle className="size-4" aria-hidden />
                  ) : (
                    <Code>{stop.sequence}</Code>
                  )}
                </span>

                {/* Stop info */}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="font-semibold text-bw-ink text-sm truncate">
                      {stop.recipientName}
                    </p>
                    <span className="text-xs font-bold text-bw-ink shrink-0">
                      <Egp value={stop.codDue} />
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-1 text-[11px] text-bw-ink-soft">
                    <span className="truncate">
                      <Code>{stop.orderNumber}</Code> {stop.area ? `· ${stop.area}` : ''}
                    </span>

                    {/* Custody & attempt status badge */}
                    <div className="shrink-0">
                      {isStopActive && stop.status !== 'failed' ? (
                        stop.handedOver ? (
                          <span className="inline-flex items-center gap-1 text-bw-emerald font-medium">
                            <span className="size-1.5 rounded-full bg-bw-emerald" />
                            في عهدتك
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-bw-warn font-medium">
                            <Clock className="size-3" />
                            بانتظار المسح
                          </span>
                        )
                      ) : (
                        <Status map={SHIPMENT_STATUS} value={stop.status} />
                      )}
                    </div>
                  </div>
                </div>

                <ChevronLeft className="size-4 text-bw-ink-subtle shrink-0 rtl:rotate-0" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
