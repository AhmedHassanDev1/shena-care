'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Code, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { PO_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

export interface SupplierPo {
  id: string; status: string; batchRef: string | null; issuedAt: string | null; confirmedAt: string | null; readyAt: string | null; receivedAt: string | null; createdAt: string
  lines: Array<{
    id: string; skuId: string; requestedQuantity: number; confirmedQuantity: number | null; status: string; unitCost: number | null; currency: string | null
    exceptionCode: string | null; exceptionNote: string | null; proposedQuantity: number | null; proposedUnitCost: number | null
    sku: { productName: string; brandName: string | null; variantName: string; skuCode: string; barcode: string | null } | null
  }>
}

export const OPEN = ['created', 'sent', 'reviewed']

/** Supplier inbox (W3): only this supplier's POs — the API filters by the account's supplier. */
export default function SupplierInbox() {
  const { data, error, loading, reload } = useApi<{ total: number; items: SupplierPo[] }>('/purchase-orders?take=50', { pollMs: 30000 })
  const open = data?.items.filter((po) => OPEN.includes(po.status)).length

  return (
    <RoleShell role="supplier" active="pos" mode="mobile" counts={{ pos: open }}>
      <div className="space-y-4 p-4">
        <PageHeader title="أوامر الشراء" meta="رد على كل أمر بالكمية المتاحة فعلاً" />
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-32 w-full" /> : null}
        {data && data.items.length === 0 ? <StateBlock kind="empty" title="مافيش أوامر شراء" body="أوامر الشراء الجديدة هتظهر هنا." /> : null}
        <ul className="space-y-3">
          {data?.items.map((po) => (
            <li key={po.id}>
              <Link href={`/supplier/po/${po.id}`} className="flex items-center gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">أمر <Code>{shortId(po.id)}</Code> <Status map={PO_STATUS} value={po.status} /></p>
                  <p className="text-bw-small text-bw-ink-soft">
                    <Code>{po.lines.length}</Code> صنف · <Code>{po.lines.reduce((s, l) => s + l.requestedQuantity, 0)}</Code> قطعة · {formatDateTime(po.issuedAt ?? po.createdAt)}
                  </p>
                </div>
                <ChevronLeft className="size-5 text-bw-ink-soft" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </RoleShell>
  )
}
