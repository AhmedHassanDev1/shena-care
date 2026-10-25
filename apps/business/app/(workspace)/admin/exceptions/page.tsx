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

/** A purchase order the supplier has not reacted to; the clock starts when the supplier could first see it. */
interface SupplierWait { purchaseOrderId: string; supplierName: string; waitedMinutes: number; opened: boolean; lineCount: number; totalCost: number; currency: string | null }
interface CashVariance { orderId: string; orderNumber: string; variance: string | null; severity: 'large' | 'small' }

const waited = (minutes: number) => (minutes >= 120 ? `${Math.floor(minutes / 60)} ساعة` : `${minutes} دقيقة`)

interface AttentionQueue {
  supplyActionRequired: Paged<{ orderId: string; orderNumber: string | null; category?: string; unresolvedQuantity?: number; since?: string }>
  customerDecisionsPending: Paged<{ orderId: string; orderNumber: string; reason?: string; unresolvedQuantity?: number; expiresAt?: string }>
  distributionRequired: Paged<{ purchaseOrderId: string; lineId: string; requestedQuantity: number; confirmedQuantity: number | null }>
  failedDeliveries: Paged<{ orderId: string; orderNumber: string | null; reasonCode: string | null; failedAt: string; returnDue?: boolean }>
  supplierResponses?: { unopened: SupplierWait[]; unanswered: SupplierWait[] }
  lateOrders?: Paged<{ orderId: string; orderNumber: string; promisedDate: string; daysLate: number }>
  cashVariances?: { short: Paged<CashVariance>; over: Paged<CashVariance> }
  unsettledRounds?: Paged<{ courierId: string; locationId: string; orders: number; expectedTotal: string; declaredTotal: string; oldestDeclaredAt: string | null }>
  roundVariances?: Paged<{ batchId: string; reference: string; expectedTotal: string; countedTotal: string; variance: string; severity: 'large' | 'small'; settledAt: string }>
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
          {data.supplierResponses ? (
            <>
              <Queue title="طلبيات موردين ما اتردّش عليها (اتصل بالمورد)" page={asPage(data.supplierResponses.unanswered)}
                row={(r) => <SupplierRow key={r.purchaseOrderId} wait={r} />} />
              <Queue title="طلبيات موردين ما اتفتحتش" page={asPage(data.supplierResponses.unopened)}
                row={(r) => <SupplierRow key={r.purchaseOrderId} wait={r} />} />
            </>
          ) : null}
          {data.lateOrders ? (
            <Queue title="طلبات متأخرة عن ميعادها" page={data.lateOrders}
              row={(r) => <OrderRow key={r.orderId} orderId={r.orderId} label={r.orderNumber} note={r.daysLate > 0 ? `متأخر ${r.daysLate} يوم` : 'ميعاده النهارده'} at={r.promisedDate} />} />
          ) : null}
          {data.cashVariances ? (
            <Queue title="فروق كاش (الكبيرة الأول)" page={asPage([...data.cashVariances.short.items, ...data.cashVariances.over.items]
              .sort((a, b) => Number(b.severity === 'large') - Number(a.severity === 'large')))}
              row={(r) => <OrderRow key={r.orderId} orderId={r.orderId} label={r.orderNumber} note={`${r.severity === 'large' ? 'فرق كبير' : 'فرق صغير'} ${r.variance ?? ''}`} />} />
          ) : null}
          {data.roundVariances ? (
            <Queue title="فروق في عدّ الجولات (الكبيرة الأول)" page={data.roundVariances}
              row={(r) => (
                <li key={r.batchId} className="flex items-center justify-between border-t border-bw-line py-2 text-bw-small">
                  <span><Code>{r.reference}</Code> · {r.severity === 'large' ? 'فرق كبير' : 'فرق صغير'} {r.variance} · متوقع <Code>{r.expectedTotal}</Code> · اتعدّ <Code>{r.countedTotal}</Code> · {formatDateTime(r.settledAt)}</span>
                  <Link href="/admin/cash" className="flex items-center gap-1 underline">افتح النقدية<ArrowLeft className="size-3.5" /></Link>
                </li>
              )} />
          ) : null}
          {data.unsettledRounds ? (
            <Queue title="جولات نقدية ما اتعدّتش بعد ١٢ ساعة" page={data.unsettledRounds}
              row={(r) => (
                <li key={`${r.courierId}-${r.locationId}`} className="flex items-center justify-between border-t border-bw-line py-2 text-bw-small">
                  <span>مندوب <Code>{shortId(r.courierId)}</Code> · {r.orders} طلب · متوقع <Code>{r.expectedTotal}</Code> · أعلن <Code>{r.declaredTotal}</Code>{r.oldestDeclaredAt ? ` · من ${formatDateTime(r.oldestDeclaredAt)}` : ''}</span>
                  <Link href="/admin/cash" className="flex items-center gap-1 underline">افتح النقدية<ArrowLeft className="size-3.5" /></Link>
                </li>
              )} />
          ) : null}
          <Queue title="نقص توريد يحتاج قرار" page={data.supplyActionRequired}
            row={(r) => <OrderRow key={r.orderId} orderId={r.orderId} label={r.orderNumber} note={r.unresolvedQuantity ? `${r.unresolvedQuantity} قطعة ناقصة` : undefined} at={r.since} />} />
          <Queue title="قرارات عملاء معلّقة" page={data.customerDecisionsPending}
            row={(r) => <OrderRow key={r.orderId} orderId={r.orderId} label={r.orderNumber} note={r.unresolvedQuantity ? `${r.unresolvedQuantity} قطعة` : undefined} at={r.expiresAt} />} />
          <Queue title="توصيلات فاشلة" page={data.failedDeliveries}
            row={(r) => <OrderRow key={`${r.orderId}-${r.failedAt}`} orderId={r.orderId} label={r.orderNumber} note={`${r.reasonCode ?? ''}${r.returnDue ? ' · عدّت ٢٤ ساعة، يتحوّل مرتجع (امسح الشحنة في الـ hub)' : ''}`.trim() || undefined} at={r.failedAt} />} />
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

const asPage = <T,>(items: T[]): Paged<T> => ({ total: items.length, items })

function SupplierRow({ wait }: { wait: SupplierWait }) {
  return (
    <li className="flex items-center justify-between border-t border-bw-line py-2 text-bw-small">
      <span>
        <b>{wait.supplierName}</b> · أمر شراء <Code>{shortId(wait.purchaseOrderId)}</Code> · {wait.lineCount} صنف · تكلفة <Code>{wait.totalCost}</Code>{wait.currency ? ` ${wait.currency}` : ''}
        {` · مستني ${waited(wait.waitedMinutes)}`}{wait.opened ? ' · اتفتح من غير رد' : ' · لسه ما اتفتحش'}
      </span>
      <Link href="/admin/sourcing" className="flex items-center gap-1 underline">افتح التوريد<ArrowLeft className="size-3.5" /></Link>
    </li>
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
