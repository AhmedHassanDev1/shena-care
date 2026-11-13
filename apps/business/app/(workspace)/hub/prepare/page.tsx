'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { Button, Code, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
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
  const [busyId, setBusyId] = React.useState<string | null>(null)

  return (
    <Page>
      <PageHeader
        title="تجهيز الطلبات"
        meta="كل طلب لوحده: امسح كل قطعة، والتجهيز مايكتملش إلا لما السيرفر يأكد الكميات."
        actions={<Button variant="secondary" size="sm" onClick={reload} loading={loading && !!data}>{!(loading && !!data) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>}
      />
      <CommandError error={start.error} />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <div className="space-y-px overflow-hidden rounded-bw-card"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : null}
      {data && data.items.length === 0 ? <div className="bw-panel"><StateBlock kind="empty" title="مافيش طلبات جاهزة للتجهيز" body="الطلب بيظهر هنا لما كل بضاعته توصل المخزن." /></div> : null}
      {data?.items.length ? (
        <ul className="bw-panel bw-arrive divide-y divide-bw-line overflow-hidden">
          {data.items.map((s) => (
            <li key={s.shipmentId} className="bw-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_3.5rem_8rem_auto]">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <strong className="text-bw-small text-bw-ink"><Code>{(s.orderNumber ?? '—').replace(/^ORD-/, '#')}</Code></strong>
                <Status map={SHIPMENT_STATUS} value={s.status} />
              </span>
              <span className="col-start-1 row-start-2 truncate text-[12px] text-bw-ink-soft md:col-start-auto md:row-start-auto md:text-bw-small">{[s.area, s.governorate].filter(Boolean).join('، ') || '—'}</span>
              <span className="hidden text-bw-small text-bw-ink-soft md:block"><Code>{s.itemCount}</Code> قطع</span>
              <span className="hidden text-[12px] text-bw-ink-subtle md:block">{formatDateTime(s.updatedAt)}</span>
              <Button
                className="col-start-2 row-span-2 row-start-1 md:col-start-auto md:row-span-1 md:row-start-auto"
                loading={busyId === s.shipmentId && start.pending}
                disabled={start.pending}
                onClick={async () => { setBusyId(s.shipmentId); if (await start.execute(s.shipmentId)) router.push(`/hub/prepare/${s.shipmentId}`) }}
              >
                {s.status === 'preparing' ? 'كمّل التجهيز' : 'ابدأ التجهيز'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Page>
  )
}
