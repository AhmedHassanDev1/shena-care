'use client'

import * as React from 'react'
import { Compass, Layers, Truck } from 'lucide-react'
import { Button, Notice, Skeleton, StateBlock } from '@/components/bw/primitives'
import { CopyId } from '@/components/workspace/copy-id'
import { CommandError } from '@/components/workspace/kit'
import { api } from '@/lib/api'
import { shortId } from '@/lib/labels'
import { tripRef, type Run, type RunDetail } from '@/lib/trip-ops'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import type { HubShipment } from '../../prepare/page'
import { Disclosure, Fact, OrderLine, OutcomeBar, TripCardShell, TripHeading } from './trip-ui'

export interface Eligible {
  id: string
  orderId: string
  status: string
}

type Courier = { id: string; name: string }

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
  areaSummary?: string
  stops: ProposedTripStop[]
  metrics: { stopCount: number; estimatedDistanceMeters: number; totalEstimatedDurationSeconds: number }
}

interface UnassignedOrder {
  shipmentId: string
  orderNumber?: string
  reasonCode: string
}

/** Why the planner left a parcel out of the automatic grouping, in the words a hub employee needs. */
const UNASSIGNED_REASON: Record<string, string> = {
  MISSING_COORDINATES: 'بدون إحداثيات',
  OUT_OF_SERVICE_AREA: 'خارج نطاق الخدمة',
  EXCEEDS_DRIVER_SHIFT_CAPACITY: 'تجاوز سعة المناديب',
  INSUFFICIENT_DRIVERS: 'لا يوجد مندوب متاح',
}

function CourierSelect({ value, onChange, couriers, className }: { value: string; onChange: (id: string) => void; couriers: Courier[]; className?: string }) {
  return (
    <select
      aria-label="المندوب"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('bw-control h-10 min-w-40 cursor-pointer rounded-bw-field border border-bw-line-field bg-bw-surface px-3 text-bw-small text-bw-ink', className)}
    >
      <option value="">اختر المندوب</option>
      {couriers.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  )
}

/* ─────────────────────────────────────────────────────────────
   توزيع الطلبات: trips waiting for the courier + ready orders
   ───────────────────────────────────────────────────────────── */

export function AssignTab({
  hubId,
  eligible,
  orderOf,
  couriers,
  courierName,
  planningRuns,
  sequence,
  loading,
  onChanged,
}: {
  hubId: string
  eligible: Eligible[]
  orderOf: Map<string, HubShipment>
  couriers: Courier[]
  courierName: Map<string, string>
  planningRuns: Run[]
  sequence: Map<string, { n: number; of: number }>
  loading: boolean
  onChanged: () => void
}) {
  const [created, setCreated] = React.useState<string | null>(null)

  if (loading) return <Skeleton className="h-28 w-full rounded-bw-card" />

  if (eligible.length === 0 && planningRuns.length === 0) {
    return (
      <StateBlock
        kind="empty"
        title="لا توجد طلبات جاهزة للتوزيع"
        body="الطلبات التي تم تغليفها في المخزن تظهر هنا لتوزيعها على المناديب."
      />
    )
  }

  return (
    <div className="space-y-6">
      {created ? <Notice tone="ok" title={`تم إنشاء المشوار ${created}`}>بانتظار أن يمسح المندوب الطرود من مساحة التوصيل.</Notice> : null}

      {planningRuns.length > 0 ? (
        <section aria-label="مشاوير بانتظار استلام المندوب" className="space-y-2.5">
          <SectionLabel title="بانتظار استلام المندوب" count={planningRuns.length} hint="يمسح المندوب الطرود من مساحة التوصيل، ثم يخرج المشوار من هنا." />
          <div className="grid gap-3 lg:grid-cols-2">
            {planningRuns.map((run) => (
              <PlanningTripCard
                key={run.id}
                run={run}
                courier={run.driverId ? courierName.get(run.driverId) ?? shortId(run.driverId) : 'بدون مندوب'}
                couriers={couriers}
                sequence={sequence.get(run.id)}
                onChanged={onChanged}
              />
            ))}
          </div>
        </section>
      ) : null}

      {eligible.length > 0 ? (
        <ReadyOrders
          hubId={hubId}
          eligible={eligible}
          orderOf={orderOf}
          couriers={couriers}
          onCreated={(id) => {
            setCreated(tripRef(id))
            onChanged()
          }}
        />
      ) : null}
    </div>
  )
}

function SectionLabel({ title, count, hint }: { title: string; count: number; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <h2 className="text-bw-body font-semibold text-bw-ink">
        {title} <span className="ms-1 font-normal tabular-nums text-bw-ink-subtle">{count}</span>
      </h2>
      {hint ? <p className="text-[11px] text-bw-ink-subtle">{hint}</p> : null}
    </div>
  )
}

/* ── A trip that exists but has not left: review it, wait for the courier's own scan, then send it out ── */

function PlanningTripCard({
  run,
  courier,
  couriers,
  sequence,
  onChanged,
}: {
  run: Run
  courier: string
  couriers: Courier[]
  sequence?: { n: number; of: number }
  onChanged: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const detail = useApi<RunDetail>(`/fulfillment/delivery-batches/${run.id}`, { pollMs: 8000 })
  const dispatch = useCommand(() => api(`/fulfillment/delivery-batches/${run.id}/dispatch`, { method: 'POST' }))
  const reassign = useCommand((driverId: string) => api(`/fulfillment/delivery-batches/${run.id}/driver`, { method: 'PATCH', body: { driverId } }))

  const stops = detail.data?.stops ?? []
  const total = stops.length || run.stops
  const received = stops.filter((s) => s.handedOver).length
  const ready = stops.length > 0 && received === stops.length

  return (
    <TripCardShell>
      <div className="space-y-3">
        <TripHeading
          courier={courier}
          run={run}
          sequence={sequence}
          trailing={ready ? <span className="font-semibold text-bw-emerald">جاهز للخروج</span> : <span className="text-bw-ink-soft">بانتظار مسح المندوب</span>}
        />

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Fact value={total} label="طلب" strong />
            <Fact value={`${received}/${total}`} label="استلمها المندوب" tone={ready ? 'ok' : undefined} />
          </div>
          <OutcomeBar delivered={received} failed={0} total={total} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Disclosure label="الطلبات والتفاصيل" open={open} onToggle={() => setOpen((v) => !v)}>
            <div className="space-y-3">
              <ul className="divide-y divide-bw-line/70">
                {stops.map((s) => (
                  <OrderLine
                    key={s.shipmentId}
                    orderNumber={s.orderNumber}
                    fallbackId={s.shipmentId}
                    area={s.area}
                    parcelId={s.shipmentId}
                    meta={
                      s.handedOver ? <span className="text-bw-emerald">استلمه المندوب</span> : <span className="text-bw-warn">لم يُمسح بعد</span>
                    }
                  />
                ))}
              </ul>
              {/* The server refuses a courier change once any parcel is in custody. */}
              {received === 0 && stops.length > 0 && couriers.length > 1 ? (
                <label className="flex flex-wrap items-center gap-2 text-bw-small text-bw-ink-soft">
                  تغيير المندوب
                  <CourierSelect
                    value={run.driverId ?? ''}
                    couriers={couriers}
                    onChange={async (id) => {
                      if (id && id !== run.driverId && (await reassign.execute(id))) onChanged()
                    }}
                  />
                </label>
              ) : null}
            </div>
          </Disclosure>

          <Button
            size="sm"
            loading={dispatch.pending}
            disabled={!ready}
            onClick={async () => {
              if (await dispatch.execute()) onChanged()
            }}
          >
            <Truck className="size-4" aria-hidden />
            خروج المشوار
          </Button>
        </div>

        {!ready && stops.length > 0 ? (
          <p className="text-[11px] text-bw-ink-subtle">يخرج المشوار تلقائياً عندما يمسح المندوب آخر طرد من مساحة التوصيل. هذا الزر احتياطي إن لم يخرج.</p>
        ) : null}
        <CommandError error={reassign.error} />
        <CommandError error={dispatch.error} />
      </div>
    </TripCardShell>
  )
}

/* ── Ready orders: suggested geographic groups first, manual selection on demand ── */

function ReadyOrders({
  hubId,
  eligible,
  orderOf,
  couriers,
  onCreated,
}: {
  hubId: string
  eligible: Eligible[]
  orderOf: Map<string, HubShipment>
  couriers: Courier[]
  onCreated: (runId: string) => void
}) {
  const [mode, setMode] = React.useState<'groups' | 'manual'>('groups')
  const [trips, setTrips] = React.useState<ProposedTrip[]>([])
  const [unassigned, setUnassigned] = React.useState<UnassignedOrder[]>([])
  const [loadingPlan, setLoadingPlan] = React.useState(false)
  const [planError, setPlanError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string[]>([])
  const [groupCourier, setGroupCourier] = React.useState<Record<string, string>>({})
  const [manualCourier, setManualCourier] = React.useState('')
  const [busyGroup, setBusyGroup] = React.useState<string | null>(null)
  const [groupError, setGroupError] = React.useState<string | null>(null)

  // Geographic grouping preview from the backend planner (distance, stop limits, courier capacity).
  React.useEffect(() => {
    let cancelled = false
    setLoadingPlan(true)
    setPlanError(null)
    api<{ trips: ProposedTrip[]; unassignedOrders?: UnassignedOrder[] }>(`/fulfillment/locations/${hubId}/dispatch/plan-preview`, { method: 'POST', body: {} })
      .then((res) => {
        if (cancelled) return
        setTrips(res?.trips ?? [])
        setUnassigned(res?.unassignedOrders ?? [])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPlanError((err as Error)?.message || 'تعذّر تحميل التوزيع المقترح')
        setMode('manual')
      })
      .finally(() => {
        if (!cancelled) setLoadingPlan(false)
      })
    return () => {
      cancelled = true
    }
  }, [hubId, eligible.length])

  const createManual = useCommand(async () => {
    const run = await api<{ id: string }>('/fulfillment/delivery-batches', {
      body: { hubId, name: `run-${new Date().toISOString().slice(0, 16)}`, driverId: manualCourier },
    })
    await api(`/fulfillment/delivery-batches/${run.id}/stops`, { body: { stops: selected.map((shipmentId) => ({ shipmentId })) } })
    return run
  })

  const approveGroup = async (trip: ProposedTrip) => {
    const driverId = groupCourier[trip.tripId]
    if (!driverId) return
    try {
      setBusyGroup(trip.tripId)
      setGroupError(null)
      const run = await api<{ id: string }>('/fulfillment/delivery-batches', {
        body: { hubId, name: `run-${trip.clusterId}-${new Date().toISOString().slice(0, 16)}`, driverId },
      })
      await api(`/fulfillment/delivery-batches/${run.id}/stops`, {
        body: { stops: trip.stops.map((s) => ({ shipmentId: s.shipmentId, sequence: s.sequence })) },
      })
      onCreated(run.id)
    } catch (err) {
      setGroupError((err as Error)?.message || 'تعذّر اعتماد المشوار')
    } finally {
      setBusyGroup(null)
    }
  }

  const allSelected = selected.length === eligible.length

  return (
    <section aria-label="طلبات جاهزة للتوزيع" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel title="طلبات جاهزة" count={eligible.length} />
        <div className="inline-flex rounded-bw-field border border-bw-line bg-bw-sunken p-0.5 text-bw-small" role="group" aria-label="طريقة التوزيع">
          {([
            ['groups', 'مجموعات مقترحة', Compass],
            ['manual', 'اختيار يدوي', Layers],
          ] as const).map(([key, text, Icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
              className={cn(
                'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-bw-field px-3 font-medium transition-colors',
                mode === key ? 'bg-bw-surface text-bw-ink shadow-bw-card' : 'text-bw-ink-soft hover:text-bw-ink',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {text}
            </button>
          ))}
        </div>
      </div>

      {planError ? <Notice tone="warn" title={planError}>يمكنك التوزيع يدويًا.</Notice> : null}

      {mode === 'groups' ? (
        <>
          {unassigned.length > 0 ? (
            <p className="text-bw-small text-bw-warn">
              {unassigned.length} طلب خارج التجميع التلقائي (
              {[...new Set(unassigned.map((u) => UNASSIGNED_REASON[u.reasonCode] ?? u.reasonCode))].join('، ')}
              ) — وزّعها{' '}
              <button type="button" onClick={() => setMode('manual')} className="cursor-pointer font-semibold underline underline-offset-2">يدويًا</button>.
            </p>
          ) : null}
          {loadingPlan ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <Skeleton className="h-36 w-full rounded-bw-card" />
              <Skeleton className="h-36 w-full rounded-bw-card" />
            </div>
          ) : trips.length === 0 ? (
            <StateBlock
              kind="empty"
              title="لا توجد مجموعات مقترحة"
              body="تعذّر تجميع الطلبات تلقائيًا (قد تنقصها الإحداثيات). اختر الطلبات يدويًا."
              action={<Button size="sm" variant="secondary" onClick={() => setMode('manual')}>اختيار يدوي</Button>}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {trips.map((trip, i) => (
                <GroupCard
                  key={trip.tripId}
                  trip={trip}
                  index={i}
                  couriers={couriers}
                  courierId={groupCourier[trip.tripId] ?? ''}
                  onCourier={(id) => setGroupCourier((prev) => ({ ...prev, [trip.tripId]: id }))}
                  busy={busyGroup === trip.tripId}
                  onApprove={() => approveGroup(trip)}
                  onEdit={() => {
                    setSelected(trip.stops.map((s) => s.shipmentId))
                    setMode('manual')
                  }}
                />
              ))}
            </div>
          )}
          {groupError ? <Notice tone="danger" title="العملية لم تتم">{groupError}</Notice> : null}
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-bw-small">
            <span className="text-bw-ink-soft">{selected.length > 0 ? `${selected.length} محدد` : 'حدد الطلبات التي ستخرج في مشوار واحد'}</span>
            <button
              type="button"
              onClick={() => setSelected(allSelected ? [] : eligible.map((s) => s.id))}
              className="min-h-8 cursor-pointer font-semibold text-bw-ink underline-offset-2 hover:underline"
            >
              {allSelected ? 'إلغاء التحديد' : 'تحديد الكل'}
            </button>
          </div>

          <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {eligible.map((s) => {
              const detail = orderOf.get(s.id)
              const checked = selected.includes(s.id)
              const place = [detail?.area, detail?.governorate].filter(Boolean).join('، ')
              return (
                <li
                  key={s.id}
                  className={cn(
                    'flex items-center gap-3 rounded-bw-field border px-3 py-2 transition-colors',
                    checked ? 'border-bw-line-field bg-bw-sunken' : 'border-bw-line bg-bw-surface hover:border-bw-line-field/60',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={`تحديد الطلب ${detail?.orderNumber ?? shortId(s.orderId)}`}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))}
                    className="size-4 shrink-0 cursor-pointer accent-bw-action"
                  />
                  <div className="min-w-0 flex-1">
                    <CopyId value={detail?.orderNumber ?? s.orderId} display={detail?.orderNumber ?? shortId(s.orderId)} label="رقم الطلب" className="text-bw-small font-semibold text-bw-ink" />
                    <p className="truncate text-[11px] text-bw-ink-subtle">
                      {place || 'بدون عنوان'}
                      {detail?.itemCount ? ` · ${detail.itemCount} قطعة` : ''}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>

          <form
            className={cn(
              'flex flex-wrap items-center gap-2 rounded-bw-card border border-bw-line bg-bw-surface px-3 py-2.5 transition-opacity',
              selected.length === 0 && 'opacity-60',
            )}
            onSubmit={async (e) => {
              e.preventDefault()
              const run = await createManual.execute()
              if (run) {
                setSelected([])
                setManualCourier('')
                onCreated(run.id)
              }
            }}
          >
            <CourierSelect value={manualCourier} onChange={setManualCourier} couriers={couriers} className="flex-1" />
            <Button type="submit" size="sm" loading={createManual.pending} disabled={!manualCourier || selected.length === 0}>
              <Truck className="size-4" aria-hidden />
              إنشاء مشوار{selected.length > 0 ? ` (${selected.length})` : ''}
            </Button>
          </form>
          <CommandError error={createManual.error} />
        </div>
      )}
    </section>
  )
}

function GroupCard({
  trip,
  index,
  couriers,
  courierId,
  onCourier,
  busy,
  onApprove,
  onEdit,
}: {
  trip: ProposedTrip
  index: number
  couriers: Courier[]
  courierId: string
  onCourier: (id: string) => void
  busy: boolean
  onApprove: () => void
  onEdit: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const km = (trip.metrics.estimatedDistanceMeters / 1000).toFixed(1)
  const minutes = Math.round(trip.metrics.totalEstimatedDurationSeconds / 60)
  return (
    <TripCardShell>
      <div className="space-y-3">
        <div className="min-w-0">
          <h3 className="truncate text-bw-body font-semibold text-bw-ink">{trip.areaSummary || `المجموعة ${index + 1}`}</h3>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Fact value={trip.stops.length} label="طلب" strong />
            <Fact value={`~${km}`} label="كم" />
            <Fact value={`~${minutes}`} label="دقيقة" />
            <span className="text-[11px] text-bw-ink-subtle">تقديري</span>
          </div>
        </div>

        <Disclosure label="ترتيب التوصيل" open={open} onToggle={() => setOpen((v) => !v)}>
          <ol className="divide-y divide-bw-line/70">
            {trip.stops.map((stop) => (
              <OrderLine
                key={stop.shipmentId}
                orderNumber={stop.orderNumber}
                fallbackId={stop.shipmentId}
                area={`${stop.sequence}. ${stop.customerName}`}
                meta={<span className="tabular-nums">+{stop.estimatedArrivalMinutes} د</span>}
              />
            ))}
          </ol>
        </Disclosure>

        <div className="flex flex-wrap items-center gap-2 border-t border-bw-line pt-3">
          <CourierSelect value={courierId} onChange={onCourier} couriers={couriers} className="flex-1" />
          <Button size="sm" loading={busy} disabled={!courierId || busy} onClick={onApprove}>
            <Truck className="size-4" aria-hidden />
            اعتماد المشوار
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>تعديل</Button>
        </div>
      </div>
    </TripCardShell>
  )
}
