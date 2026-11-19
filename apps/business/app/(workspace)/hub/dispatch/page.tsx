'use client'

import * as React from 'react'
import { History, RefreshCw } from 'lucide-react'
import { Button, PageHeader } from '@/components/bw/primitives'
import { CopyToaster } from '@/components/workspace/copy-id'
import { HubShell, useHub } from '@/components/workspace/hub'
import { Page } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { shortId } from '@/lib/labels'
import { runTab, tripSequence, type Run } from '@/lib/trip-ops'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import type { HubShipment } from '../prepare/page'
import { ActiveTab } from './_components/active-tab'
import { AssignTab, type Eligible } from './_components/assign-tab'
import { HistoryDialog } from './_components/history-dialog'
import { SettleTab, type SettleItem } from './_components/settle-tab'
import { SettlementDialog, type SettleTarget } from './_components/settlement-dialog'

/*
 * التسليم للمندوب. The hub employee does three things, so there are three tabs:
 *   توزيع الطلبات  – assign ready orders to couriers; review the trip; send it out once the courier scanned the parcels
 *   جاري التوصيل   – watch trips on the road
 *   التسوية        – receive the cash and the returned parcels, then close the trip
 * Closed trips live behind "سجل المشاوير". Every number comes from the backend (settlement state, expected COD, custody).
 */

type TabKey = 'assign' | 'active' | 'settle'

const TAB_LABEL: Record<TabKey, string> = { assign: 'توزيع الطلبات', active: 'جاري التوصيل', settle: 'التسوية' }

interface Collection {
  orderId: string
  orderNumber: string
  courierId: string | null
  expectedAmount: string
  declaredAmount: string | null
}

export default function HubDispatch() {
  return (
    <HubShell active="handoff">
      <DispatchBody />
    </HubShell>
  )
}

function DispatchBody() {
  const hub = useHub()

  const drivers = useApi<Array<{ id: string; name: string }>>('/workspace/drivers')
  const eligible = useApi<Eligible[]>(`/fulfillment/locations/${hub.id}/eligible-shipments`, { pollMs: 15000 })
  const packed = useApi<{ items: HubShipment[] }>(`/fulfillment/locations/${hub.id}/shipments?status=packed&take=100`, { pollMs: 15000 })
  const runs = useApi<{ items: Run[] }>(`/fulfillment/locations/${hub.id}/runs?status=planning,dispatched&take=100`, { pollMs: 15000 })
  const collections = useApi<{ items: Collection[] }>(`/ordering/settlements/collections?locationId=${hub.id}&status=collected&take=100`, { pollMs: 15000 })

  const couriers = React.useMemo(() => drivers.data ?? [], [drivers.data])
  const courierName = React.useMemo(() => new Map(couriers.map((d) => [d.id, d.name])), [couriers])
  const orderOf = React.useMemo(() => new Map((packed.data?.items ?? []).map((s) => [s.shipmentId, s])), [packed.data])
  const nameOf = React.useCallback((id: string | null) => (id ? courierName.get(id) ?? shortId(id) : 'بدون مندوب'), [courierName])

  const [tab, setTab] = React.useState<TabKey>('assign')
  const [settling, setSettling] = React.useState<SettleTarget | null>(null)
  const [historyOpen, setHistoryOpen] = React.useState(false)

  const reloadAll = React.useCallback(() => {
    eligible.reload()
    packed.reload()
    runs.reload()
    collections.reload()
  }, [eligible, packed, runs, collections])

  const allRuns = React.useMemo(() => runs.data?.items ?? [], [runs.data])
  const planningRuns = React.useMemo(() => allRuns.filter((r) => runTab(r) === 'assign'), [allRuns])
  const activeRuns = React.useMemo(() => allRuns.filter((r) => runTab(r) === 'active'), [allRuns])
  const sequence = React.useMemo(() => tripSequence(allRuns), [allRuns])

  // Back from the road: each trip is its own settlement unit, with the state the server computed (never "no collections found").
  const settleItems = React.useMemo<SettleItem[]>(() => {
    const items: SettleItem[] = []
    const covered = new Set<string>()
    for (const r of allRuns) {
      for (const orderId of r.stopOrderIds ?? []) covered.add(orderId)
      if (runTab(r) !== 'settle' || !r.driverId) continue
      items.push({ id: r.id, courierId: r.driverId, courierName: nameOf(r.driverId), run: r })
    }
    // Declared cash that belongs to no trip listed here (older trips) still has to be counted.
    const loose = new Map<string, Collection[]>()
    for (const c of collections.data?.items ?? []) {
      if (c.courierId && !covered.has(c.orderId)) loose.set(c.courierId, [...(loose.get(c.courierId) ?? []), c])
    }
    for (const [courierId, list] of loose) {
      items.push({
        id: `loose-${courierId}`,
        courierId,
        courierName: nameOf(courierId),
        looseCash: {
          orders: list.map((c) => c.orderId),
          expected: list.reduce((sum, c) => sum + Number(c.expectedAmount), 0),
          declared: list.reduce((sum, c) => sum + Number(c.declaredAmount ?? 0), 0),
        },
      })
    }
    return items
  }, [allRuns, collections.data, nameOf])

  const counts: Record<TabKey, number> = {
    assign: (eligible.data?.length ?? 0) + planningRuns.length,
    active: activeRuns.length,
    settle: settleItems.length,
  }

  // Open on the tab that has work: URL ?tab=… wins, then settlement (money waiting), then assignment, then the road.
  const picked = React.useRef(false)
  React.useEffect(() => {
    if (picked.current || runs.loading || eligible.loading) return
    picked.current = true
    const param = new URLSearchParams(window.location.search).get('tab')
    if (param === 'assign' || param === 'active' || param === 'settle') return setTab(param)
    if (counts.assign > 0) setTab('assign')
    else if (counts.settle > 0) setTab('settle')
    else if (counts.active > 0) setTab('active')
  }, [runs.loading, eligible.loading, counts.assign, counts.settle, counts.active])

  const loading = eligible.loading || packed.loading || runs.loading || collections.loading
  const looseCollections = collections.data?.items ?? []
  const errors = [eligible.error, runs.error].filter(Boolean)

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const keys = Object.keys(TAB_LABEL) as TabKey[]
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const step = (event.key === 'ArrowRight') === rtl ? -1 : 1
    const next = keys[(keys.indexOf(tab) + step + keys.length) % keys.length]
    setTab(next)
    ;(event.currentTarget.querySelector(`#dispatch-tab-${next}`) as HTMLButtonElement | null)?.focus()
  }

  return (
    <Page>
      <PageHeader
        title="التسليم للمندوب"
        meta={hub.name}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
              <History className="size-4" aria-hidden />
              سجل المشاوير
            </Button>
            <Button variant="ghost" size="sm" onClick={reloadAll} loading={loading} aria-label="تحديث">
              {loading ? null : <RefreshCw className="size-4" aria-hidden />}
              تحديث
            </Button>
          </>
        }
      />

      {errors.length > 0 ? <LoadError message={errors[0]!.message} onRetry={reloadAll} /> : null}

      <div role="tablist" aria-label="مراحل التسليم" onKeyDown={onTabKeyDown} className="flex gap-1 border-b border-bw-line">
        {(Object.keys(TAB_LABEL) as TabKey[]).map((key) => {
          const selected = tab === key
          return (
            <button
              key={key}
              id={`dispatch-tab-${key}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls="dispatch-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-bw-small transition-colors sm:gap-2 sm:px-4 sm:text-bw-body',
                selected ? 'border-bw-ink font-semibold text-bw-ink' : 'border-transparent text-bw-ink-soft hover:text-bw-ink',
              )}
            >
              {TAB_LABEL[key]}
              <span className={cn('min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums', counts[key] > 0 ? 'bg-bw-sunken text-bw-ink' : 'text-bw-ink-subtle')}>
                {counts[key]}
              </span>
            </button>
          )
        })}
      </div>

      <div id="dispatch-panel" role="tabpanel" aria-labelledby={`dispatch-tab-${tab}`} className="pt-1">
        {tab === 'assign' ? (
          <AssignTab
            hubId={hub.id}
            eligible={eligible.data ?? []}
            orderOf={orderOf}
            couriers={couriers}
            courierName={courierName}
            planningRuns={planningRuns}
            sequence={sequence}
            loading={(eligible.loading && !eligible.data) || (runs.loading && !runs.data)}
            onChanged={reloadAll}
          />
        ) : null}
        {tab === 'active' ? <ActiveTab runs={activeRuns} courierName={courierName} sequence={sequence} /> : null}
        {tab === 'settle' ? <SettleTab items={settleItems} sequence={sequence} onOpen={setSettling} /> : null}
      </div>

      {settling ? (
        <SettlementDialog
          hubId={hub.id}
          target={settling}
          collections={looseCollections}
          onClose={() => setSettling(null)}
          onChanged={reloadAll}
        />
      ) : null}

      {historyOpen ? (
        <HistoryDialog
          hubId={hub.id}
          courierName={courierName}
          onOpenTrip={setSettling}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      <CopyToaster />
    </Page>
  )
}
