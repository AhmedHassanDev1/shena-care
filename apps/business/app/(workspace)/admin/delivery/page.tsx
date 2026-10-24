'use client'

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, Route, Truck, Wallet } from 'lucide-react'
import { Code, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
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

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="sc-page-title">عمليات التوصيل</h1>
          <span className="sc-badge t-success"><Truck className="size-3.5" />{hub?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {me.hubLocations.length > 1 ? (
            <select aria-label="المخزن" value={hubId ?? ''} onChange={(e) => setHubId(e.target.value)} className="h-bw-control rounded-bw-field border-[1.5px] border-bw-line-field px-2">
              {me.hubLocations.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          ) : null}
          <Link href="/hub/dispatch" className="sc-btn sm flex items-center gap-1.5"><ExternalLink className="size-3.5" />شاشة التسليم للمناديب</Link>
          <Link href="/admin/cash" className="sc-btn sm flex items-center gap-1.5"><Wallet className="size-3.5" />النقدية والتسوية</Link>
        </div>
      </div>

      {error ? <LoadError message={error.message} onRetry={() => { runs.reload(); failed.reload() }} /> : null}

      <Section title={<span className="flex items-center gap-2"><Route className="size-4" />مشاوير التوصيل</span>}>
        {!runs.data && runs.loading ? <Skeleton className="h-32 w-full" /> : null}
        {runs.data && runItems.length === 0 ? <StateBlock kind="empty" title="مافيش مشاوير دلوقتي" body="المشاوير بتظهر هنا لما المخزن يجهّز شحنات ويسلّمها لمندوب." /> : null}
        {runItems.length > 0 ? (
          <table className="w-full text-start text-bw-small">
            <thead><tr><th className="py-2 text-start">المشوار</th><th className="text-start">المندوب</th><th className="text-start">الحالة</th><th className="text-start">المحطات</th><th className="text-start">تم التسليم</th><th className="text-start">فشل</th><th className="text-start">خرج الساعة</th></tr></thead>
            <tbody>
              {runItems.map((r) => (
                <tr key={r.id} className="border-t border-bw-line">
                  <td className="py-2"><Code>{shortId(r.id)}</Code></td>
                  <td>{driverName(r.driverId)}</td>
                  <td><Status map={RUN_STATUS} value={r.status} /></td>
                  <td>{r.stops}</td>
                  <td>{r.attempts?.delivered ?? 0}</td>
                  <td>{r.attempts?.failed ?? 0}</td>
                  <td>{r.dispatchedAt ? formatDateTime(r.dispatchedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      <Section title="شحنات فشل تسليمها">
        {!failed.data && failed.loading ? <Skeleton className="h-24 w-full" /> : null}
        {failed.data && failedItems.length === 0 ? <StateBlock kind="empty" title="مافيش شحنات فاشلة" body="الشحنة اللي المندوب ما قدرش يسلّمها بتظهر هنا لحد ما ترجع للمخزن." /> : null}
        {failedItems.length > 0 ? (
          <table className="w-full text-start text-bw-small">
            <thead><tr><th className="py-2 text-start">الطلب</th><th className="text-start">المنطقة</th><th className="text-start">القطع</th><th className="text-start">الحالة</th><th className="text-start">آخر تحديث</th></tr></thead>
            <tbody>
              {failedItems.map((s) => (
                <tr key={s.shipmentId} className="border-t border-bw-line">
                  <td className="py-2"><Code>{s.orderNumber ?? shortId(s.shipmentId)}</Code></td>
                  <td>{[s.governorate, s.area].filter(Boolean).join(' - ') || '—'}</td>
                  <td>{s.itemCount}</td>
                  <td><Status map={SHIPMENT_STATUS} value={s.status} /></td>
                  <td>{formatDateTime(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>
    </Page>
  )
}
