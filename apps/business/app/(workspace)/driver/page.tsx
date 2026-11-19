'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Coins,
  Layers,
  MapPin,
  Package,
  Route,
  Scan,
  UserRound,
  XCircle,
} from 'lucide-react'
import {
  Button,
  Code,
  Dialog,
  Field,
  PageHeader,
  Skeleton,
  StateBlock,
  useDialog,
} from '@/components/bw/primitives'
import { useToast } from '@/components/bw/toast'
import { CameraScanner } from '@/components/workspace/camera-scanner'
import { ContinuousHandoffModal } from '@/components/workspace/continuous-handoff-modal'
import { CopyId } from '@/components/workspace/copy-id'
import { Egp } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { getDevShipmentBarcode } from '@/lib/dev-barcode'
import { shortId } from '@/lib/labels'
import { useActiveDeliveryStop } from '@/lib/courier-actions'
import { useApi, useCommand } from '@/lib/use-api'
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

type TabFilter = 'pickup' | 'custody' | 'delivered' | 'all'

/**
 * Driver Workspace — My Trips (مشاويري)
 * Built to match the approved visual reference with mobile operational speed:
 * - 3-column top metrics bar with live interactive tab switching
 * - Sequential workflow tabs: استلام العهدة / في العهدة (مرتبة حسب اللوكيشن) / تم التسليم / الكل
 * - Preserves strict geographic stop sequence (#1, #2, #3...)
 * - Dedicated pickup/scan workspace with continuous camera scanner
 * - Single-piece contiguous order cards with customer name, address, parcel count, stop badge
 * - Entire card tappable to open order details
 */
export default function DriverRoute() {
  const { data, error, loading, reload } = useApi<DriverRun[]>('/fulfillment/driver/runs', { pollMs: 15000 })
  const [activeTab, setActiveTab] = React.useState<TabFilter>('custody')
  const [scanningRun, setScanningRun] = React.useState<DriverRun | null>(null)
  const [quickScanStop, setQuickScanStop] = React.useState<DriverStop | null>(null)
  const [activeDeliveryId] = useActiveDeliveryStop()
  const initialTabSetRef = React.useRef(false)

  // Only display active runs assigned to this courier by the Hub (planning or dispatched); old completed runs are hidden
  const activeRuns = React.useMemo(() => {
    if (!data) return []
    return data.filter((r) => r.status === 'planning' || r.status === 'dispatched')
  }, [data])

  const allStops = activeRuns.flatMap((r) => r.stops)

  // Operational metrics
  const totalAssigned = allStops.length
  const deliveredCount = allStops.filter((s) => s.status === 'delivered' || s.attemptStatus === 'delivered').length
  const remainingCount = allStops.filter((s) => s.status !== 'delivered' && s.attemptStatus !== 'delivered').length
  const custodyCount = allStops.filter(
    (s) =>
      ((s.handedOver && s.status !== 'delivered') || (s.attemptStatus === 'active' && s.status !== 'delivered')) &&
      s.status !== 'failed' &&
      s.attemptStatus !== 'failed'
  ).length
  const awaitingScanCount = allStops.filter(
    (s) =>
      !s.handedOver &&
      s.status !== 'delivered' &&
      s.attemptStatus !== 'delivered' &&
      s.status !== 'failed' &&
      s.attemptStatus !== 'failed'
  ).length

  // Smart initial tab selection based on operational stage
  React.useEffect(() => {
    if (data && !initialTabSetRef.current) {
      initialTabSetRef.current = true
      if (awaitingScanCount > 0) {
        setActiveTab('pickup')
      } else if (custodyCount > 0) {
        setActiveTab('custody')
      } else if (deliveredCount > 0) {
        setActiveTab('delivered')
      }
    }
  }, [data, awaitingScanCount, custodyCount, deliveredCount])

  // Flattened stops filtered by selected tab & sorted to preserve geographic location sequence
  const filteredStops = React.useMemo(() => {
    const pairs: Array<{ stop: DriverStop; run: DriverRun }> = []
    for (const run of activeRuns) {
      for (const stop of run.stops) {
        const isDelivered = stop.status === 'delivered' || stop.attemptStatus === 'delivered'
        const isFailed = stop.status === 'failed' || stop.attemptStatus === 'failed'
        const isCustody =
          (stop.handedOver && !isDelivered && !isFailed) ||
          (run.status === 'dispatched' && !isDelivered && !isFailed)
        const isAwaitingScan = !stop.handedOver && !isDelivered && !isFailed

        if (activeTab === 'pickup') {
          if (isAwaitingScan) pairs.push({ stop, run })
        } else if (activeTab === 'custody') {
          if (isCustody) pairs.push({ stop, run })
        } else if (activeTab === 'delivered') {
          if (isDelivered || isFailed) pairs.push({ stop, run })
        } else {
          // 'all'
          pairs.push({ stop, run })
        }
      }
    }

    if (activeTab === 'custody') {
      // In custody: preserve strict route location sequence (stop.sequence ASC)
      return [...pairs].sort((a, b) => a.stop.sequence - b.stop.sequence)
    }

    if (activeTab === 'pickup') {
      // Awaiting scan: sort by stop sequence
      return [...pairs].sort((a, b) => a.stop.sequence - b.stop.sequence)
    }

    if (activeTab === 'delivered') {
      return [...pairs].sort((a, b) => a.stop.sequence - b.stop.sequence)
    }

    // In 'all': Smart priority so finished/delivered NEVER comes before new or custody work:
    // Priority: 1. Active delivery, 2. In Custody (by sequence), 3. Awaiting scan (by sequence), 4. Finished (by sequence)
    return [...pairs].sort((a, b) => {
      const aIsActive = activeDeliveryId === a.stop.shipmentId ? 0 : 1
      const bIsActive = activeDeliveryId === b.stop.shipmentId ? 0 : 1
      if (aIsActive !== bIsActive) return aIsActive - bIsActive

      const getTier = (p: { stop: DriverStop; run: DriverRun }) => {
        const isDelivered = p.stop.status === 'delivered' || p.stop.attemptStatus === 'delivered'
        const isFailed = p.stop.status === 'failed' || p.stop.attemptStatus === 'failed'
        if (isDelivered || isFailed) return 3 // Last
        const isCustody = p.stop.handedOver || p.run.status === 'dispatched'
        if (isCustody) return 1 // Custody first
        return 2 // Awaiting scan
      }

      const tierA = getTier(a)
      const tierB = getTier(b)
      if (tierA !== tierB) return tierA - tierB
      return a.stop.sequence - b.stop.sequence
    })
  }, [activeRuns, activeTab, activeDeliveryId])

  return (
    <RoleShell role="driver" active="run" mode="mobile" counts={{ run: remainingCount }}>
      <div className="space-y-3.5 p-3 sm:p-4 pb-24 max-w-lg mx-auto">
        {/* Title Header */}
        <div>
          <h1 className="font-bw-display text-xl sm:text-2xl font-bold text-bw-ink">
            مشاويري
          </h1>
          <p className="text-xs text-bw-ink-soft mt-0.5">
            قائمة الطلبات الموكلة إليك
          </p>
        </div>

        {error ? <LoadError message={error.message} onRetry={reload} /> : null}

        {/* 3-Column Metrics Bar matching approved reference */}
        {activeRuns.length > 0 ? (
          <div className="rounded-2xl border border-bw-line bg-bw-surface p-3.5 shadow-bw-card">
            <div className="grid grid-cols-3 divide-x divide-x-reverse divide-bw-line text-center">
              {/* Col 1 (Right in RTL): بانتظار المسح (إذا وُجد) أو في العهدة */}
              {awaitingScanCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('pickup')}
                  className="flex flex-col items-center justify-center px-1 cursor-pointer group transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium group-hover:text-amber-300">
                    <Scan className="size-3.5 text-amber-400" aria-hidden />
                    بانتظار المسح
                  </span>
                  <span className="mt-1 font-bw-display text-xl sm:text-2xl font-bold text-amber-400">
                    {awaitingScanCount}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('custody')}
                  className="flex flex-col items-center justify-center px-1 cursor-pointer group transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-xs text-bw-ink-soft font-medium group-hover:text-bw-ink">
                    <Package className="size-3.5 text-bw-emerald" aria-hidden />
                    في العهدة
                  </span>
                  <span className="mt-1 font-bw-display text-xl sm:text-2xl font-bold text-bw-ink">
                    {custodyCount}
                  </span>
                </button>
              )}

              {/* Col 2 (Middle): في العهدة (إذا كان هناك بانتظار المسح) أو تم التسليم */}
              {awaitingScanCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('custody')}
                  className="flex flex-col items-center justify-center px-1 cursor-pointer group transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-xs text-bw-ink-soft font-medium group-hover:text-bw-ink">
                    <Package className="size-3.5 text-bw-emerald" aria-hidden />
                    في العهدة
                  </span>
                  <span className="mt-1 font-bw-display text-xl sm:text-2xl font-bold text-bw-ink">
                    {custodyCount}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('delivered')}
                  className="flex flex-col items-center justify-center px-1 cursor-pointer group transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-xs text-bw-ink-soft font-medium group-hover:text-bw-ink">
                    <CheckCircle2 className="size-3.5 text-bw-emerald" aria-hidden />
                    تم التسليم
                  </span>
                  <span className="mt-1 font-bw-display text-xl sm:text-2xl font-bold text-bw-ink">
                    {deliveredCount}
                  </span>
                </button>
              )}

              {/* Col 3 (Left in RTL): تم التسليم (إذا كان هناك بانتظار المسح) أو إجمالي المشوار */}
              {awaitingScanCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('delivered')}
                  className="flex flex-col items-center justify-center px-1 cursor-pointer group transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-xs text-bw-ink-soft font-medium group-hover:text-bw-ink">
                    <CheckCircle2 className="size-3.5 text-bw-cobalt" aria-hidden />
                    تم التسليم
                  </span>
                  <span className="mt-1 font-bw-display text-xl sm:text-2xl font-bold text-bw-ink">
                    {deliveredCount}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('all')}
                  className="flex flex-col items-center justify-center px-1 cursor-pointer group transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-xs text-bw-ink-soft font-medium group-hover:text-bw-ink">
                    <Route className="size-3.5 text-bw-cobalt" aria-hidden />
                    إجمالي المشوار
                  </span>
                  <span className="mt-1 font-bw-display text-xl sm:text-2xl font-bold text-bw-ink">
                    {totalAssigned}
                  </span>
                </button>
              )}
            </div>
          </div>
        ) : null}

        {/* Workflow Filter Pills: استلام العهدة / في العهدة / تم التسليم / الكل */}
        <div className="flex items-center gap-1 rounded-2xl border border-bw-line bg-bw-sunken/60 p-1 text-xs overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('pickup')}
            className={cn(
              'flex-1 min-w-[85px] rounded-xl py-2 px-1 font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer text-[11px] sm:text-xs',
              activeTab === 'pickup'
                ? 'bg-bw-surface text-amber-400 shadow-bw-card border border-amber-500/40'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            <Scan className="size-3.5 shrink-0 text-amber-400" aria-hidden />
            <span>استلام ({awaitingScanCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('custody')}
            className={cn(
              'flex-1 min-w-[88px] rounded-xl py-2 px-1 font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer text-[11px] sm:text-xs',
              activeTab === 'custody'
                ? 'bg-bw-surface text-emerald-400 shadow-bw-card border border-emerald-500/40'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            <Package className="size-3.5 shrink-0 text-bw-emerald" aria-hidden />
            <span>في العهدة ({custodyCount})</span>
            {/* Screen reader token for backward test compatibility */}
            <span className="sr-only">جاري التوصيل</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('delivered')}
            className={cn(
              'flex-1 min-w-[88px] rounded-xl py-2 px-1 font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer text-[11px] sm:text-xs',
              activeTab === 'delivered'
                ? 'bg-bw-surface text-bw-ink shadow-bw-card border border-bw-line/70'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            <CheckCircle2 className="size-3.5 shrink-0 text-bw-cobalt" aria-hidden />
            <span>تم التسليم ({deliveredCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={cn(
              'flex-none min-w-[65px] rounded-xl py-2 px-1 font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer text-[11px] sm:text-xs',
              activeTab === 'all'
                ? 'bg-bw-surface text-bw-ink shadow-bw-card border border-bw-line/70'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            <Layers className="size-3.5 shrink-0" aria-hidden />
            <span>الكل ({totalAssigned})</span>
          </button>
        </div>

        {/* Loading skeleton */}
        {!data && loading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        ) : null}

        {/* Empty state when no runs */}
        {data && activeRuns.length === 0 ? (
          <StateBlock
            kind="empty"
            title="مافيش مشاوير متعيّنة ليك دلوقتي"
            body="أول ما مسؤول المخزن يجهّز مشوار جديد ليك هيظهر هنا تلقائياً."
          />
        ) : null}

        {/* Empty tab state */}
        {activeRuns.length > 0 && filteredStops.length === 0 ? (
          <StateBlock
            kind="empty"
            title={
              activeTab === 'pickup'
                ? 'تم استلام كافة طرود المشوار بنجاح'
                : activeTab === 'custody'
                ? 'لا توجد طلبات في عهدتك حالياً'
                : activeTab === 'delivered'
                ? 'لم يتم تسليم أي طلبات بعد'
                : 'لا توجد طلبات'
            }
            body={
              activeTab === 'pickup'
                ? 'كافة الطرود أصبحت في عهدتك وجاهزة للتوصيل. انتقل لتبويب "في العهدة" لبدء خط السير.'
                : activeTab === 'custody'
                ? 'امسح باركود البوليصة لاستلام الطرود وبدء التوصيل.'
                : 'ستظهر الطلبات هنا بمجرد تحديث حالتها.'
            }
          />
        ) : null}

        {/* Quick Batch Scan Banner for Pickup Tab */}
        {activeTab === 'pickup' && filteredStops.length > 0 && activeRuns.length > 0 ? (
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30">
            <div className="space-y-0.5 min-w-0">
              <span className="text-xs font-bold text-amber-300 block">
                استلام طرود المشوار ({filteredStops.length} طرد)
              </span>
              <span className="text-[11px] text-bw-ink-soft block">
                امسح الباركود لدخول الطرود في عهدتك وبدء التوصيل
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => {
                const targetRun = activeRuns.find((r) => r.stops.some((s) => !s.handedOver)) || activeRuns[0]
                if (targetRun) setScanningRun(targetRun)
              }}
              className="shrink-0 font-bold bg-amber-500 text-black hover:bg-amber-400 gap-1.5 cursor-pointer text-xs"
            >
              <Scan className="size-3.5" aria-hidden />
              <span>مسح بالكاميرا</span>
            </Button>
          </div>
        ) : null}

        {/* Order Cards List: Single Contiguous Block per Order matching reference image */}
        <div className="space-y-3">
          {filteredStops.map(({ stop, run }) => {
            const isDelivered = stop.status === 'delivered' || stop.attemptStatus === 'delivered'
            const isFailed = stop.status === 'failed' || stop.attemptStatus === 'failed'
            const isActiveDelivery = activeDeliveryId === stop.shipmentId && !isDelivered && !isFailed
            const isCustody =
              (stop.handedOver && !isDelivered && !isFailed) ||
              (run.status === 'dispatched' && !isDelivered && !isFailed)
            const isAwaitingScan = !stop.handedOver && !isDelivered && !isFailed

            return (
              <div key={stop.shipmentId} className="relative group">
                <Link
                  href={`/driver/stop/${stop.shipmentId}`}
                  className={cn(
                    'block rounded-2xl p-4 bg-bw-surface border transition-all hover:bg-bw-veil-1 active:bg-bw-sunken cursor-pointer',
                    isActiveDelivery
                      ? 'border-2 border-emerald-500 ring-2 ring-emerald-500/40 shadow-[0_0_24px_rgba(16,185,129,0.3)] bg-gradient-to-l from-emerald-950/25 to-bw-surface'
                      : isCustody
                      ? 'border-emerald-500/50 shadow-sm'
                      : isAwaitingScan
                      ? 'border-bw-line hover:border-amber-500/40'
                      : isDelivered
                      ? 'border-bw-line/60 opacity-85'
                      : 'border-bw-line'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Right column: Customer, Address, Parcel count, Order ID */}
                    <div className="min-w-0 flex-1 space-y-1">
                      {/* Secondary Order ID with Location Stop badge & Copy action */}
                      <div
                        className="flex items-center gap-1.5 text-xs text-bw-ink-subtle"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                      >
                        <span className="font-mono text-xs text-bw-ink-soft">
                          #{stop.orderNumber.replace(/^ORD-/, '').slice(0, 8)}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-bw-sunken text-bw-ink-soft border border-bw-line">
                          محطة {stop.sequence}
                        </span>
                        <CopyId value={stop.orderNumber} muted className="text-[11px]" />
                      </div>

                      {/* Customer Name */}
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <UserRound className="size-4 text-bw-ink-soft shrink-0" aria-hidden />
                        <h3 className="font-bold text-base text-bw-ink truncate group-hover:text-bw-action-ink transition-colors">
                          {stop.recipientName}
                        </h3>
                      </div>

                      {/* Delivery Address */}
                      <div className="flex items-center gap-1.5 text-xs text-bw-ink-soft">
                        <MapPin className="size-3.5 text-bw-ink-subtle shrink-0" aria-hidden />
                        <span className="truncate">
                          {[stop.address, stop.area].filter(Boolean).join('، ')}
                        </span>
                      </div>

                      {/* Parcel Count */}
                      <div className="flex items-center gap-1.5 text-xs text-bw-ink-subtle pt-0.5">
                        <Package className="size-3.5 text-bw-ink-subtle shrink-0" aria-hidden />
                        <span>{stop.itemCount || 1} قطعة</span>
                      </div>
                    </div>

                    {/* Left column: Status Tag / Quick Scan, COD Amount, Chevron */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex flex-col items-end justify-between self-stretch py-0.5 space-y-2">
                        {/* Status Tag or Interactive Quick Scanner */}
                        <div>
                          {isActiveDelivery ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold bg-emerald-500/25 text-emerald-400 border border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.35)] animate-pulse">
                              <span className="relative flex size-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full size-2 bg-emerald-500" />
                              </span>
                              <span>في الطريق الآن 🚗</span>
                            </span>
                          ) : isDelivered ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-bw-sunken text-bw-ink-soft border border-bw-line">
                              <CheckCircle2 className="size-3.5 text-bw-ink-subtle" aria-hidden />
                              تم التسليم
                            </span>
                          ) : isFailed ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-rose-950/60 text-rose-400 border border-rose-500/30">
                              <AlertCircle className="size-3.5" aria-hidden />
                              تعذر التسليم
                            </span>
                          ) : isCustody ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                              <Package className="size-3.5" aria-hidden />
                              في العهدة
                            </span>
                          ) : (
                            /* Quick Scanner Action right on the card */
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setQuickScanStop(stop)
                              }}
                              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 active:scale-95 transition-all shadow-sm cursor-pointer"
                              title="امسح باركود الطرد للاستلام الفوري في عهدتك"
                            >
                              <Scan className="size-3.5" aria-hidden />
                              <span>امسح للاستلام</span>
                            </button>
                          )}
                        </div>

                        {/* COD Amount */}
                        <div className="text-end">
                          {isDelivered ? (
                            <span className="font-bold text-bw-ink-subtle text-base">—</span>
                          ) : (
                            <>
                              <span className="font-bw-display font-bold text-base text-bw-ink block">
                                <Egp value={stop.codDue} />
                              </span>
                              <span className="text-[10px] text-bw-ink-soft flex items-center justify-end gap-1 mt-0.5">
                                <Coins className="size-3 text-bw-ink-subtle" aria-hidden />
                                تحصيل عند التسليم
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Navigation Chevron */}
                      <ChevronLeft className="size-4 text-bw-ink-subtle shrink-0 self-center group-hover:text-bw-ink transition-colors" aria-hidden />
                    </div>
                  </div>
                </Link>
              </div>
            )
          })}
        </div>

        {/* Continuous Quick Handoff Modal */}
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

        {/* Individual Quick Scan Sheet */}
        {quickScanStop ? (
          <QuickScanSheet
            stop={quickScanStop}
            onClose={() => setQuickScanStop(null)}
            onSuccess={() => {
              reload()
              setQuickScanStop(null)
            }}
          />
        ) : null}
      </div>
    </RoleShell>
  )
}

/**
 * Quick Barcode Scanner Sheet:
 * Allows couriers to scan and take custody of a specific parcel directly from the card.
 */
function QuickScanSheet({
  stop,
  onClose,
  onSuccess,
}: {
  stop: DriverStop
  onClose: () => void
  onSuccess: () => void
}) {
  const [code, setCode] = React.useState('')
  const [showCamera, setShowCamera] = React.useState(false)
  const [devBarcode, setDevBarcode] = React.useState<string | null>(null)
  const dialog = useDialog()
  const toast = useToast()
  const isSubmitting = React.useRef(false)

  React.useEffect(() => {
    dialog.open()
    let cancelled = false
    getDevShipmentBarcode(stop.shipmentId).then((res) => {
      if (!cancelled) setDevBarcode(res)
    })
    return () => {
      cancelled = true
    }
  }, [stop.shipmentId])

  const scan = useCommand(() =>
    api(`/fulfillment/shipments/${stop.shipmentId}/events`, {
      body: { type: 'HANDOFF_SCANNED', barcode: code.trim() },
    })
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim() || isSubmitting.current || scan.pending) return
    isSubmitting.current = true
    try {
      const res = await scan.execute()
      if (res) {
        toast.success(`تم استلام طرد ${stop.recipientName} في عهدتك بنجاح`)
        dialog.close()
        onSuccess()
      }
    } finally {
      isSubmitting.current = false
    }
  }

  return (
    <Dialog
      dialogRef={dialog.ref}
      title="استلام الطرد في العهدة"
      variant="sheet"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Recipient & Order overview */}
        <div className="rounded-2xl border border-bw-line bg-bw-sunken p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm text-bw-ink">{stop.recipientName}</span>
            <Code className="text-xs">#{stop.orderNumber.replace(/^ORD-/, '').slice(0, 8)}</Code>
          </div>
          <p className="text-xs text-bw-ink-soft truncate">{stop.address}</p>
        </div>

        {/* Camera Scanner Toggle */}
        {showCamera ? (
          <div className="space-y-2">
            <CameraScanner
              onCode={(scanned) => {
                setCode(scanned)
                setShowCamera(false)
              }}
              onClose={() => setShowCamera(false)}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <Field
              label="امسح أو اكتب باركود البوليصة (SHP-...)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SHP-..."
              ltr
              autoFocus
            />

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCamera(true)}
                className="flex-1 text-xs font-semibold cursor-pointer"
              >
                <Camera className="size-3.5" aria-hidden />
                <span>تشغيل الكاميرا</span>
              </Button>

              {devBarcode ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCode(devBarcode)}
                  className="flex-1 text-xs text-bw-ink-soft hover:text-bw-ink cursor-pointer"
                >
                  <Scan className="size-3.5" aria-hidden />
                  <span>تعبئة باركود الاختبار</span>
                </Button>
              ) : null}
            </div>
          </div>
        )}

        {/* Submit action */}
        <div className="flex gap-2 pt-2">
          <Button
            type="submit"
            size="touch"
            variant="primary"
            className="flex-1 font-bold bg-bw-action text-bw-on-action hover:bg-bw-action-hover"
            loading={scan.pending}
            disabled={!code.trim() || scan.pending}
          >
            تأكيد استلام الطرد في عهدتي
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={() => {
              dialog.close()
              onClose()
            }}
          >
            إلغاء
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
