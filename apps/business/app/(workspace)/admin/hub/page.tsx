'use client'

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { Code, DataTable, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { PanelHead, Stat, StatStrip } from '@/components/bw/ops'
import { Page, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { formatDateTime, SHIPMENT_STATUS, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

interface Receivable {
  allocationId: string; orderNumber: string; purchaseOrderId: string | null; supplierName: string | null; readyAt: string | null
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
      <PageHeader
        title="المخزن والتجهيز"
        meta={hub?.name}
        actions={<>
          {me.hubLocations.length > 1 ? (
            <select aria-label="المخزن" value={hubId ?? ''} onChange={(e) => setHubId(e.target.value)} className="bw-control h-9 rounded-bw-field border border-bw-line bg-bw-surface px-2 text-bw-small">
              {me.hubLocations.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          ) : null}
          <Link href="/hub/receive" className="inline-flex h-9 items-center gap-1.5 rounded-bw-field border border-bw-line bg-bw-surface px-3 text-bw-small font-semibold text-bw-ink transition-colors hover:bg-bw-sunken"><ExternalLink className="size-3.5" aria-hidden />محطة المخزن</Link>
        </>}
      />

      {error ? <LoadError message={error.message} onRetry={() => { receivables.reload(); shipments.reload() }} /> : null}

      <StatStrip columns={4}>
        <Stat label="قطع مستنية الاستلام" value={receivables.data ? waiting : '—'} tone="amber" href="/hub/receive" loading={!receivables.data && receivables.loading} />
        <Stat label="قيد التجهيز" value={shipments.data ? preparing : '—'} tone="violet" href="/hub/prepare" loading={!shipments.data && shipments.loading} />
        <Stat label="جاهزة للتسليم" value={shipments.data ? packed : '—'} tone="emerald" href="/hub/dispatch" loading={!shipments.data && shipments.loading} />
        <Stat label="فشل تسليمها" value={shipments.data ? failed : '—'} tone="rose" href="/admin/delivery" loading={!shipments.data && shipments.loading} />
      </StatStrip>

      <section aria-label="شحنات المخزن" className="bw-panel overflow-hidden">
        <PanelHead title="شحنات المخزن" />
        {!shipments.data && shipments.loading ? <div className="p-4"><Skeleton className="h-32 w-full" /></div> : null}
        {shipments.data && rows.length === 0 ? <StateBlock kind="empty" title="مافيش شحنات في المخزن دلوقتي" body="الشحنات بتظهر هنا لما بضاعة الطلب كلها توصل المخزن." /> : null}
        {rows.length > 0 ? (
          <DataTable caption="شحنات المخزن" head={['الطلب', 'المنطقة', 'القطع', 'الحالة', 'آخر تحديث']}>
            {rows.map((s) => (
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

      {(receivables.data ?? []).length > 0 ? (
        <section aria-label="بضاعة متوقعة" className="bw-panel overflow-hidden">
          <PanelHead title="بضاعة متوقعة في المخزن" />
          <DataTable caption="بضاعة متوقعة" head={['المصدر', 'الصنف', 'المؤكد', 'المستلم', 'المتبقي']}>
            {(receivables.data ?? []).map((r) => (
              <tr key={r.allocationId}>
                <td>{r.supplierName ?? 'مشتريات داخلية'}{r.purchaseOrderId ? <Code className="ms-2 text-[11px] text-bw-ink-subtle">{shortId(r.purchaseOrderId)}</Code> : null}</td>
                <td className="text-bw-ink-soft">{[r.skuCode, r.variantName].filter(Boolean).join(' · ') || '—'}</td>
                <td><Code>{r.confirmedQuantity}</Code></td>
                <td><Code>{r.receivedQuantity}</Code></td>
                <td className="font-semibold"><Code>{r.remainingQuantity}</Code></td>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : null}
    </Page>
  )
}
