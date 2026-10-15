'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button, Code, DataTable, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { HubShell, useHub } from '@/components/workspace/hub'
import { CommandError, Page, Status } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { SHIPMENT_STATUS, formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

export interface HubShipment {
  shipmentId: string; orderId: string; orderNumber: string | null; orderStatus: string | null; governorate: string | null; area: string | null
  status: string; itemCount: number; activeRun: { batchId: string; sequence: number } | null; updatedAt: string
}

/** Individual customer orders whose goods are all at the hub (W4). */
export default function HubPrepare() {
  return (
    <HubShell active="pick">
      <PrepareBody />
    </HubShell>
  )
}

function PrepareBody() {
  const hub = useHub()
  const router = useRouter()
  const { data, error, loading, reload } = useApi<{ total: number; items: HubShipment[] }>(`/fulfillment/locations/${hub.id}/shipments?status=ready_to_prepare,preparing&take=100`, { pollMs: 20000 })
  const start = useCommand((shipmentId: string) => api(`/fulfillment/shipments/${shipmentId}/preparation`, { body: {} }))

  return (
    <Page>
      <PageHeader title="تجهيز الطلبات" meta="كل طلب لوحده: امسح كل قطعة، والتجهيز مايكتملش إلا لما السيرفر يأكد الكميات كلها." />
      <CommandError error={start.error} />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
      {data && data.items.length === 0 ? <StateBlock kind="empty" title="مافيش طلبات جاهزة للتجهيز" body="الطلب بيظهر هنا لما كل بضاعته توصل المخزن." /> : null}
      {data?.items.length ? (
        <Section>
          <DataTable caption="طلبات للتجهيز" head={['الطلب', 'المنطقة', 'القطع', 'الحالة', 'آخر تحديث', '']}>
            {data.items.map((s) => (
              <tr key={s.shipmentId}>
                <td><Code>{s.orderNumber ?? '—'}</Code></td>
                <td>{[s.area, s.governorate].filter(Boolean).join('، ')}</td>
                <td><Code>{s.itemCount}</Code></td>
                <td><Status map={SHIPMENT_STATUS} value={s.status} /></td>
                <td className="text-bw-small">{formatDateTime(s.updatedAt)}</td>
                <td>
                  <Button loading={start.pending} onClick={async () => { if (await start.execute(s.shipmentId)) router.push(`/hub/prepare/${s.shipmentId}`) }}>
                    {s.status === 'preparing' ? 'كمّل التجهيز' : 'ابدأ التجهيز'}
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
        </Section>
      ) : null}
    </Page>
  )
}
