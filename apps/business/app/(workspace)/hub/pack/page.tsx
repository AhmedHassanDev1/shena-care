'use client'

import * as React from 'react'
import { PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { HubShell, useHub } from '@/components/workspace/hub'
import { Page } from '@/components/workspace/kit'
import { PackCard, type PackagingCosts, type PackShipment as CardShipment } from '@/components/workspace/pack-card'
import { LoadError } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import type { HubShipment } from '../prepare/page'

type PackShipment = HubShipment & CardShipment

/**
 * Print + pack (W4). Two thermal outputs on the pharmacy's narrow receipt printer: the customer receipt
 * (inside the parcel) and the external shipping slip with the shipment barcode (taped/sleeved outside).
 * A browser preview is never treated as a print: the operator confirms the paper outcome.
 */
export default function HubPack() {
  return (
    <HubShell active="pack">
      <PackBody />
    </HubShell>
  )
}

function PackBody() {
  const hub = useHub()
  const { data, error, loading, reload } = useApi<{ total: number; items: PackShipment[] }>(`/fulfillment/locations/${hub.id}/shipments?status=prepared,ready_to_pack,packing&take=100`, { pollMs: 20000 })
  const costs = useApi<{ packagingCosts: PackagingCosts }>('/order-costs/pending?take=1')
  return (
    <Page>
      <PageHeader title="الطباعة والتغليف" meta="إيصال للعميل جوه الطرد + بوليصة شحن بالباركود برّه الطرد. إعادة الطباعة مابتغيّرش رقم الشحنة." />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
      {data && data.items.length === 0 ? <div className="bw-panel"><StateBlock kind="empty" title="مافيش طرود مستنية طباعة أو تغليف" /></div> : null}
      <div className="space-y-3">{data?.items.map((s) => <PackCard key={s.shipmentId} s={s} onChanged={reload} packagingCosts={costs.data?.packagingCosts ?? null} />)}</div>
    </Page>
  )
}

