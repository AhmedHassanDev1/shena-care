'use client'

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, PackageCheck, PackageOpen, ScanLine, Warehouse } from 'lucide-react'
import { Code, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Page, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { formatDateTime, SHIPMENT_STATUS, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

interface Receivable {
  allocationId: string; orderNumber: string; purchaseOrderId: string; supplierName: string; readyAt: string | null
  confirmedQuantity: number; receivedQuantity: number; shortQuantity: number; remainingQuantity: number
  skuCode: string | null; variantName: string | null
}

interface HubShipment {
  shipmentId: string; orderNumber: string | null; governorate: string | null; area: string | null
  status: string; itemCount: number; updatedAt: string
}

const PREPARING = ['ready_to_prepare', 'preparing', 'prepared']

/** Admin oversight of one hub, read-only, from the same hub queues the Hub desk works on (GLO-239). */
export default function AdminHubPage() {
  return (
    <RoleShell role="admin" active="hub" mode="desktop">
      <AdminHubContent />
    </RoleShell>
  )
}

function AdminHubContent() {
  const me = useMe()
  const [hubId, setHubId] = React.useState<string | null>(null)
  React.useEffect(() => setHubId((current) => current ?? me.hubLocations[0]?.id ?? null), [me.hubLocations])
  const hub = me.hubLocations.find((h) => h.id === hubId)

  const receivables = useApi<Receivable[]>(hub ? `/fulfillment/locations/${hub.id}/receivables` : null, { pollMs: 30000 })
  const shipments = useApi<{ total: number; items: HubShipment[] }>(hub ? `/fulfillment/locations/${hub.id}/shipments?take=100` : null, { pollMs: 20000 })

  if (me.hubLocations.length === 0) {
    return (
      <Page>
        <StateBlock kind="empty" title="مافيش مخزن متسجّل" body="لما يتضاف مخزن هتلاقي هنا متابعة الاستلام والتجهيز." />
      </Page>
    )
  }

  const rows = shipments.data?.items ?? []
  const waiting = (receivables.data ?? []).reduce((sum, r) => sum + r.remainingQuantity, 0)
  const preparing = rows.filter((s) => PREPARING.includes(s.status)).length
  const packed = rows.filter((s) => s.status === 'packed').length
  const failed = rows.filter((s) => s.status === 'failed').length
  const error = receivables.error ?? shipments.error

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="sc-page-title">إدارة المخزن والتجهيز</h1>
          <span className="sc-badge t-success"><Warehouse className="size-3.5" />{hub?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {me.hubLocations.length > 1 ? (
            <select aria-label="المخزن" value={hubId ?? ''} onChange={(e) => setHubId(e.target.value)} className="h-bw-control rounded-bw-field border-[1.5px] border-bw-line-field px-2">
              {me.hubLocations.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          ) : null}
          <Link href="/hub" className="sc-btn sm flex items-center gap-1.5"><ExternalLink className="size-3.5" />محطة المخزن الميدانية</Link>
        </div>
      </div>

      {error ? <LoadError message={error.message} onRetry={() => { receivables.reload(); shipments.reload() }} /> : null}

      <section aria-label="مؤشرات المخزن" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<PackageOpen className="size-4" />} label="قطع بانتظار الاستلام من الموردين" value={receivables.data ? waiting : null} />
        <Stat icon={<ScanLine className="size-4" />} label="طلبات قيد التجهيز" value={shipments.data ? preparing : null} />
        <Stat icon={<PackageCheck className="size-4" />} label="طرود معبّأة جاهزة للتسليم" value={shipments.data ? packed : null} />
        <Stat icon={<Warehouse className="size-4" />} label="شحنات فشل تسليمها" value={shipments.data ? failed : null} />
      </section>

      <Section title="شحنات المخزن">
        {!shipments.data && shipments.loading ? <Skeleton className="h-32 w-full" /> : null}
        {shipments.data && rows.length === 0 ? <StateBlock kind="empty" title="مافيش شحنات في المخزن دلوقتي" body="الشحنات بتظهر هنا لما بضاعة الطلب كلها توصل المخزن." /> : null}
        {rows.length > 0 ? (
          <table className="w-full text-start text-bw-small">
            <thead><tr><th className="py-2 text-start">الطلب</th><th className="text-start">المنطقة</th><th className="text-start">القطع</th><th className="text-start">الحالة</th><th className="text-start">آخر تحديث</th></tr></thead>
            <tbody>
              {rows.map((s) => (
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

      <Section title="بضاعة الموردين المتوقعة">
        {!receivables.data && receivables.loading ? <Skeleton className="h-32 w-full" /> : null}
        {receivables.data && receivables.data.length === 0 ? <StateBlock kind="empty" title="مافيش بضاعة متوقعة دلوقتي" body="أوامر الشراء اللي المورد جهّزها بتظهر هنا لحد ما المخزن يستلمها." /> : null}
        {(receivables.data ?? []).length > 0 ? (
          <table className="w-full text-start text-bw-small">
            <thead><tr><th className="py-2 text-start">أمر الشراء</th><th className="text-start">المورد</th><th className="text-start">الصنف</th><th className="text-start">المؤكد</th><th className="text-start">المستلم</th><th className="text-start">المتبقي</th></tr></thead>
            <tbody>
              {(receivables.data ?? []).map((r) => (
                <tr key={r.allocationId} className="border-t border-bw-line">
                  <td className="py-2"><Code>{shortId(r.purchaseOrderId)}</Code></td>
                  <td>{r.supplierName}</td>
                  <td>{[r.skuCode, r.variantName].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{r.confirmedQuantity}</td>
                  <td>{r.receivedQuantity}</td>
                  <td>{r.remainingQuantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>
    </Page>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | null }) {
  return (
    <div className="sc-card space-y-2 p-4">
      <div className="flex items-center justify-between text-xs text-bw-ink-subtle"><span>{label}</span>{icon}</div>
      <div className="sc-num text-2xl font-bold">{value === null ? '—' : value}</div>
    </div>
  )
}
