'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, ShieldAlert } from 'lucide-react'
import { Code, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

type Paged<T> = { total: number; items: T[] }

interface AttentionQueue {
  supplyActionRequired: Paged<{ orderId: string; orderNumber: string | null; category?: string; unresolvedQuantity?: number; since?: string }>
  customerDecisionsPending: Paged<{ orderId: string; orderNumber: string; reason?: string; unresolvedQuantity?: number; expiresAt?: string }>
  distributionRequired: Paged<{ purchaseOrderId: string; lineId: string; requestedQuantity: number; confirmedQuantity: number | null }>
  failedDeliveries: Paged<{ orderId: string; orderNumber: string | null; reasonCode: string | null; failedAt: string }>
  openCases?: Paged<{ id: string; title: string; priority: string; orderId: string | null; createdAt: string }>
}

/**
 * Exceptions: the live attention queues from Operations (GLO-239). Every row opens the owning order or queue, where the audited,
 * server-validated action lives; nothing here is resolved locally.
 */
export default function AdminExceptionsPage() {
  return (
    <RoleShell role="admin" active="exceptions" mode="desktop">
      <ExceptionsContent />
    </RoleShell>
  )
}

function ExceptionsContent() {
  const { data, error, loading, reload } = useApi<AttentionQueue>('/operations/queues/attention', { pollMs: 20000 })

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sc-page-title flex items-center gap-2"><ShieldAlert className="size-5" />الاستثناءات والتدخّل</h1>
        <button type="button" onClick={reload} className="sc-btn sm flex items-center gap-1.5"><RefreshCw className="size-3.5" />تحديث</button>
      </div>
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-40 w-full" /> : null}

      {data ? (
        <>
          <Queue title="نقص توريد يحتاج قرار" page={data.supplyActionRequired}
            row={(r) => <OrderRow key={r.orderId} orderId={r.orderId} label={r.orderNumber} note={r.unresolvedQuantity ? `${r.unresolvedQuantity} قطعة ناقصة` : undefined} at={r.since} />} />
          <Queue title="قرارات عملاء معلّقة" page={data.customerDecisionsPending}
            row={(r) => <OrderRow key={r.orderId} orderId={r.orderId} label={r.orderNumber} note={r.unresolvedQuantity ? `${r.unresolvedQuantity} قطعة` : undefined} at={r.expiresAt} />} />
          <Queue title="توصيلات فاشلة" page={data.failedDeliveries}
            row={(r) => <OrderRow key={`${r.orderId}-${r.failedAt}`} orderId={r.orderId} label={r.orderNumber} note={r.reasonCode ?? undefined} at={r.failedAt} />} />
          <Queue title="بضاعة موردين محتاجة توزيع" page={data.distributionRequired}
            row={(r) => (
              <li key={r.lineId} className="flex items-center justify-between border-t border-bw-line py-2 text-bw-small">
                <span>أمر شراء <Code>{shortId(r.purchaseOrderId)}</Code> · مطلوب {r.requestedQuantity}{r.confirmedQuantity !== null ? ` · مؤكد ${r.confirmedQuantity}` : ''}</span>
                <Link href="/admin/sourcing" className="flex items-center gap-1 underline">افتح التوريد<ArrowLeft className="size-3.5" /></Link>
              </li>
            )} />
          {data.openCases ? (
            <Queue title="حالات دعم مفتوحة" page={data.openCases}
              row={(r) => (
                <li key={r.id} className="flex items-center justify-between border-t border-bw-line py-2 text-bw-small">
                  <span>{r.title} · {r.priority} · {formatDateTime(r.createdAt)}</span>
                  {r.orderId ? <Link href={`/admin/orders/${r.orderId}`} className="flex items-center gap-1 underline">افتح الطلب<ArrowLeft className="size-3.5" /></Link> : null}
                </li>
              )} />
          ) : null}
        </>
      ) : null}
    </Page>
  )
}

function Queue<T>({ title, page, row }: { title: string; page: Paged<T>; row: (item: T) => React.ReactNode }) {
  return (
    <Section title={<span>{title} <b className="sc-num">({page.total})</b></span>}>
      {page.items.length === 0 ? <StateBlock kind="empty" title="مفيش حاجة هنا" body="الطابور فاضي دلوقتي." /> : <ul>{page.items.map(row)}</ul>}
    </Section>
  )
}

function OrderRow({ orderId, label, note, at }: { orderId: string; label: string | null; note?: string; at?: string }) {
  return (
    <li className="flex items-center justify-between border-t border-bw-line py-2 text-bw-small">
      <span><Code>{label ?? shortId(orderId)}</Code>{note ? ` · ${note}` : ''}{at ? ` · ${formatDateTime(at)}` : ''}</span>
      <Link href={`/admin/orders/${orderId}`} className="flex items-center gap-1 underline">افتح الطلب<ArrowLeft className="size-3.5" /></Link>
    </li>
  )
}
