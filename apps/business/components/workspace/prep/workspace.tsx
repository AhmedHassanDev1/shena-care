'use client'

import * as React from 'react'
import { ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react'
import { Button, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Meter } from '@/components/bw/ops'
import { useHub } from '@/components/workspace/hub'
import { PendingCosts, type PendingCost } from '@/components/workspace/buy-costs'
import { LoadError } from '@/components/workspace/role-shell'
import type { PackagingCosts } from '@/components/workspace/pack-card'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { type Desk, type DeskOrder, type Packaging, STAGE_LABEL, receivedOf, shortNumber, unitsOf } from './model'
import { PrepBar } from './bar'
import { UnitsPanel } from './units-panel'
import { ProductRow } from './product'
import { type PackInfo, VerifyStep } from './verify'

/**
 * Orders & Preparation: pick an order, then one step at a time — verify the products, choose the packaging, print, hand off.
 * Desktop shows the compact queue beside the workspace; a phone shows the queue first and the order as its own screen.
 */
export function PreparationDesk() {
  const hub = useHub()
  const desk = useApi<Desk>(`/fulfillment/locations/${hub.id}/desk`, { pollMs: 20000 })
  const costs = useApi<{ packagingCosts: PackagingCosts }>('/order-costs/pending?take=1')
  const pendingCosts = useApi<{ pending: number; items: PendingCost[] }>('/buy-list/costs?pending=true&take=50', { pollMs: 30000 })
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [onPhone, setOnPhone] = React.useState<'queue' | 'order'>('queue')
  const [override, setOverride] = React.useState<DeskOrder | null>(null)
  const [packInfo, setPackInfo] = React.useState<PackInfo>({})
  // A packed parcel leaves the list at once; this keeps the confirmation on screen so it is never missed.
  const [handedOff, setHandedOff] = React.useState<string | null>(null)
  const orders = desk.data?.orders ?? []
  React.useEffect(() => { setOverride(null) }, [desk.data])
  React.useEffect(() => {
    if (!orders.length) { setSelectedId(null); return }
    if (!selectedId || !orders.some((o) => o.orderId === selectedId)) {
      if (window.matchMedia('(min-width: 1024px)').matches) setSelectedId(orders[0].orderId)
    }
  }, [orders, selectedId])
  const listed = orders.find((o) => o.orderId === selectedId) ?? null
  const selected = override && override.orderId === selectedId ? override : listed
  const reload = () => { desk.reload(); pendingCosts.reload() }
  const pick = (id: string) => { setSelectedId(id); setHandedOff(null); setOnPhone('order') }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[84rem] space-y-4 overflow-x-clip px-4 py-4 lg:px-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-bw-title font-semibold text-bw-ink">الطلبات والتجهيز</h1>
        <Button variant="secondary" size="sm" onClick={desk.reload} loading={desk.loading && !!desk.data} aria-label="تحديث القائمة">
          {!(desk.loading && !!desk.data) ? <RefreshCw className="size-4" aria-hidden /> : null}<span className="hidden sm:inline">تحديث</span>
        </Button>
      </header>

      {desk.error ? <LoadError message={desk.error.message} onRetry={desk.reload} /> : null}
      {!desk.data && desk.loading ? <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]"><Skeleton className="h-64 w-full" /><Skeleton className="hidden h-64 w-full lg:block" /></div> : null}

      {desk.data && orders.length === 0 && !handedOff ? (
        <div className="bw-panel"><StateBlock kind="empty" title="مافيش طلبات مستنية تجهيز" body="أول ما حاجة تتسجّل «اتشترت» في المشتريات، الطلب بتاعها بيظهر هنا." /></div>
      ) : null}

      {(orders.length > 0 || handedOff) ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
          <nav aria-label="الطلبات المفتوحة" className={cn('lg:block', onPhone === 'order' ? 'hidden' : 'block')}>
            <ul className="space-y-2">
              {orders.map((order) => <QueueItem key={order.orderId} order={order} active={order.orderId === selectedId} onPick={() => pick(order.orderId)} />)}
            </ul>
          </nav>

          <div className={cn('min-w-0 lg:block', onPhone === 'queue' ? 'hidden' : 'block')}>
            <button type="button" onClick={() => setOnPhone('queue')} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-bw-small font-semibold text-bw-ink-soft lg:hidden">
              <ArrowRight className="size-4" aria-hidden />كل الطلبات
            </button>
            {handedOff && !selected ? (
              <div className="bw-panel space-y-3 p-6 text-center">
                <CheckCircle2 className="mx-auto size-10 text-bw-emerald" aria-hidden />
                <p className="text-bw-heading font-semibold text-bw-ink">الطلب {shortNumber(handedOff)} جاهز للتسليم</p>
                <p className="text-bw-small text-bw-ink-soft">اتغلّف واتطبع وراح لمندوب التوصيل.</p>
                {orders.length ? <Button size="touch" onClick={() => pick(orders[0].orderId)}>الطلب اللي بعده</Button> : null}
              </div>
            ) : selected ? (
              <OrderWorkspace key={selected.orderId} order={selected} hubId={hub.id} lastLots={desk.data?.lastLots ?? {}} lastCosts={desk.data?.lastCosts ?? {}}
                packagingCosts={costs.data?.packagingCosts ?? null} packInfo={packInfo} setPackInfo={setPackInfo}
                onOrder={setOverride} onChanged={reload} onPacked={() => setHandedOff(selected.orderNumber)} />
            ) : (
              <div className="bw-panel hidden lg:block"><StateBlock kind="empty" title="اختار طلب من القايمة" /></div>
            )}
          </div>
        </div>
      ) : null}

      {pendingCosts.data && pendingCosts.data.items.length > 0 ? <div className="hidden lg:block"><PendingCosts items={pendingCosts.data.items} onSaved={() => { pendingCosts.reload(); desk.reload() }} /></div> : null}
    </div>
  )
}

function QueueItem({ order, active, onPick }: { order: DeskOrder; active: boolean; onPick: () => void }) {
  const total = unitsOf(order)
  const have = receivedOf(order)
  const stage = STAGE_LABEL[order.stage]
  const first = order.lines[0]?.productName ?? ''
  return (
    <li>
      <button type="button" aria-current={active ? 'true' : undefined} onClick={onPick}
        className={cn('flex min-h-20 w-full flex-col gap-2 rounded-bw-card border p-3 text-start transition-colors',
          active ? 'border-bw-cobalt/60 bg-bw-cobalt-soft' : 'border-bw-line bg-bw-surface hover:bg-bw-sunken')}>
        <span className="flex items-center justify-between gap-2">
          <strong className="text-bw-body tabular-nums text-bw-ink" dir="ltr">{shortNumber(order.orderNumber)}</strong>
          <StatusLabel tone={stage.tone}>{stage.label}</StatusLabel>
        </span>
        <span className="truncate text-bw-small text-bw-ink-soft"><bdi>{first}</bdi>{order.lines.length > 1 ? ` +${order.lines.length - 1}` : ''}</span>
        <span className="flex items-center gap-2">
          <Meter value={have} max={total} tone={have >= total ? 'emerald' : 'cobalt'} label={`وصل ${have} من ${total}`} className="flex-1" />
          <span className="text-[12px] tabular-nums text-bw-ink-soft" dir="ltr">{have}/{total}</span>
        </span>
      </button>
    </li>
  )
}

function OrderWorkspace({ order, hubId, lastLots, lastCosts, packagingCosts, packInfo, setPackInfo, onOrder, onChanged, onPacked }: {
  order: DeskOrder; hubId: string; lastLots: Desk['lastLots']; lastCosts: Desk['lastCosts']; packagingCosts: PackagingCosts | null
  packInfo: PackInfo; setPackInfo: React.Dispatch<React.SetStateAction<PackInfo>>
  onOrder: (order: DeskOrder) => void; onChanged: () => void; onPacked: () => void
}) {
  const packaging = useApi<Packaging>(`/order-costs/${order.orderId}`)
  const verified = order.stage === 'packing' && !!order.shipment

  return (
    <section aria-label={`طلب ${shortNumber(order.orderNumber)}`} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-bw-heading font-semibold text-bw-ink">طلب <span className="tabular-nums" dir="ltr">{shortNumber(order.orderNumber)}</span></h2>
        <span className="text-bw-small text-bw-ink-soft">{unitsOf(order)} قطعة{order.area ? <> · <bdi>{order.area}</bdi></> : null}</span>
      </div>
      <PrepBar order={order} packaging={packaging.data ?? null} costs={packagingCosts} onPackaging={packaging.reload} onChanged={onChanged} onPacked={onPacked} />
      <div className="bw-panel space-y-4 p-4">
        {verified ? (
          <>
            <p className="flex items-center gap-2 text-bw-small font-semibold text-bw-ink"><CheckCircle2 className="size-5 text-bw-emerald" aria-hidden />{unitsOf(order)} قطعة اتمسحت واتأكدت</p>
            <ul className="divide-y divide-bw-line overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface">{order.lines.map((line) => <ProductRow key={line.orderItemId} line={line} />)}</ul>
            <UnitsPanel order={order} hubId={hubId} onOrder={onOrder} onChanged={onChanged} />
          </>
        ) : (
          <VerifyStep order={order} hubId={hubId} lastLots={lastLots} lastCosts={lastCosts} packInfo={packInfo} setPackInfo={setPackInfo} onOrder={onOrder} onChanged={onChanged} />
        )}
      </div>
    </section>
  )
}

