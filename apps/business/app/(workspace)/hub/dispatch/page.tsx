'use client'

import * as React from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  History,
  Layers,
  RefreshCw,
  RotateCcw,
  Scan,
  ShieldCheck,
  Truck,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import {
  Button,
  Code,
  Field,
  Notice,
  PageHeader,
  Skeleton,
  StateBlock,
  StatusLabel,
} from '@/components/bw/primitives'
import { ContinuousHandoffModal } from '@/components/workspace/continuous-handoff-modal'
import { HubShell, useHub } from '@/components/workspace/hub'
import { CommandError, Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { getDevShipmentBarcode } from '@/lib/dev-barcode'
import {
  RUN_BLOCKER,
  RUN_SETTLEMENT_STATE,
  SHIPMENT_STATUS,
  formatDateTime,
  shortId,
} from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import type { HubShipment } from '../prepare/page'

/* ─────────────────────────────────────────────────────────────
   Types & Models
   ───────────────────────────────────────────────────────────── */

interface Run {
  id: string
  status: string
  driverId: string | null
  plannedAt: string | null
  dispatchedAt: string | null
  completedAt: string | null
  stops: number
  stopOrderIds?: string[]
  attempts: Record<string, number>
  /** Stops still waiting for a delivery outcome (a failed parcel in the courier's hands no longer counts). */
  toAttempt?: number
  /** The server's settlement answer for this run (the same one the Complete Trip gate enforces). */
  settlement?: RunSettlementSummary
}

type SettlementState = 'pending' | 'reconciliation_required' | 'settled' | 'completed'

interface RunBlocker {
  code: string
  count: number
}

interface RunSettlementSummary {
  state: SettlementState
  stops: { total: number; delivered: number; inTransit: number; pendingReturns: number; returnedToHub: number; cancelled: number }
  cash: {
    zeroCodDeliveries: number
    codOrders: number
    awaitingDeclaration: number
    awaitingCount: number
    counted: number
    disputed: number
    expectedTotal: number
    declaredTotal: number
    countedTotal: number
    variance: number | null
  }
  blockers: RunBlocker[]
  canSettleCash: boolean
  canComplete: boolean
}

interface RunSettlementDetail extends RunSettlementSummary {
  runId: string
  runStatus: string
  settlements: Array<{ id: string; reference: string; settledAt: string; expectedTotal: number; countedTotal: number; variance: number }>
  deliveredOrders: Array<{
    orderId: string
    orderNumber: string | null
    cash: { status: string; expectedAmount: number; declaredAmount: number | null; countedAmount: number | null } | null
  }>
  pendingReturns: Array<{ shipmentId: string; orderId: string; orderNumber: string | null; area: string | null }>
}

interface ReturnParcel {
  shipmentId: string
  orderId: string
  orderNumber: string | null
  area: string | null
}

interface RunStop {
  sequence: number
  shipmentId: string
  orderNumber: string | null
  area: string | null
  shipmentStatus: string
  attemptStatus: string
  handedOver: boolean
}

interface RunDetail {
  id: string
  status: string
  driverId: string | null
  locationId: string | null
  plannedAt: string | null
  dispatchedAt: string | null
  completedAt: string | null
  stops: RunStop[]
}

interface Eligible {
  id: string
  orderId: string
  status: string
}

interface Collection {
  orderId: string
  orderNumber: string
  orderStatus: string
  courierId: string | null
  status: string
  currency: string
  expectedAmount: string
  declaredAmount: string | null
  countedAmount: string | null
  variance: string | null
  settlementBatchId: string | null
  declaredAt: string | null
  updatedAt: string
}

interface SettlementLine {
  orderId: string
  orderNumber?: string
  expectedAmount: string
  declaredAmount: string | null
  countedAmount: string
  variance: string
  status: string
}

interface RoundTotals {
  expectedTotal: string
  declaredTotal: string
  countedTotal: string
  variance: string
}

interface SettlementReceipt {
  name: string
  reference: string
  round: RoundTotals
  lines: SettlementLine[]
  orderNumbers: Record<string, string>
}

interface PastSettlementBatch {
  id: string
  reference: string
  courierId: string
  locationId: string
  totalExpected: string
  totalCollected: string
  netSettled: string
  currency: string
  settledAt: string
  actorId: string
}

type TabKey = 'ready' | 'assigned' | 'active' | 'settlement' | 'closed'

/* ─────────────────────────────────────────────────────────────
   Main Entry Component
   ───────────────────────────────────────────────────────────── */

export default function HubDispatch() {
  return (
    <HubShell active="handoff">
      <DispatchBody />
    </HubShell>
  )
}

function DispatchBody() {
  const hub = useHub()

  // Queries
  const drivers = useApi<Array<{ id: string; name: string }>>('/workspace/drivers')
  const eligible = useApi<Eligible[]>(`/fulfillment/locations/${hub.id}/eligible-shipments`, { pollMs: 15000 })
  const packed = useApi<{ items: HubShipment[] }>(`/fulfillment/locations/${hub.id}/shipments?status=packed&take=100`, { pollMs: 15000 })
  const runs = useApi<{ items: Run[] }>(`/fulfillment/locations/${hub.id}/runs?status=planning,dispatched,completed&take=100`, { pollMs: 15000 })
  const collections = useApi<{ items: Collection[] }>(`/ordering/settlements/collections?locationId=${hub.id}&status=collected&take=100`, { pollMs: 15000 })
  const pastBatches = useApi<{ items: PastSettlementBatch[] }>(`/ordering/settlements/batches?locationId=${hub.id}&take=50`, { pollMs: 30000 })

  // Maps & lookups
  const driverName = React.useMemo(() => new Map((drivers.data ?? []).map((d) => [d.id, d.name])), [drivers.data])
  const orderOf = React.useMemo(() => new Map((packed.data?.items ?? []).map((s) => [s.shipmentId, s])), [packed.data])

  // Ready tab selection & assignment state
  const [driverId, setDriverId] = React.useState('')
  const [selectedParcels, setSelectedParcels] = React.useState<string[]>([])
  const createRun = useCommand(async () => {
    const run = await api<{ id: string }>('/fulfillment/delivery-batches', {
      body: { hubId: hub.id, name: `run-${new Date().toISOString().slice(0, 16)}`, driverId },
    })
    await api(`/fulfillment/delivery-batches/${run.id}/stops`, {
      body: { stops: selectedParcels.map((shipmentId) => ({ shipmentId })) },
    })
    return run
  })

  // Drawer states
  const [settlingCourier, setSettlingCourier] = React.useState<{
    courierId: string
    courierName: string
    runId?: string
    runOrderIds?: string[]
  } | null>(null)
  const [historyOpen, setHistoryOpen] = React.useState(false)

  // Reload helper
  const reloadAll = React.useCallback(() => {
    eligible.reload()
    packed.reload()
    runs.reload()
    collections.reload()
    pastBatches.reload()
  }, [eligible, packed, runs, collections, pastBatches])

  // Group collections by courier (only for cash that belongs to no listed run)
  const collectionsByCourier = React.useMemo(() => {
    const map = new Map<string, Collection[]>()
    for (const c of collections.data?.items ?? []) {
      if (c.courierId) {
        map.set(c.courierId, [...(map.get(c.courierId) ?? []), c])
      }
    }
    return map
  }, [collections.data])

  // Classify runs into tabs
  const planningRuns = React.useMemo(() => (runs.data?.items ?? []).filter((r) => r.status === 'planning'), [runs.data])

  // Dispatched runs that still have in-progress (active) stops
  const activeRuns = React.useMemo(() => {
    return (runs.data?.items ?? []).filter((r) => {
      if (r.status !== 'dispatched') return false
      const activeCount = r.toAttempt ?? r.attempts?.active ?? 0
      // If there are still active stops, it's out on delivery
      return activeCount > 0
    })
  }, [runs.data])

  // Runs awaiting settlement. Each Delivery Run is an independent settlement unit (GLO-COD-01): its state comes from the
  // server (stops + the cash of the orders it delivered), never from "no unsettled collections found" on this screen.
  const settlementItems = React.useMemo(() => {
    const items: Array<{
      id: string
      courierId: string
      courierName: string
      run?: Run
      runOrderIds?: string[]
      summary?: RunSettlementSummary
      unsettledCollections: Collection[]
    }> = []

    const coveredOrderIds = new Set<string>()
    for (const r of runs.data?.items ?? []) {
      for (const orderId of r.stopOrderIds ?? []) coveredOrderIds.add(orderId)
      if (r.status !== 'dispatched') continue
      if ((r.toAttempt ?? r.attempts?.active ?? 0) > 0) continue // still on the road
      const cId = r.driverId
      if (!cId) continue
      const runOrderIds = r.stopOrderIds ?? []
      items.push({
        id: r.id,
        courierId: cId,
        courierName: driverName.get(cId) ?? shortId(cId),
        run: r,
        runOrderIds,
        summary: r.settlement,
        unsettledCollections: (collections.data?.items ?? []).filter((c) => runOrderIds.includes(c.orderId)),
      })
    }

    // Declared cash that belongs to no run listed here (older runs): still has to be counted.
    const leftoverByCourier = new Map<string, Collection[]>()
    for (const c of collections.data?.items ?? []) {
      if (c.courierId && !coveredOrderIds.has(c.orderId)) {
        leftoverByCourier.set(c.courierId, [...(leftoverByCourier.get(c.courierId) ?? []), c])
      }
    }
    for (const [cId, cList] of leftoverByCourier.entries()) {
      items.push({
        id: `unassigned-run-${cId}`,
        courierId: cId,
        courierName: driverName.get(cId) ?? shortId(cId),
        runOrderIds: cList.map((c) => c.orderId),
        unsettledCollections: cList,
      })
    }
    return items
  }, [runs.data, collections.data, driverName])

  // Closed runs are the ones the server closed: completing is only possible once the run was settled.
  const closedRuns = React.useMemo(
    () => (runs.data?.items ?? []).filter((r) => r.status === 'completed'),
    [runs.data]
  )

  // Counts
  const readyCount = eligible.data?.length ?? 0
  const assignedCount = planningRuns.length
  const activeCount = activeRuns.length
  const settlementCount = settlementItems.length
  const closedCount = closedRuns.length

  // Tab state (read from URL if present)
  const [activeTab, setActiveTab] = React.useState<TabKey>('ready')

  // Auto-switch to tab with items if current is 0 and others have items on initial load
  const hasAutoSelected = React.useRef(false)
  React.useEffect(() => {
    if (hasAutoSelected.current) return
    if (typeof window !== 'undefined') {
      const paramTab = new URLSearchParams(window.location.search).get('tab') as TabKey | null
      if (paramTab && ['ready', 'assigned', 'active', 'settlement', 'closed'].includes(paramTab)) {
        setActiveTab(paramTab)
        hasAutoSelected.current = true
        return
      }
    }
    if (readyCount > 0) {
      setActiveTab('ready')
      hasAutoSelected.current = true
    } else if (settlementCount > 0) {
      setActiveTab('settlement')
      hasAutoSelected.current = true
    } else if (assignedCount > 0) {
      setActiveTab('assigned')
      hasAutoSelected.current = true
    } else if (activeCount > 0) {
      setActiveTab('active')
      hasAutoSelected.current = true
    }
  }, [readyCount, settlementCount, assignedCount, activeCount])

  const TABS: Array<{ value: TabKey; label: string; count: number }> = [
    { value: 'ready', label: 'جاهزة للتسليم', count: readyCount },
    { value: 'assigned', label: 'بانتظار الاستلام', count: assignedCount },
    { value: 'active', label: 'جاري التوصيل', count: activeCount },
    { value: 'settlement', label: 'بانتظار التسوية', count: settlementCount },
    { value: 'closed', label: 'المغلقة', count: closedCount },
  ]

  const anyLoading = eligible.loading || packed.loading || runs.loading || collections.loading

  return (
    <Page>
      <PageHeader
        title="التسليم للمندوب"
        meta={`${hub.name} — تسليم الطرود، متابعة المشاوير، وتسوية النقدية والمرتجعات`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              className="text-xs"
            >
              <History className="size-3.5" aria-hidden />
              <span>سجل التسويات</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={reloadAll}
              loading={anyLoading}
              className="text-xs"
            >
              <RefreshCw className={cn('size-3.5', anyLoading && 'animate-spin')} aria-hidden />
              <span>تحديث</span>
            </Button>
          </div>
        }
      />

      {eligible.error ? <LoadError message={eligible.error.message} onRetry={eligible.reload} /> : null}

      {/* Status-Based Operational Tabs */}
      <div className="border-b border-bw-line pb-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="أقسام التسليم والمشاوير">
          {TABS.map((tab) => {
            const isSelected = activeTab === tab.value
            return (
              <button
                key={tab.value}
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  'relative flex items-center gap-2 rounded-bw-field px-3 py-2 text-xs font-semibold transition-all cursor-pointer',
                  isSelected
                    ? 'bg-bw-surface text-bw-ink border border-bw-line shadow-bw-card'
                    : 'text-bw-ink-soft hover:text-bw-ink hover:bg-bw-sunken/60'
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-mono leading-none',
                    isSelected
                      ? 'bg-bw-cobalt/20 text-bw-cobalt font-bold'
                      : tab.count > 0
                      ? 'bg-bw-kohl/50 text-bw-ink-soft'
                      : 'text-bw-ink-subtle'
                  )}
                >
                  {tab.count}
                </span>
                {tab.value === 'active' && tab.count > 0 ? (
                  <span className="relative flex size-2 ms-0.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bw-ok opacity-75"></span>
                    <span className="relative inline-flex rounded-full size-2 bg-bw-ok"></span>
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab 1: جاهزة للتسليم */}
      {activeTab === 'ready' && (
        <ReadyParcelsSection
          hubId={hub.id}
          eligible={eligible.data ?? []}
          orderOf={orderOf}
          drivers={drivers.data ?? []}
          driverId={driverId}
          setDriverId={setDriverId}
          selected={selectedParcels}
          setSelected={setSelectedParcels}
          createRun={createRun}
          loading={eligible.loading && !eligible.data}
          onCreated={() => {
            setSelectedParcels([])
            setDriverId('')
            reloadAll()
            setActiveTab('assigned')
          }}
        />
      )}

      {/* Tab 2: بانتظار الاستلام */}
      {activeTab === 'assigned' && (
        <AssignedTripsSection
          runs={planningRuns}
          driverName={driverName}
          onChanged={reloadAll}
        />
      )}

      {/* Tab 3: جاري التوصيل */}
      {activeTab === 'active' && (
        <ActiveTripsSection
          runs={activeRuns}
          driverName={driverName}
          onChanged={reloadAll}
        />
      )}

      {/* Tab 4: بانتظار التسوية */}
      {activeTab === 'settlement' && (
        <SettlementQueueSection
          items={settlementItems}
          onOpenSettle={(c) => setSettlingCourier(c)}
          onChanged={reloadAll}
        />
      )}

      {/* Tab 5: المغلقة */}
      {activeTab === 'closed' && (
        <ClosedTripsSection
          runs={closedRuns}
          driverName={driverName}
        />
      )}

      {/* Integrated Settlement Drawer / Bottom Sheet */}
      {settlingCourier && (
        <SettlementDrawer
          hubId={hub.id}
          courierId={settlingCourier.courierId}
          courierName={settlingCourier.courierName}
          runId={settlingCourier.runId}
          collections={
            settlingCourier.runOrderIds && settlingCourier.runOrderIds.length > 0
              ? (collections.data?.items ?? []).filter((c) =>
                  settlingCourier.runOrderIds!.includes(c.orderId)
                )
              : collectionsByCourier.get(settlingCourier.courierId) ?? []
          }
          onClose={() => setSettlingCourier(null)}
          onSettled={reloadAll}
        />
      )}

      {/* Historical Settlements Drawer */}
      {historyOpen && (
        <SettlementHistoryDrawer
          hubId={hub.id}
          batches={pastBatches.data?.items ?? []}
          driverName={driverName}
          loading={pastBatches.loading}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </Page>
  )
}

/* ─────────────────────────────────────────────────────────────
   Section 1: جاهزة للتسليم (Ready Parcels)
   ───────────────────────────────────────────────────────────── */

interface ProposedTripStop {
  shipmentId: string
  orderId: string
  orderNumber: string
  customerName: string
  address: string
  area?: string | null
  sequence: number
  estimatedArrivalMinutes: number
}

interface ProposedTrip {
  tripId: string
  clusterId: string
  driverId: string | null
  driverName: string | null
  areaSummary?: string
  stops: ProposedTripStop[]
  metrics: {
    stopCount: number
    estimatedDistanceMeters: number
    estimatedDrivingSeconds: number
    serviceDurationSeconds: number
    totalEstimatedDurationSeconds: number
  }
}

function ReadyParcelsSection({
  hubId,
  eligible,
  orderOf,
  drivers,
  driverId,
  setDriverId,
  selected,
  setSelected,
  createRun,
  loading,
  onCreated,
}: {
  hubId: string
  eligible: Eligible[]
  orderOf: Map<string, HubShipment>
  drivers: Array<{ id: string; name: string }>
  driverId: string
  setDriverId: (id: string) => void
  selected: string[]
  setSelected: (ids: string[]) => void
  createRun: ReturnType<typeof useCommand>
  loading: boolean
  onCreated: () => void
}) {
  const [viewMode, setViewMode] = React.useState<'clusters' | 'parcels'>('clusters')
  const [clusters, setClusters] = React.useState<ProposedTrip[]>([])
  const [loadingClusters, setLoadingClusters] = React.useState(false)
  const [clusterCouriers, setClusterCouriers] = React.useState<Record<string, string>>({})
  const [assigningClusterId, setAssigningClusterId] = React.useState<string | null>(null)
  const [clusterError, setClusterError] = React.useState<string | null>(null)

  // Fetch smart geographic clusters preview
  React.useEffect(() => {
    let cancelled = false
    async function loadPreview() {
      if (eligible.length === 0) {
        setClusters([])
        return
      }
      try {
        setLoadingClusters(true)
        setClusterError(null)
        const res = await api<{ trips: ProposedTrip[] }>(
          `/fulfillment/locations/${hubId}/dispatch/plan-preview`,
          { method: 'POST', body: {} }
        )
        if (!cancelled && res?.trips) {
          setClusters(res.trips)
        }
      } catch (err) {
        if (!cancelled) {
          setClusterError((err as Error)?.message || 'تعذر تحميل التوزيع الجغرافي المقترح')
          setViewMode('parcels')
        }
      } finally {
        if (!cancelled) setLoadingClusters(false)
      }
    }
    loadPreview()
    return () => {
      cancelled = true
    }
  }, [hubId, eligible.length])

  if (loading) return <Skeleton className="h-32 w-full rounded-bw-card" />
  if (eligible.length === 0) {
    return (
      <StateBlock
        kind="empty"
        title="مافيش طرود متغلّفة مستنية مشوار"
        body="الطرود اللي اتجهزت واتغلفت في المخزن بتظهر هنا وجاهزة للتوزيع على المناديب."
      />
    )
  }

  // Handle assigning an entire geographic cluster to one courier with optimized stop sequence
  const handleAssignCluster = async (trip: ProposedTrip) => {
    const courierId = clusterCouriers[trip.tripId]
    if (!courierId) return

    try {
      setAssigningClusterId(trip.tripId)
      setClusterError(null)
      const run = await api<{ id: string }>('/fulfillment/delivery-batches', {
        body: {
          hubId,
          name: `run-${trip.clusterId}-${new Date().toISOString().slice(0, 16)}`,
          driverId: courierId,
        },
      })
      await api(`/fulfillment/delivery-batches/${run.id}/stops`, {
        body: {
          stops: trip.stops.map((s) => ({
            shipmentId: s.shipmentId,
            sequence: s.sequence,
          })),
        },
      })
      onCreated()
    } catch (err) {
      setClusterError((err as Error)?.message || 'تعذر اعتماد المشوار للمندوب')
    } finally {
      setAssigningClusterId(null)
    }
  }

  const allSelected = eligible.length > 0 && selected.length === eligible.length

  const toggleSelectAll = () => {
    setSelected(allSelected ? [] : eligible.map((s) => s.id))
  }

  return (
    <div className="space-y-4">
      {/* View Switcher Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bw-line pb-2.5">
        <div className="flex items-center gap-1.5 rounded-bw-field bg-bw-sunken p-1 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('clusters')}
            className={cn(
              'flex items-center gap-1.5 rounded-bw-field px-3 py-1.5 font-semibold transition-all cursor-pointer',
              viewMode === 'clusters'
                ? 'bg-bw-surface text-bw-ink shadow-bw-card'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            <Compass className="size-3.5 text-bw-cobalt" />
            <span>المجموعات الجغرافية الذكية</span>
            {clusters.length > 0 ? (
              <span className="rounded-full bg-bw-cobalt/20 text-bw-cobalt px-1.5 py-0.2 text-[10px] font-mono">
                {clusters.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('parcels')}
            className={cn(
              'flex items-center gap-1.5 rounded-bw-field px-3 py-1.5 font-semibold transition-all cursor-pointer',
              viewMode === 'parcels'
                ? 'bg-bw-surface text-bw-ink shadow-bw-card'
                : 'text-bw-ink-soft hover:text-bw-ink'
            )}
          >
            <Layers className="size-3.5 text-bw-ink-soft" />
            <span>تحديد يدوي للطرود</span>
            <span className="rounded-full bg-bw-kohl/40 text-bw-ink-soft px-1.5 py-0.2 text-[10px] font-mono">
              {eligible.length}
            </span>
          </button>
        </div>

        {viewMode === 'parcels' ? (
          <button
            type="button"
            onClick={toggleSelectAll}
            className="text-xs font-semibold text-bw-cobalt hover:underline cursor-pointer"
          >
            {allSelected ? 'إلغاء تحديد الكل' : `تحديد الكل (${eligible.length})`}
          </button>
        ) : (
          <span className="text-[11px] text-bw-ink-subtle">
            تجميع جغرافي مقترح لتقليل مسافة وزمن التوصيل
          </span>
        )}
      </div>

      {clusterError ? <Notice tone="warn" title={clusterError} /> : null}

      {/* Mode A: Smart Geographic Clusters */}
      {viewMode === 'clusters' && (
        <div className="space-y-4">
          {loadingClusters ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-44 w-full rounded-bw-card" />
              <Skeleton className="h-44 w-full rounded-bw-card" />
            </div>
          ) : clusters.length === 0 ? (
            <div className="rounded-bw-card border border-dashed border-bw-line p-6 text-center space-y-2">
              <Compass className="size-8 text-bw-ink-subtle mx-auto" />
              <p className="text-xs font-semibold text-bw-ink">تعذر تكوين مجموعات جغرافية تلقائياً</p>
              <p className="text-[11px] text-bw-ink-soft">
                تأكد من وجود إحداثيات GPS للطلبات، أو استخدم التحديد اليدوي لإنشاء المشوار.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setViewMode('parcels')}
                className="text-xs mt-2"
              >
                التبديل إلى التحديد اليدوي
              </Button>
            </div>
          ) : (
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
              {clusters.map((trip, idx) => {
                const assignedCourierId = clusterCouriers[trip.tripId] || ''
                const isAssigning = assigningClusterId === trip.tripId
                const distKm = (trip.metrics.estimatedDistanceMeters / 1000).toFixed(1)
                const durationMin = Math.round(trip.metrics.totalEstimatedDurationSeconds / 60)

                return (
                  <div
                    key={trip.tripId}
                    className="flex flex-col justify-between rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-sm hover:border-bw-cobalt/40 transition-all space-y-3"
                  >
                    {/* Cluster Card Header */}
                    <div className="space-y-1.5 border-b border-bw-line pb-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="grid size-7 place-items-center rounded-lg bg-bw-cobalt/10 border border-bw-cobalt/30 text-bw-cobalt font-bold text-xs shrink-0">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-sm text-bw-ink truncate">
                            {trip.areaSummary || `المجموعة ${idx + 1}`}
                          </span>
                        </div>
                        <StatusLabel tone="ok">اقتراح ذكي</StatusLabel>
                      </div>

                      {/* Proximity Metrics with Explicit Estimated Disclaimer */}
                      <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                        <span className="inline-flex items-center gap-1 rounded-bw-field bg-bw-sunken px-2 py-1 font-mono text-bw-ink">
                          <Truck className="size-3 text-bw-ink-soft" />
                          <span>~{distKm} كم تقديري</span>
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-bw-field bg-bw-sunken px-2 py-1 font-mono text-bw-ink">
                          <Clock className="size-3 text-bw-ink-soft" />
                          <span>~{durationMin} دقيقة تقديري</span>
                        </span>
                        <span className="text-[11px] text-bw-ink-subtle">
                          ({trip.stops.length} طرود)
                        </span>
                      </div>
                    </div>

                    {/* Ordered Stops Sequence Preview */}
                    <div className="space-y-1.5 flex-1">
                      <span className="text-[11px] font-semibold text-bw-ink-soft flex items-center justify-between">
                        <span>ترتيب التوصيل المقترح (مسار أمثل):</span>
                        <span className="text-[10px] text-bw-ink-subtle">تقديري</span>
                      </span>
                      <ul className="space-y-1 max-h-40 overflow-y-auto ps-1 pe-1">
                        {trip.stops.map((stop) => {
                          const orderNum = stop.orderNumber ? stop.orderNumber.replace(/^ORD-/, '#') : shortId(stop.shipmentId)

                          return (
                            <li
                              key={stop.shipmentId}
                              className="flex items-center justify-between gap-2 text-xs rounded-bw-field bg-bw-sunken/40 px-2 py-1.5 border border-bw-line/60"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="grid size-5 place-items-center rounded-full bg-bw-surface border border-bw-line text-[10px] font-bold text-bw-ink shrink-0">
                                  {stop.sequence}
                                </span>
                                <span className="font-semibold text-bw-ink truncate max-w-[110px]">
                                  {stop.customerName}
                                </span>
                                <span className="text-bw-ink-subtle font-mono text-[11px]">
                                  <Code>{orderNum}</Code>
                                </span>
                              </div>
                              <span className="text-[10px] text-bw-ink-soft shrink-0">
                                +{stop.estimatedArrivalMinutes} د
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>

                    {/* Cluster Assignment Form */}
                    <div className="pt-2 border-t border-bw-line space-y-2">
                      <div className="space-y-1">
                        <Select
                          label="المندوب المسند إليه المجموعة:"
                          value={assignedCourierId}
                          onChange={(val) =>
                            setClusterCouriers((prev) => ({ ...prev, [trip.tripId]: val }))
                          }
                          className="w-full text-xs"
                          options={[
                            ['', 'اختار مندوب المجموعة...'],
                            ...drivers.map((d) => [d.id, d.name] as [string, string]),
                          ]}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          loading={isAssigning}
                          disabled={!assignedCourierId || isAssigning}
                          onClick={() => handleAssignCluster(trip)}
                          className="flex-1 text-xs font-semibold cursor-pointer"
                        >
                          <Truck className="size-3.5" aria-hidden />
                          <span>اعتماد المشوار للمندوب</span>
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelected(trip.stops.map((s) => s.shipmentId))
                            setViewMode('parcels')
                          }}
                          className="text-xs shrink-0 cursor-pointer"
                          title="تحديد طرود هذه المجموعة للتعديل اليدوي"
                        >
                          تعديل يدوي
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Mode B: Manual Parcels Selection Grid */}
      {viewMode === 'parcels' && (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {eligible.map((s) => {
              const detail = orderOf.get(s.id)
              const isChecked = selected.includes(s.id)
              const orderNum = (detail?.orderNumber ?? shortId(s.orderId)).replace(/^ORD-/, '#')
              const destination = [detail?.area, detail?.governorate].filter(Boolean).join('، ') || 'عنوان محدد'

              return (
                <label
                  key={s.id}
                  className={cn(
                    'group relative flex items-start gap-3 rounded-bw-card border p-3 transition-all cursor-pointer select-none',
                    isChecked
                      ? 'border-bw-cobalt/60 bg-bw-cobalt/10 shadow-sm'
                      : 'border-bw-line bg-bw-surface hover:border-bw-ink-soft/40'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) =>
                      setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))
                    }
                    className="size-4 mt-0.5 accent-bw-cobalt cursor-pointer"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-bw-ink text-sm">
                        <Code>{orderNum}</Code>
                      </span>
                      <StatusLabel tone="ok">جاهز</StatusLabel>
                    </div>
                    <p className="text-xs text-bw-ink-soft truncate">{destination}</p>
                    <div className="flex items-center gap-2 text-[11px] text-bw-ink-subtle">
                      <span>طرد متغلف</span>
                      <span>·</span>
                      <span>{detail?.itemCount ? `${detail.itemCount} قطع` : 'طرد قياسي'}</span>
                    </div>
                  </div>
                </label>
              )
            })}
          </div>

          {/* Manual Assignment Bar */}
          <form
            className="rounded-bw-card border border-bw-line bg-bw-surface p-4 flex flex-wrap items-end gap-3 shadow-bw-card"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await createRun.execute()) {
                onCreated()
              }
            }}
          >
            <div className="flex-1 min-w-[220px]">
              <Select
                label="المندوب المسند إليه المشوار"
                value={driverId}
                onChange={setDriverId}
                className="w-full"
                options={[
                  ['', 'اختار المندوب'],
                  ...drivers.map((d) => [d.id, d.name] as [string, string]),
                ]}
              />
            </div>
            <Button
              type="submit"
              loading={createRun.pending}
              disabled={!driverId || selected.length === 0}
              className="text-xs font-semibold cursor-pointer"
            >
              <Truck className="size-4" aria-hidden />
              <span>عمل مشوار ({selected.length} طرد)</span>
            </Button>
            <CommandError error={createRun.error} />
          </form>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Section 2: بانتظار الاستلام (Assigned Trips Awaiting Pickup)
   ───────────────────────────────────────────────────────────── */

function AssignedTripsSection({
  runs,
  driverName,
  onChanged,
}: {
  runs: Run[]
  driverName: Map<string, string>
  onChanged: () => void
}) {
  const [groupByCourier, setGroupByCourier] = React.useState(false)
  const [scanningRun, setScanningRun] = React.useState<Run | null>(null)

  if (runs.length === 0) {
    return (
      <StateBlock
        kind="empty"
        title="مافيش مشاوير بانتظار الاستلام"
        body="المشاوير الجديدة المخصصة للمناديب بتظهر هنا لحد ما يستلموا الطرود بالباركود."
      />
    )
  }

  // Group by courier
  const runsByCourier = React.useMemo(() => {
    const map = new Map<string, Run[]>()
    for (const r of runs) {
      const cId = r.driverId || 'unassigned'
      map.set(cId, [...(map.get(cId) ?? []), r])
    }
    return map
  }, [runs])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs border-b border-bw-line pb-2">
        <span className="text-bw-ink-soft">المشاوير المخصصة بانتظار استلام المناديب:</span>
        <button
          type="button"
          onClick={() => setGroupByCourier(!groupByCourier)}
          className="flex items-center gap-1.5 font-semibold text-bw-cobalt hover:underline cursor-pointer"
        >
          <Users className="size-3.5" />
          <span>{groupByCourier ? 'عرض كل المشاوير منفصلة' : 'تجميع حسب المندوب'}</span>
        </button>
      </div>

      {groupByCourier ? (
        <div className="space-y-4">
          {Array.from(runsByCourier.entries()).map(([cId, courierRuns]) => {
            const name = cId === 'unassigned' ? 'غير مسند لمندوب' : driverName.get(cId) ?? shortId(cId)
            const totalStops = courierRuns.reduce((sum, r) => sum + r.stops, 0)

            return (
              <div
                key={cId}
                className="rounded-bw-card border border-bw-line bg-bw-surface/90 p-4 space-y-3 shadow-xs"
              >
                <div className="flex items-center justify-between border-b border-bw-line pb-2.5">
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-bw-cobalt" />
                    <span className="font-bold text-sm text-bw-ink">{name}</span>
                    <span className="text-xs text-bw-ink-soft font-mono">
                      ({courierRuns.length} مشاوير · {totalStops} طرود)
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {courierRuns.map((run) => (
                    <AssignedTripCard
                      key={run.id}
                      run={run}
                      driver={name}
                      couriers={[...driverName.entries()]}
                      onStartScan={(r) => setScanningRun(r)}
                      onChanged={onChanged}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <AssignedTripCard
              key={run.id}
              run={run}
              driver={run.driverId ? driverName.get(run.driverId) ?? shortId(run.driverId) : 'غير محدد'}
              couriers={[...driverName.entries()]}
              onStartScan={(r) => setScanningRun(r)}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      {scanningRun ? (
        <ContinuousHandoffModal
          runId={scanningRun.id}
          runTitle={`مشوار #${shortId(scanningRun.id)}`}
          driverName={scanningRun.driverId ? driverName.get(scanningRun.driverId) ?? undefined : undefined}
          isOpen={Boolean(scanningRun)}
          onClose={() => setScanningRun(null)}
          onComplete={() => {
            onChanged()
            setScanningRun(null)
          }}
        />
      ) : null}
    </div>
  )
}

function AssignedTripCard({
  run,
  driver,
  couriers,
  onStartScan,
  onChanged,
}: {
  run: Run
  driver: string
  couriers?: Array<[string, string]>
  onStartScan?: (run: Run) => void
  onChanged: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const detail = useApi<RunDetail>(`/fulfillment/delivery-batches/${run.id}`, { pollMs: 8000 })
  const dispatch = useCommand(() =>
    api(`/fulfillment/delivery-batches/${run.id}/dispatch`, { method: 'POST' })
  )

  const reassign = useCommand((driverId: string) =>
    api(`/fulfillment/delivery-batches/${run.id}/driver`, { method: 'PATCH', body: { driverId } })
  )
  const stops = detail.data?.stops ?? []
  const handedOverCount = stops.filter((s) => s.handedOver).length
  const totalStops = stops.length || run.stops
  const allHanded = stops.length > 0 && stops.every((s) => s.handedOver)

  return (
    <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 space-y-3 shadow-sm">
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bw-line pb-3">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-bw-sunken border border-bw-line">
            <User className="size-4 text-bw-ink-soft" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-bw-ink text-sm">{driver}</span>
              <span className="text-xs text-bw-ink-soft font-mono">
                مشوار <Code>#{shortId(run.id)}</Code>
              </span>
            </div>
            <div className="text-[11px] text-bw-ink-subtle flex items-center gap-2">
              <Clock className="size-3" />
              <span>أنشئ {formatDateTime(run.plannedAt)}</span>
              <span>·</span>
              <span>{totalStops} طرود</span>
            </div>
          </div>
        </div>

        {/* Handoff Status Pill */}
        <div className="flex items-center gap-2">
          {allHanded ? (
            <StatusLabel tone="ok">جاهز للخروج (استلم كل الطرود)</StatusLabel>
          ) : (
            <StatusLabel tone="pending">
              مستني مسح المندوب ({handedOverCount}/{totalStops})
            </StatusLabel>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-bw-ink-subtle">
          <span>تقدم استلام العهدة في المخزن</span>
          <span>
            {handedOverCount} من {totalStops} طرد
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bw-sunken">
          <div
            className={cn('h-full transition-all duration-300', allHanded ? 'bg-bw-ok' : 'bg-bw-cobalt')}
            style={{ width: `${totalStops ? (handedOverCount / totalStops) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Actions & Disclosure */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs font-semibold text-bw-ink-soft hover:text-bw-ink cursor-pointer"
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          <span>{expanded ? 'إخفاء تفاصيل الطرود' : `عرض الطرود (${stops.length || run.stops})`}</span>
        </button>

        <div className="flex items-center gap-2">
          {onStartScan && !allHanded ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onStartScan(run)}
              className="text-xs font-semibold cursor-pointer"
            >
              <Scan className="size-3.5" aria-hidden />
              <span>مسح تسليم الطرود</span>
            </Button>
          ) : null}

          <Button
            size="sm"
            loading={dispatch.pending}
            disabled={!allHanded}
            onClick={async () => {
              if (await dispatch.execute()) onChanged()
            }}
            className="text-xs cursor-pointer"
          >
            <Truck className="size-4" />
            <span>خروج المشوار</span>
          </Button>
        </div>
      </div>

      {/* The courier can change only while no parcel is in custody yet (the server refuses otherwise). */}
      {couriers && couriers.length > 1 && handedOverCount === 0 && stops.length > 0 ? (
        <Select
          label="تغيير المندوب"
          value={run.driverId ?? ''}
          onChange={async (value) => {
            if (value && value !== run.driverId && (await reassign.execute(value))) onChanged()
          }}
          className="w-full text-xs sm:w-64"
          options={couriers.map(([id, name]) => [id, name] as [string, string])}
        />
      ) : null}
      <CommandError error={reassign.error} />
      <CommandError error={dispatch.error} />

      {/* Collapsible Stops List */}
      {expanded && (
        <div className="rounded-bw-field border border-bw-line bg-bw-sunken/40 overflow-hidden divide-y divide-bw-line animate-in fade-in">
          {stops.map((s) => (
            <div key={s.shipmentId} className="flex items-center justify-between p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono text-bw-ink-subtle">#{s.sequence}</span>
                <span className="font-semibold text-bw-ink font-mono">
                  {s.orderNumber ? s.orderNumber.replace(/^ORD-/, '#') : shortId(s.shipmentId)}
                </span>
                <span className="text-bw-ink-soft truncate max-w-[180px]">{s.area || '—'}</span>
              </div>
              <div>
                {s.handedOver ? (
                  <span className="inline-flex items-center gap-1 text-bw-ok text-[11px] font-semibold">
                    <CheckCircle2 className="size-3.5" />
                    <span>تم الاستلام</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-bw-warn text-[11px]">
                    <Clock className="size-3.5" />
                    <span>بانتظار المسح</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Section 3: جاري التوصيل (Active Out-for-Delivery Trips)
   ───────────────────────────────────────────────────────────── */

function ActiveTripsSection({
  runs,
  driverName,
  onChanged,
}: {
  runs: Run[]
  driverName: Map<string, string>
  onChanged: () => void
}) {
  const [groupByCourier, setGroupByCourier] = React.useState(false)

  if (runs.length === 0) {
    return (
      <StateBlock
        kind="empty"
        title="مافيش مشاوير جارية حالياً"
        body="المشاوير اللي خرجت للتوصيل في الشارع بتظهر هنا مع مؤشر حي للمتابعة."
      />
    )
  }

  // Group by courier
  const runsByCourier = React.useMemo(() => {
    const map = new Map<string, Run[]>()
    for (const r of runs) {
      const cId = r.driverId || 'unassigned'
      map.set(cId, [...(map.get(cId) ?? []), r])
    }
    return map
  }, [runs])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs border-b border-bw-line pb-2">
        <span className="text-bw-ink-soft">المشاوير الجارية في الشارع حالياً:</span>
        <button
          type="button"
          onClick={() => setGroupByCourier(!groupByCourier)}
          className="flex items-center gap-1.5 font-semibold text-bw-cobalt hover:underline cursor-pointer"
        >
          <Users className="size-3.5" />
          <span>{groupByCourier ? 'عرض كل المشاوير منفصلة' : 'تجميع حسب المندوب'}</span>
        </button>
      </div>

      {groupByCourier ? (
        <div className="space-y-4">
          {Array.from(runsByCourier.entries()).map(([cId, courierRuns]) => {
            const name = cId === 'unassigned' ? 'غير مسند لمندوب' : driverName.get(cId) ?? shortId(cId)
            const totalStops = courierRuns.reduce((sum, r) => sum + r.stops, 0)

            return (
              <div
                key={cId}
                className="rounded-bw-card border border-bw-line bg-bw-surface/90 p-4 space-y-3 shadow-xs"
              >
                <div className="flex items-center justify-between border-b border-bw-line pb-2.5">
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-bw-cobalt" />
                    <span className="font-bold text-sm text-bw-ink">{name}</span>
                    <span className="text-xs text-bw-ink-soft font-mono">
                      ({courierRuns.length} مشاوير · {totalStops} طرود)
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {courierRuns.map((run) => (
                    <ActiveTripCard
                      key={run.id}
                      run={run}
                      driver={name}
                      onChanged={onChanged}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <ActiveTripCard
              key={run.id}
              run={run}
              driver={run.driverId ? driverName.get(run.driverId) ?? shortId(run.driverId) : 'غير محدد'}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ActiveTripCard({
  run,
  driver,
}: {
  run: Run
  driver: string
  onChanged: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const detail = useApi<RunDetail>(`/fulfillment/delivery-batches/${run.id}`, { pollMs: 10000 })
  const stops = detail.data?.stops ?? []

  const deliveredCount = stops.filter((s) => s.shipmentStatus === 'delivered').length
  const failedCount = stops.filter((s) => s.shipmentStatus === 'failed').length
  const totalStops = stops.length || run.stops
  const activeCount = totalStops - deliveredCount - failedCount

  return (
    <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 space-y-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bw-line pb-3">
        <div className="flex items-center gap-3">
          <div className="relative grid size-9 place-items-center rounded-lg bg-bw-ok/10 border border-bw-ok/30">
            <Truck className="size-4 text-bw-ok" />
            <span className="absolute -top-1 -right-1 size-2 rounded-full bg-bw-ok" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-bw-ink text-sm">{driver}</span>
              <span className="text-xs text-bw-ink-soft font-mono">
                مشوار <Code>#{shortId(run.id)}</Code>
              </span>
            </div>
            <div className="text-[11px] text-bw-ink-subtle flex items-center gap-2">
              <Clock className="size-3" />
              <span>خرج {formatDateTime(run.dispatchedAt)}</span>
              <span>·</span>
              <span>{totalStops} محطات</span>
            </div>
          </div>
        </div>

        {/* Subtle Green Indicator */}
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bw-ok opacity-75"></span>
            <span className="relative inline-flex rounded-full size-2 bg-bw-ok"></span>
          </span>
          <StatusLabel tone="ok">في الطريق</StatusLabel>
        </div>
      </div>

      {/* Delivery Progress Bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="text-bw-ink-soft">
            تم تسليم {deliveredCount} من {totalStops}
            {failedCount > 0 ? ` · ${failedCount} لم تكتمل` : ''}
          </span>
          <span className="font-mono text-bw-ink font-semibold">
            {totalStops ? Math.round((deliveredCount / totalStops) * 100) : 0}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-bw-sunken flex">
          <div
            className="h-full bg-bw-ok transition-all duration-300"
            style={{ width: `${totalStops ? (deliveredCount / totalStops) * 100 : 0}%` }}
          />
          <div
            className="h-full bg-bw-danger transition-all duration-300"
            style={{ width: `${totalStops ? (failedCount / totalStops) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Breakdown chips & disclosure */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        <div className="flex items-center gap-2 text-bw-ink-soft">
          <span className="inline-flex items-center gap-1 font-mono text-[11px]">
            <span className="size-2 rounded-full bg-bw-ok inline-block" /> {deliveredCount} تم التسليم
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[11px]">
            <span className="size-2 rounded-full bg-bw-warn inline-block" /> {activeCount} متبقي
          </span>
          {failedCount > 0 ? (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-bw-danger">
              <span className="size-2 rounded-full bg-bw-danger inline-block" /> {failedCount} تعذر
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 font-semibold text-bw-ink-soft hover:text-bw-ink cursor-pointer"
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          <span>{expanded ? 'إخفاء المحطات' : 'عرض المحطات'}</span>
        </button>
      </div>

      {expanded && (
        <div className="rounded-bw-field border border-bw-line bg-bw-sunken/40 overflow-hidden divide-y divide-bw-line animate-in fade-in">
          {stops.map((s) => (
            <div key={s.shipmentId} className="flex items-center justify-between p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono text-bw-ink-subtle">#{s.sequence}</span>
                <span className="font-semibold text-bw-ink font-mono">
                  {s.orderNumber ? s.orderNumber.replace(/^ORD-/, '#') : shortId(s.shipmentId)}
                </span>
                <span className="text-bw-ink-soft truncate max-w-[200px]">{s.area || '—'}</span>
              </div>
              <div>
                <Status map={SHIPMENT_STATUS} value={s.shipmentStatus} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Section 4: بانتظار التسوية (Awaiting Settlement Queue)
   ───────────────────────────────────────────────────────────── */

function SettlementQueueSection({
  items,
  onOpenSettle,
}: {
  items: Array<{
    id: string
    courierId: string
    courierName: string
    run?: Run
    runOrderIds?: string[]
    summary?: RunSettlementSummary
    unsettledCollections: Collection[]
  }>
  onOpenSettle: (item: {
    courierId: string
    courierName: string
    runId?: string
    runOrderIds?: string[]
  }) => void
  onChanged: () => void
}) {
  if (items.length === 0) {
    return (
      <StateBlock
        kind="empty"
        title="مافيش عهد أو مرتجعات بانتظار التسوية"
        body="كل النقدية اتعدّت وكل الطرود المرتجعة اتستلمت في المخزن بدون التزامات مفتوحة."
      />
    )
  }

  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        // Run rows read the server's settlement answer; only cash that belongs to no listed run falls back to its collections.
        const summary = item.summary
        const state: SettlementState = summary?.state ?? 'pending'
        const [stateLabel, stateTone] = RUN_SETTLEMENT_STATE[state] ?? [state, 'neutral' as const]
        const awaitingCash = summary
          ? summary.cash.awaitingCount > 0
          : item.unsettledCollections.length > 0
        const expectedAwaiting = item.unsettledCollections.reduce((sum, c) => sum + Number(c.expectedAmount), 0)
        const declaredAwaiting = item.unsettledCollections.reduce((sum, c) => sum + Number(c.declaredAmount ?? 0), 0)
        const facts: React.ReactNode[] = []
        if (summary) {
          if (summary.stops.delivered > 0) facts.push(<span key="d">{summary.stops.delivered} اتسلّم</span>)
          if (summary.cash.codOrders > 0) {
            facts.push(
              <span key="c">
                نقدية <Egp value={summary.cash.expectedTotal} />
                {summary.cash.awaitingCount > 0 ? ` · ${summary.cash.awaitingCount} مستنية العدّ` : ' · اتعدّت'}
              </span>
            )
          } else if (summary.stops.delivered > 0) {
            facts.push(<span key="z">بدون تحصيل نقدي</span>)
          }
          const returns = summary.stops.pendingReturns
          if (returns > 0) facts.push(<span key="r" className="text-bw-danger">{returns} مرتجع لسه مع المندوب</span>)
          else if (summary.stops.returnedToHub > 0) facts.push(<span key="rr">{summary.stops.returnedToHub} مرتجع استلمه المخزن</span>)
        } else {
          facts.push(<span key="o">{item.unsettledCollections.length} طلب — <Egp value={expectedAwaiting} /> متوقع، أعلن المندوب <Egp value={declaredAwaiting} /></span>)
        }
        const empty = summary?.blockers.some((b) => b.code === 'NO_STOPS' || b.code === 'NO_OUTCOMES')
        const actionLabel =
          state === 'settled' ? 'إغلاق المشوار' : awaitingCash ? 'عدّ النقدية' : state === 'reconciliation_required' ? 'مطابقة' : 'مراجعة'
        const canOpen = !summary || !empty || summary.stops.total > 0

        return (
          <div
            key={item.id}
            className="rounded-bw-card border border-bw-line bg-bw-surface px-4 py-3 shadow-sm transition-colors hover:border-bw-cobalt/40"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-bw-ink">{item.courierName}</span>
                  {item.run ? (
                    <span className="font-mono text-xs text-bw-ink-soft">
                      مشوار <Code>#{shortId(item.run.id)}</Code>
                    </span>
                  ) : (
                    <span className="text-xs text-bw-ink-soft">نقدية خارج مشاوير هذه الصفحة</span>
                  )}
                  {summary ? <StatusLabel tone={stateTone}>{stateLabel}</StatusLabel> : <StatusLabel tone="warn">بانتظار العدّ</StatusLabel>}
                </div>
                <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-bw-ink-subtle">
                  {facts.map((fact, i) => (
                    <React.Fragment key={i}>
                      {i > 0 ? <span aria-hidden>·</span> : null}
                      {fact}
                    </React.Fragment>
                  ))}
                </p>
                {summary && summary.stops.total === 0 ? (
                  <p className="text-[11px] text-bw-danger">{RUN_BLOCKER.NO_STOPS(0)}</p>
                ) : null}
              </div>
              <Button
                variant={state === 'settled' || awaitingCash ? 'primary' : 'secondary'}
                size="sm"
                disabled={!canOpen}
                onClick={() =>
                  onOpenSettle({
                    courierId: item.courierId,
                    courierName: item.courierName,
                    runId: item.run?.id,
                    runOrderIds: item.runOrderIds,
                  })
                }
                className="text-xs font-semibold cursor-pointer"
              >
                <Wallet className="size-4" aria-hidden />
                <span>{actionLabel}</span>
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Section 5: المغلقة (Closed Trips)
   ───────────────────────────────────────────────────────────── */

function ClosedTripsSection({
  runs,
  driverName,
}: {
  runs: Run[]
  driverName: Map<string, string>
}) {
  if (runs.length === 0) {
    return (
      <StateBlock
        kind="empty"
        title="مافيش مشاوير مغلقة"
        body="المشاوير اللي اتسوّت عهدتها بالكامل واتقفلت في المخزن بتتحفظ هنا في السجل."
      />
    )
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <div
          key={run.id}
          className="rounded-bw-card border border-bw-line bg-bw-surface p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm opacity-90"
        >
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-bw-ok/10 border border-bw-ok/30">
              <CheckCircle2 className="size-4 text-bw-ok" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-bw-ink text-sm">
                  {run.driverId ? driverName.get(run.driverId) ?? shortId(run.driverId) : '—'}
                </span>
                <span className="text-xs text-bw-ink-soft font-mono">
                  مشوار <Code>#{shortId(run.id)}</Code>
                </span>
              </div>
              <div className="text-[11px] text-bw-ink-subtle">
                اكتمل {formatDateTime(run.completedAt || run.dispatchedAt)} · {run.stops} محطات
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusLabel tone="ok">مغلق ومُسوّى بالكامل</StatusLabel>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Modal / Drawer 1: تسوية عهدة المندوب (Integrated Settlement)
   ───────────────────────────────────────────────────────────── */

function SettlementDrawer({
  hubId,
  courierId,
  courierName,
  runId,
  collections,
  onClose,
  onSettled,
}: {
  hubId: string
  courierId: string
  courierName: string
  runId?: string
  /** Declared cash of orders that belong to no run (only used when there is no runId). */
  collections: Collection[]
  onClose: () => void
  onSettled: () => void
}) {
  const [receipt, setReceipt] = React.useState<SettlementReceipt | null>(null)
  const [countedInput, setCountedInput] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [showOrders, setShowOrders] = React.useState(false)

  // The run's settlement position comes from the server: stops, delivered orders, cash and what blocks closing it.
  const detail = useApi<RunSettlementDetail>(runId ? `/fulfillment/delivery-batches/${runId}/settlement` : null)
  const run = detail.data

  // Stable reference for idempotent settlement submission
  const reference = React.useRef(
    `CNT-${new Date().toISOString().slice(0, 10)}-${courierId.slice(0, 6)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase()
  )

  // Cash waiting for the cashier's count.
  const awaiting = React.useMemo(() => {
    if (runId) {
      return (run?.deliveredOrders ?? [])
        .filter((o) => o.cash?.status === 'collected')
        .map((o) => ({
          orderId: o.orderId,
          orderNumber: o.orderNumber ?? shortId(o.orderId),
          expected: o.cash!.expectedAmount,
          declared: o.cash!.declaredAmount,
        }))
    }
    return collections.map((c) => ({
      orderId: c.orderId,
      orderNumber: c.orderNumber,
      expected: Number(c.expectedAmount),
      declared: c.declaredAmount === null ? null : Number(c.declaredAmount),
    }))
  }, [runId, run, collections])

  const expectedTotal = awaiting.reduce((sum, r) => sum + r.expected, 0)
  const declaredTotal = awaiting.reduce((sum, r) => sum + (r.declared ?? 0), 0)
  const amount = Number(countedInput)
  const isInputValid = countedInput.trim() !== '' && Number.isFinite(amount) && amount >= 0
  const variance = isInputValid ? Math.round((amount - expectedTotal) * 100) / 100 : null

  // Settle round command - strictly scoped to the cash this run delivered
  const settle = useCommand(() =>
    api<RoundTotals & { lines: SettlementLine[] }>('/ordering/settlements/rounds', {
      body: {
        courierId,
        locationId: hubId,
        reference: reference.current,
        runId: runId || undefined,
        orderIds: awaiting.map((a) => a.orderId),
        countedTotal: Math.round(amount * 100) / 100,
        notes: notes.trim() || undefined,
      },
    })
  )

  // Complete run: the server refuses it unless the run is settled.
  const completeRun = useCommand(() => api(`/fulfillment/delivery-batches/${runId}/complete`, { method: 'POST' }))

  const handleCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isInputValid) return
    const confirmed = window.confirm(
      `تأكيد عدّ واستلام مبلغ ${amount.toLocaleString('en-US')} ج.م من المندوب ${courierName}؟\nالتسوية بتتسجل نهائياً بالمرجع: ${reference.current}`
    )
    if (!confirmed) return

    const done = await settle.execute()
    if (done) {
      setReceipt({
        name: courierName,
        reference: reference.current,
        round: done,
        lines: done.lines,
        orderNumbers: Object.fromEntries(awaiting.map((r) => [r.orderId, r.orderNumber])),
      })
      detail.reload()
      onSettled()
    }
  }

  const refreshAfterReturn = () => {
    detail.reload()
    onSettled()
  }

  const state = run?.state
  const [stateLabel, stateTone] = state ? RUN_SETTLEMENT_STATE[state] ?? [state, 'neutral' as const] : ['', 'neutral' as const]
  const returns: ReturnParcel[] = run?.pendingReturns ?? []
  const counted = run?.settlements ?? []
  const cashDue = awaiting.length > 0 && !receipt

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settlement-drawer-title"
      className="fixed inset-0 z-50 flex bg-bw-kohl/70 animate-in fade-in"
    >
      {/* Responsive Sheet (Mobile) & Drawer (Desktop) */}
      <div
        className={cn(
          'bg-bw-surface text-bw-ink border-bw-line shadow-bw-overlay flex flex-col',
          // Desktop: compact side drawer
          'md:ms-auto md:me-0 md:h-dvh md:max-h-dvh md:w-[min(28rem,100%)] md:border-s',
          // Mobile: bottom sheet
          'max-md:mx-auto max-md:mb-0 max-md:mt-auto max-md:max-h-[92dvh] max-md:w-full max-md:rounded-t-bw-card max-md:border-t'
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-bw-line px-4 py-3">
          <div className="min-w-0 space-y-1">
            <h2 id="settlement-drawer-title" className="text-sm font-bold text-bw-ink">
              تسوية {runId ? <>مشوار <Code>#{shortId(runId)}</Code> — </> : null}{courierName}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-bw-ink-subtle">
              {state ? <StatusLabel tone={stateTone}>{stateLabel}</StatusLabel> : null}
              {cashDue ? <span>مرجع العدّ <Code>{reference.current}</Code></span> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="grid size-8 shrink-0 place-items-center rounded-full text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink cursor-pointer transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {runId && detail.loading && !run ? <Skeleton className="h-24 w-full rounded-bw-card" /> : null}
          {runId && detail.error ? <LoadError message={detail.error.message} onRetry={detail.reload} /> : null}

          {/* Compact summary: only what this run actually has */}
          {run ? (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-bw-field border border-bw-line bg-bw-line sm:grid-cols-4">
              <div className="bg-bw-surface p-2.5">
                <dt className="text-[11px] text-bw-ink-subtle">اتسلّم</dt>
                <dd className="font-mono text-sm font-bold">{run.stops.delivered}<span className="text-[11px] font-normal text-bw-ink-subtle"> / {run.stops.total}</span></dd>
              </div>
              <div className="bg-bw-surface p-2.5">
                <dt className="text-[11px] text-bw-ink-subtle">نقدية متوقعة</dt>
                <dd className="font-mono text-sm font-bold">
                  {run.cash.codOrders > 0 ? <Egp value={run.cash.expectedTotal} /> : <span className="text-[11px] font-normal text-bw-ink-soft">بدون تحصيل</span>}
                </dd>
              </div>
              <div className="bg-bw-surface p-2.5">
                <dt className="text-[11px] text-bw-ink-subtle">{run.cash.codOrders > 0 && run.cash.counted === run.cash.codOrders ? 'اتعدّ' : 'أعلن المندوب'}</dt>
                <dd className="font-mono text-sm font-bold">
                  {run.cash.codOrders === 0 ? '—' : <Egp value={run.cash.counted === run.cash.codOrders ? run.cash.countedTotal : run.cash.declaredTotal} />}
                </dd>
              </div>
              <div className="bg-bw-surface p-2.5">
                <dt className="text-[11px] text-bw-ink-subtle">مرتجعات</dt>
                <dd className="font-mono text-sm font-bold">
                  {run.stops.pendingReturns + run.stops.returnedToHub}
                  {run.stops.pendingReturns > 0 ? <span className="text-[11px] font-normal text-bw-danger"> ({run.stops.pendingReturns} مفتوح)</span> : null}
                </dd>
              </div>
            </dl>
          ) : null}

          {/* Explicit status: what is left, or that the run is ready to close */}
          {run && run.state !== 'completed' ? (
            run.blockers.length > 0 ? (
              <Notice tone={run.state === 'reconciliation_required' ? 'warn' : 'info'} title="المتبقي قبل إغلاق المشوار">
                <ul className="list-disc space-y-0.5 ps-4">
                  {run.blockers.map((b) => (
                    <li key={b.code}>{(RUN_BLOCKER[b.code] ?? (() => b.code))(b.count)}</li>
                  ))}
                </ul>
              </Notice>
            ) : (
              <Notice tone="ok" title="كل الالتزامات متطابقة — المشوار جاهز للإغلاق">
                {run.cash.codOrders === 0
                  ? [
                      run.stops.delivered > 0 ? `اتسلّم ${run.stops.delivered} طلب بدون تحصيل نقدي` : 'مافيش نقدية مستحقة',
                      run.stops.returnedToHub > 0 ? `استلم المخزن ${run.stops.returnedToHub} مرتجع` : null,
                    ].filter(Boolean).join(' — ') + '.'
                  : 'النقدية اتعدّت والمرتجعات رجعت المخزن.'}
              </Notice>
            )
          ) : null}
          {run?.state === 'completed' ? <Notice tone="ok" title="المشوار مغلق ومُسوّى بالكامل" /> : null}

          {receipt ? (
            <Notice
              tone={Number(receipt.round.variance) === 0 ? 'ok' : 'warn'}
              title={
                Number(receipt.round.variance) === 0
                  ? 'تم تسجيل العدّ بدون فروق'
                  : `تم تسجيل العدّ مع فرق: ${Number(receipt.round.variance) > 0 ? 'زيادة' : 'عجز'} ${Math.abs(Number(receipt.round.variance)).toLocaleString('en-US')} ج.م — محال للمراجعة الإدارية`
              }
            >
              مرجع <Code>{receipt.reference}</Code> · المعدود <Egp value={receipt.round.countedTotal} />
            </Notice>
          ) : null}

          {/* Cash to count: shown only when there is cash to count */}
          {cashDue ? (
            <form onSubmit={handleCashSubmit} className="space-y-3">
              <div className="flex items-center justify-between border-b border-bw-line pb-1.5">
                <h3 className="flex items-center gap-1.5 text-xs font-bold text-bw-ink-soft">
                  <Wallet className="size-3.5 text-bw-cobalt" aria-hidden />
                  <span>عدّ النقدية ({awaiting.length} طلب)</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowOrders((v) => !v)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-bw-cobalt hover:underline cursor-pointer"
                  aria-expanded={showOrders}
                >
                  {showOrders ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  <span>{showOrders ? 'إخفاء الطلبات' : 'عرض الطلبات'}</span>
                </button>
              </div>

              {showOrders ? (
                <div className="divide-y divide-bw-line overflow-hidden rounded-bw-field border border-bw-line">
                  {awaiting.map((r) => (
                    <div key={r.orderId} className="flex items-center justify-between bg-bw-sunken/30 px-2.5 py-1.5">
                      <span className="font-mono font-semibold">{r.orderNumber.replace(/^ORD-/, '#')}</span>
                      <span className="text-bw-ink-subtle">
                        أعلن <Egp value={r.declared} /> · متوقع <Egp value={r.expected} className="font-bold text-bw-ink" />
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex justify-between rounded-bw-field bg-bw-sunken/50 px-2.5 py-2">
                <span className="text-bw-ink-soft">المتوقع <Egp value={expectedTotal} className="font-bold text-bw-ink" /></span>
                <span className="text-bw-ink-soft">أعلن المندوب <Egp value={declaredTotal} className="font-bold text-bw-ink" /></span>
              </div>

              <Field
                label="المبلغ المعدود فعلياً من المندوب"
                ltr
                inputMode="decimal"
                placeholder="0.00"
                value={countedInput}
                onChange={(e) => setCountedInput(e.target.value)}
              />

              {variance !== null ? (
                variance === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-bw-ok/30 bg-bw-ok/10 p-2 text-bw-ok">
                    <Check className="size-4" aria-hidden />
                    <span className="font-semibold">مطابق للمتوقع تماماً</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-bw-warn/30 bg-bw-warn/10 p-2 text-bw-warn">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                    <span>
                      {variance > 0 ? 'زيادة' : 'عجز'} <strong className="font-mono">{Math.abs(variance).toLocaleString('en-US')} ج.م</strong> عن المتوقع — يُسجَّل الفرق للمراجعة الإدارية.
                    </span>
                  </div>
                )
              ) : null}

              <Field
                label="ملاحظات (اختياري)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أي ملاحظات حول العدّ أو الفروق..."
              />

              <Button type="submit" loading={settle.pending} disabled={!isInputValid} className="w-full py-2 text-xs font-semibold">
                <ShieldCheck className="size-4" aria-hidden />
                <span>تأكيد العدّ {isInputValid ? `(${amount} ج.م)` : ''}</span>
              </Button>
              <CommandError error={settle.error} />
            </form>
          ) : null}

          {/* Cash already counted for this run */}
          {counted.length > 0 ? (
            <div className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-bw-ink-soft">
                <CheckCircle2 className="size-3.5 text-bw-ok" aria-hidden />
                <span>النقدية المعدودة</span>
              </h3>
              {counted.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-bw-field border border-bw-line px-2.5 py-1.5">
                  <span className="text-bw-ink-subtle"><Code>{s.reference}</Code> · {formatDateTime(s.settledAt)}</span>
                  <span className="flex items-center gap-2">
                    <Egp value={s.countedTotal} className="font-bold" />
                    {s.variance === 0 ? (
                      <StatusLabel tone="ok">مطابق</StatusLabel>
                    ) : (
                      <StatusLabel tone="warn">{s.variance < 0 ? 'عجز' : 'زيادة'} {Math.abs(s.variance).toLocaleString('en-US')}</StatusLabel>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Failed parcels still with the courier: scan to take them back */}
          {returns.length > 0 ? (
            <div className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-bw-ink-soft">
                <RotateCcw className="size-3.5 text-bw-danger" aria-hidden />
                <span>مرتجعات لسه مع المندوب ({returns.length})</span>
              </h3>
              <p className="text-[11px] text-bw-ink-subtle">
                امسح باركود البوليصة لتأكيد وصول الطرد للمخزن. لا يُقفل الالتزام بدون مطابقة الباركود.
              </p>
              {returns.map((s) => (
                <ReturnReconcileItem key={s.shipmentId} shipment={s} onReconciled={refreshAfterReturn} />
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer: the primary action is the one the server allows */}
        <div className="flex items-center justify-between gap-2 border-t border-bw-line bg-bw-surface px-4 py-3">
          <Button variant="secondary" size="sm" onClick={onClose} className="text-xs">
            إغلاق
          </Button>
          {runId && run && run.state !== 'completed' ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="primary"
                size="sm"
                loading={completeRun.pending}
                disabled={!run.canComplete}
                onClick={async () => {
                  if (await completeRun.execute()) {
                    onSettled()
                    onClose()
                  }
                }}
                className="text-xs font-semibold"
              >
                <CheckCircle2 className="size-4" aria-hidden />
                <span>إغلاق المشوار</span>
              </Button>
              <CommandError error={completeRun.error} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Individual Return Reconcile Item with Physical Barcode Scan
   ───────────────────────────────────────────────────────────── */

function ReturnReconcileItem({
  shipment,
  onReconciled,
}: {
  shipment: ReturnParcel
  onReconciled: () => void
}) {
  const [barcode, setBarcode] = React.useState('')
  const [devBarcode, setDevBarcode] = React.useState<string | null>(null)

  // Dev barcode generator for quick local testing
  React.useEffect(() => {
    let active = true
    getDevShipmentBarcode(shipment.shipmentId).then((b) => {
      if (active && b) setDevBarcode(b)
    })
    return () => {
      active = false
    }
  }, [shipment.shipmentId])

  const eventCommand = useCommand((type: 'RECEIVED_BACK' | 'RETURNED') =>
    api(`/fulfillment/shipments/${shipment.shipmentId}/events`, {
      body: { type, barcode: barcode.trim() },
    })
  )

  const handleAction = async (type: 'RECEIVED_BACK' | 'RETURNED') => {
    if (!barcode.trim()) return
    if (type === 'RETURNED') {
      const ok = window.confirm('إرجاع الطرد نهائياً للمورد/المخزن؟ سيتم إغلاق الطلب كمرتجع.')
      if (!ok) return
    }
    const success = await eventCommand.execute(type)
    if (success) {
      setBarcode('')
      onReconciled()
    }
  }

  const orderNum = (shipment.orderNumber ?? shortId(shipment.orderId)).replace(/^ORD-/, '#')

  return (
    <div className="rounded-bw-field border border-bw-line bg-bw-sunken/40 p-3 space-y-2.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-bold text-bw-ink font-mono">{orderNum}</span>
        <span className="text-[11px] text-bw-danger font-semibold">تعذر التوصيل</span>
      </div>
      {shipment.area ? <div className="text-[11px] text-bw-ink-subtle">{shipment.area}</div> : null}

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Field
            label="امسح باركود البوليصة الملصق"
            ltr
            autoComplete="off"
            placeholder="SHP-..."
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="flex-1"
          />
          {devBarcode ? (
            <button
              type="button"
              onClick={() => setBarcode(devBarcode)}
              title="ملء الباركود التجريبي تلقائياً (Dev Only)"
              className="mt-5 rounded-bw-field border border-bw-line bg-bw-surface px-2 py-1 text-[10px] text-bw-cobalt hover:bg-bw-sunken cursor-pointer"
            >
              نسخ التجريبي
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            loading={eventCommand.pending}
            disabled={!barcode.trim()}
            onClick={() => handleAction('RECEIVED_BACK')}
            className="text-xs"
          >
            <span>استلام في المخزن (محاولة جديدة)</span>
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={eventCommand.pending}
            disabled={!barcode.trim()}
            onClick={() => handleAction('RETURNED')}
            className="text-xs"
          >
            <span>إرجاع نهائي</span>
          </Button>
        </div>

        <CommandError error={eventCommand.error} />
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Modal / Drawer 2: سجل التسويات السابقة (Past Settlements)
   ───────────────────────────────────────────────────────────── */

function SettlementHistoryDrawer({
  batches,
  driverName,
  loading,
  onClose,
}: {
  hubId: string
  batches: PastSettlementBatch[]
  driverName: Map<string, string>
  loading: boolean
  onClose: () => void
}) {
  const [selectedBatchId, setSelectedBatchId] = React.useState<string | null>(null)
  const batchDetail = useApi<{
    id: string
    reference: string
    expectedTotal: string
    countedTotal: string
    variance: string
    lines: SettlementLine[]
  }>(selectedBatchId ? `/ordering/settlements/batches/${selectedBatchId}` : '', {
    pollMs: 0,
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-drawer-title"
      className="fixed inset-0 z-50 flex bg-bw-kohl/70 animate-in fade-in"
    >
      <div
        className={cn(
          'bg-bw-surface text-bw-ink border-bw-line shadow-bw-overlay flex flex-col',
          'md:ms-auto md:me-0 md:h-dvh md:max-h-dvh md:w-[min(38rem,100%)] md:border-s',
          'max-md:mx-auto max-md:mb-0 max-md:mt-auto max-md:max-h-[92dvh] max-md:w-full max-md:rounded-t-bw-card max-md:border-t'
        )}
      >
        <div className="flex items-center justify-between border-b border-bw-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-bw-sunken border border-bw-line text-bw-ink">
              <History className="size-4" />
            </div>
            <div>
              <h2 id="history-drawer-title" className="text-base font-bold text-bw-ink">
                سجل تسويات النقدية
              </h2>
              <p className="text-[11px] text-bw-ink-subtle">
                التسويات التاريخية المعتمدة في هذا المخزن
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="grid size-8 place-items-center rounded-full text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && batches.length === 0 ? (
            <Skeleton className="h-40 w-full rounded-bw-card" />
          ) : batches.length === 0 ? (
            <div className="text-center py-12 text-bw-ink-soft text-xs">
              لا توجد تسويات سابقة مسجلة في هذا المخزن.
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map((b) => {
                const diff = Number(b.totalCollected) - Number(b.totalExpected)
                const isSelected = selectedBatchId === b.id

                return (
                  <div
                    key={b.id}
                    className="rounded-bw-card border border-bw-line bg-bw-surface p-3.5 space-y-2 text-xs shadow-sm hover:border-bw-ink-soft/40 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-bw-ink">
                        {driverName.get(b.courierId) ?? shortId(b.courierId)}
                      </span>
                      <span className="font-mono text-bw-ink-subtle">
                        <Code>{b.reference}</Code>
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-bw-ink-soft text-[11px]">
                      <span>{formatDateTime(b.settledAt)}</span>
                      <span>
                        المستلم:{' '}
                        <strong className="font-mono text-bw-ink">
                          <Egp value={b.totalCollected} />
                        </strong>
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div>
                        {diff === 0 ? (
                          <StatusLabel tone="ok">مطابق تماماً</StatusLabel>
                        ) : diff < 0 ? (
                          <StatusLabel tone="danger">
                            عجز: {Math.abs(diff).toLocaleString('en-US')} ج.م
                          </StatusLabel>
                        ) : (
                          <StatusLabel tone="warn">
                            زيادة: {diff.toLocaleString('en-US')} ج.م
                          </StatusLabel>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedBatchId(isSelected ? null : b.id)}
                        className="text-[11px] font-semibold text-bw-cobalt hover:underline cursor-pointer"
                      >
                        {isSelected ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
                      </button>
                    </div>

                    {isSelected && (
                      <div className="pt-2 border-t border-bw-line space-y-2 animate-in fade-in">
                        {batchDetail.loading ? (
                          <Skeleton className="h-16 w-full" />
                        ) : batchDetail.data?.lines ? (
                          <div className="divide-y divide-bw-line rounded-bw-field border border-bw-line overflow-hidden bg-bw-sunken/40">
                            {batchDetail.data.lines.map((l) => (
                              <div
                                key={l.orderId}
                                className="flex items-center justify-between p-2 text-[11px]"
                              >
                                <span className="font-mono">
                                  {l.orderNumber ? l.orderNumber.replace(/^ORD-/, '#') : shortId(l.orderId)}
                                </span>
                                <div>
                                  <span className="text-bw-ink-subtle">متوقع: </span>
                                  <span className="font-mono font-semibold">
                                    <Egp value={l.expectedAmount} />
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-bw-line p-4 flex justify-end bg-bw-surface">
          <Button variant="secondary" size="sm" onClick={onClose} className="text-xs">
            إغلاق
          </Button>
        </div>
      </div>
    </div>
  )
}
