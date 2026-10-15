'use client'

import * as React from 'react'
import { Button, Code, DataTable, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { HubShell, useHub } from '@/components/workspace/hub'
import { CommandError, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { RUN_STATUS, SHIPMENT_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import type { HubShipment } from '../prepare/page'

interface Run { id: string; status: string; driverId: string | null; plannedAt: string | null; dispatchedAt: string | null; stops: number; attempts: Record<string, number> }
interface RunDetail { id: string; status: string; driverId: string | null; stops: Array<{ sequence: number; shipmentId: string; orderNumber: string | null; area: string | null; shipmentStatus: string; attemptStatus: string; handedOver: boolean }> }
interface Eligible { id: string; orderId: string; status: string }

/**
 * Dispatch (W4): packed parcels → a run for one driver → the driver scans each slip (custody) →
 * the hub dispatches the run atomically. Failed parcels come back by scanning their slip.
 */
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
  const eligible = useApi<Eligible[]>(`/fulfillment/locations/${hub.id}/eligible-shipments`, { pollMs: 20000 })
  const packed = useApi<{ items: HubShipment[] }>(`/fulfillment/locations/${hub.id}/shipments?status=packed&take=100`, { pollMs: 20000 })
  const runs = useApi<{ items: Run[] }>(`/fulfillment/locations/${hub.id}/runs?status=planning,dispatched&take=50`, { pollMs: 15000 })
  const failed = useApi<{ items: HubShipment[] }>(`/fulfillment/locations/${hub.id}/shipments?status=failed&take=100`, { pollMs: 20000 })
  const driverName = new Map((drivers.data ?? []).map((d) => [d.id, d.name]))
  const orderOf = new Map((packed.data?.items ?? []).map((s) => [s.shipmentId, s]))
  const [driverId, setDriverId] = React.useState('')
  const [selected, setSelected] = React.useState<string[]>([])
  const create = useCommand(async () => {
    const run = await api<{ id: string }>('/fulfillment/delivery-batches', { body: { hubId: hub.id, name: `run-${new Date().toISOString().slice(0, 16)}`, driverId } })
    await api(`/fulfillment/delivery-batches/${run.id}/stops`, { body: { stops: selected.map((shipmentId) => ({ shipmentId })) } })
    return run
  })
  const reloadAll = () => { eligible.reload(); packed.reload(); runs.reload(); failed.reload() }

  return (
    <Page>
      <PageHeader title="التسليم للمندوب" meta={hub.name} />

      <Section title="طرود جاهزة للتسليم">
        {eligible.error ? <LoadError message={eligible.error.message} onRetry={eligible.reload} /> : null}
        {!eligible.data && eligible.loading ? <Skeleton className="h-24 w-full" /> : null}
        {eligible.data && eligible.data.length === 0 ? <StateBlock kind="empty" title="مافيش طرود متغلّفة مستنية مشوار" /> : null}
        {eligible.data?.length ? (
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await create.execute()) { setSelected([]); reloadAll() } }}>
            <ul className="space-y-1">
              {eligible.data.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
                    طلب <Code>{orderOf.get(s.id)?.orderNumber ?? shortId(s.orderId)}</Code> · {[orderOf.get(s.id)?.area, orderOf.get(s.id)?.governorate].filter(Boolean).join('، ')}
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-3">
              <Select className="w-64" label="المندوب" value={driverId} onChange={setDriverId} options={[['', 'اختار المندوب'], ...(drivers.data ?? []).map((d) => [d.id, d.name] as [string, string])]} />
              <Button type="submit" loading={create.pending} disabled={!driverId || selected.length === 0}>عمل مشوار (<Code>{selected.length}</Code>)</Button>
            </div>
            <CommandError error={create.error} />
          </form>
        ) : null}
      </Section>

      <Section title="المشاوير">
        {runs.data && runs.data.items.length === 0 ? <p className="text-bw-small text-bw-ink-soft">مافيش مشاوير شغالة.</p> : null}
        <div className="space-y-3">{runs.data?.items.map((run) => <RunCard key={run.id} run={run} driver={run.driverId ? driverName.get(run.driverId) ?? shortId(run.driverId) : '—'} onChanged={reloadAll} />)}</div>
      </Section>

      <Section title="طرود رجعت من محاولة فاشلة">
        {failed.data && failed.data.items.length === 0 ? <p className="text-bw-small text-bw-ink-soft">مافيش.</p> : null}
        <div className="space-y-3">{failed.data?.items.map((s) => <FailedParcel key={s.shipmentId} s={s} onChanged={reloadAll} />)}</div>
      </Section>
    </Page>
  )
}

function RunCard({ run, driver, onChanged }: { run: Run; driver: string; onChanged: () => void }) {
  const detail = useApi<RunDetail>(`/fulfillment/delivery-batches/${run.id}`, { pollMs: 10000 })
  const dispatch = useCommand(() => api(`/fulfillment/delivery-batches/${run.id}/dispatch`, { method: 'POST' }))
  const stops = detail.data?.stops ?? []
  const allHanded = stops.length > 0 && stops.every((s) => s.handedOver)
  return (
    <div className="space-y-2 rounded-bw-field border border-bw-line p-3">
      <p className="flex flex-wrap items-center gap-2">مشوار <Code>{shortId(run.id)}</Code> · {driver} <Status map={RUN_STATUS} value={run.status} />
        <span className="text-bw-small text-bw-ink-soft">{run.dispatchedAt ? `خرج ${formatDateTime(run.dispatchedAt)}` : `اتعمل ${formatDateTime(run.plannedAt)}`}</span></p>
      {stops.length ? (
        <DataTable caption="محطات المشوار" head={['#', 'الطلب', 'المنطقة', 'الطرد', 'العهدة', 'المحاولة']}>
          {stops.map((s) => (
            <tr key={s.shipmentId}>
              <td><Code>{s.sequence}</Code></td>
              <td><Code>{s.orderNumber ?? '—'}</Code></td>
              <td>{s.area ?? '—'}</td>
              <td><Status map={SHIPMENT_STATUS} value={s.shipmentStatus} /></td>
              <td>{s.handedOver ? <StatusLabel tone="ok">المندوب مسح البوليصة</StatusLabel> : <StatusLabel tone="pending">مستني مسح المندوب</StatusLabel>}</td>
              <td>{s.attemptStatus}</td>
            </tr>
          ))}
        </DataTable>
      ) : null}
      {run.status === 'planning' ? (
        <div className="space-y-2">
          {!allHanded ? <Notice tone="neutral" title="المندوب لازم يمسح بوليصة كل طرد من موبايله قبل خروج المشوار" /> : null}
          <Button loading={dispatch.pending} disabled={!allHanded} onClick={async () => { if (await dispatch.execute()) onChanged() }}>خروج المشوار</Button>
          <CommandError error={dispatch.error} />
        </div>
      ) : null}
    </div>
  )
}

function FailedParcel({ s, onChanged }: { s: HubShipment; onChanged: () => void }) {
  const [code, setCode] = React.useState('')
  const event = useCommand((type: string) => api(`/fulfillment/shipments/${s.shipmentId}/events`, { body: { type, barcode: code.trim() } }))
  const run = async (type: string) => { if (await event.execute(type)) { setCode(''); onChanged() } }
  return (
    <div className="space-y-2 rounded-bw-field border border-bw-line p-3">
      <p>طلب <Code>{s.orderNumber ?? '—'}</Code> · {s.area ?? ''}</p>
      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
        <Field label="امسح بوليصة الطرد اللي رجع" ltr autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button variant="secondary" loading={event.pending} disabled={!code.trim()} onClick={() => run('RECEIVED_BACK')}>استلمته في المخزن (لمحاولة جديدة)</Button>
        <Button variant="danger" loading={event.pending} disabled={!code.trim()} onClick={() => { if (window.confirm('إرجاع الطرد نهائياً؟ الطلب هيتقفل كمرتجع.')) run('RETURNED') }}>إرجاع نهائي</Button>
      </div>
      <CommandError error={event.error} />
    </div>
  )
}
