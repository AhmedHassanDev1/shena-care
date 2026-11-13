'use client'

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, Wallet } from 'lucide-react'
import { Code, DataTable, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { PanelHead, Stat, StatStrip } from '@/components/bw/ops'
import { Page, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { formatDateTime, RUN_STATUS, SHIPMENT_STATUS, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

interface Run { id: string; status: string; driverId: string | null; plannedAt: string | null; dispatchedAt: string | null; stops: number; attempts: Record<string, number> }
interface HubShipment {
  shipmentId: string; orderNumber: string | null; governorate: string | null; area: string | null
  status: string; itemCount: number; updatedAt: string
}

/** Admin oversight of delivery runs and failed parcels for one hub, read-only, from the hub run queues (GLO-239/240). */
export default function AdminDeliveryPage() {
  return (
    <RoleShell role="admin" active="delivery" mode="desktop">
      <AdminDeliveryContent />
    </RoleShell>
  )
}

function AdminDeliveryContent() {
  const me = useMe()
  const [hubId, setHubId] = React.useState<string | null>(null)
  React.useEffect(() => setHubId((current) => current ?? me.hubLocations[0]?.id ?? null), [me.hubLocations])
  const hub = me.hubLocations.find((h) => h.id === hubId)

  const drivers = useApi<Array<{ id: string; name: string }>>('/workspace/drivers')
  const runs = useApi<{ items: Run[] }>(hub ? `/fulfillment/locations/${hub.id}/runs?take=50` : null, { pollMs: 15000 })
  const failed = useApi<{ items: HubShipment[] }>(hub ? `/fulfillment/locations/${hub.id}/shipments?status=failed&take=100` : null, { pollMs: 20000 })

  if (me.hubLocations.length === 0) {
    return (
      <Page>
        <StateBlock kind="empty" title="مافيش مخزن متسجّل" body="لما يتضاف مخزن هتلاقي هنا متابعة مشاوير التوصيل." />
      </Page>
    )
  }

  const driverName = (id: string | null) => (id ? drivers.data?.find((d) => d.id === id)?.name ?? shortId(id) : 'من غير مندوب')
  const runItems = runs.data?.items ?? []
  const failedItems = failed.data?.items ?? []
  const error = runs.error ?? failed.error

  const linkCls = 'inline-flex h-9 items-center gap-1.5 rounded-bw-field border border-bw-line bg-bw-surface px-3 text-bw-small font-semibold text-bw-ink transition-colors hover:bg-bw-sunken'
  const delivered = runItems.reduce((sum, r) => sum + (r.attempts?.delivered ?? 0), 0)
  const active = runItems.filter((r) => r.status !== 'completed' && r.status !== 'closed').length

  return (
    <Page>
      <PageHeader
        title="التوصيل"
        meta={hub?.name}
        actions={<>
          {me.hubLocations.length > 1 ? (
            <select aria-label="المخزن" value={hubId ?? ''} onChange={(e) => setHubId(e.target.value)} className="bw-control h-9 rounded-bw-field border border-bw-line bg-bw-surface px-2 text-bw-small">
              {me.hubLocations.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          ) : null}
          <Link href="/hub/dispatch" className={linkCls}><ExternalLink className="size-3.5" aria-hidden />التسليم للمناديب</Link>
          <Link href="/admin/cash" className={linkCls}><Wallet className="size-3.5" aria-hidden />النقدية والتسوية</Link>
        </>}
      />

      {error ? <LoadError message={error.message} onRetry={() => { runs.reload(); failed.reload() }} /> : null}

      <StatStrip columns={3}>
        <Stat label="مشاوير شغالة" value={runs.data ? active : '—'} tone="cobalt" loading={!runs.data && runs.loading} />
        <Stat label="اتسلّمت" value={runs.data ? delivered : '—'} tone="emerald" loading={!runs.data && runs.loading} />
        <Stat label="فشل تسليمها" value={failed.data ? failedItems.length : '—'} tone="rose" loading={!failed.data && failed.loading} />
      </StatStrip>

      <section aria-label="مشاوير التوصيل" className="bw-panel overflow-hidden">
        <PanelHead title="المشاوير" />
        {!runs.data && runs.loading ? <div className="p-4"><Skeleton className="h-32 w-full" /></div> : null}
        {runs.data && runItems.length === 0 ? <StateBlock kind="empty" title="مافيش مشاوير دلوقتي" body="المشاوير بتظهر هنا لما المخزن يجهّز شحنات ويسلّمها لمندوب." /> : null}
        {runItems.length > 0 ? (
          <DataTable caption="مشاوير التوصيل" head={['المشوار', 'المندوب', 'الحالة', 'المحطات', 'اتسلّم', 'فشل', 'خرج']}>
            {runItems.map((r) => (
              <tr key={r.id}>
                <td><Code className="font-semibold">{shortId(r.id)}</Code></td>
                <td>{driverName(r.driverId)}</td>
                <td><Status map={RUN_STATUS} value={r.status} /></td>
                <td><Code>{r.stops}</Code></td>
                <td><Code>{r.attempts?.delivered ?? 0}</Code></td>
                <td><Code>{r.attempts?.failed ?? 0}</Code></td>
                <td className="text-bw-ink-subtle">{r.dispatchedAt ? formatDateTime(r.dispatchedAt) : '—'}</td>
              </tr>
            ))}
          </DataTable>
        ) : null}
      </section>

      <section aria-label="شحنات فشل تسليمها" className="bw-panel overflow-hidden">
        <PanelHead title="شحنات فشل تسليمها" />
        {!failed.data && failed.loading ? <div className="p-4"><Skeleton className="h-24 w-full" /></div> : null}
        {failed.data && failedItems.length === 0 ? <StateBlock kind="empty" title="مافيش شحنات فاشلة" body="الشحنة اللي المندوب ما قدرش يسلّمها بتظهر هنا لحد ما ترجع للمخزن." /> : null}
        {failedItems.length > 0 ? (
          <DataTable caption="شحنات فشل تسليمها" head={['الطلب', 'المنطقة', 'القطع', 'الحالة', 'آخر تحديث']}>
            {failedItems.map((s) => (
              <tr key={s.shipmentId}>
                <td><Code className="font-semibold">{(s.orderNumber ?? shortId(s.shipmentId)).replace(/^ORD-/, '#')}</Code></td>
                <td className="text-bw-ink-soft">{[s.governorate, s.area].filter(Boolean).join(' - ') || '—'}</td>
                <td><Code>{s.itemCount}</Code></td>
                <td><Status map={SHIPMENT_STATUS} value={s.status} /></td>
                <td className="text-bw-ink-subtle">{formatDateTime(s.updatedAt)}</td>
              </tr>
            ))}
          </DataTable>
        ) : null}
      </section>
    </Page>
  )
}
