'use client'

import Link from 'next/link'
import { Code, PageHeader, QueueRow, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Egp, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { FAILURE_REASONS, formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

type Paged<T> = { total: number; items: T[] }
interface Attention {
  supplyActionRequired: Paged<{ orderId: string; orderNumber: string | null; category: string; unresolvedQuantity: number; since: string }>
  customerDecisionsPending: Paged<{ orderId: string; orderNumber: string; reason: string; unresolvedQuantity: number; expiresAt: string }>
  distributionRequired: Paged<{ purchaseOrderId: string; lineId: string; requestedQuantity: number; confirmedQuantity: number | null; orderAllocations: number }>
  failedDeliveries: Paged<{ orderId: string; orderNumber: string | null; reasonCode: string | null; failedAt: string }>
  cashVariances: { short: Paged<CashRow>; over: Paged<CashRow> }
  deliveredUnsettled: Paged<CashRow>
  eventFailures: { failed: EventRow[]; dead: EventRow[] }
  openCases: Paged<{ id: string; title: string; priority: string; orderId: string | null; createdAt: string }>
}
type CashRow = { orderId: string; orderNumber: string; expectedAmount: string; declaredAmount: string | null; countedAmount: string | null; variance: string | null }
type EventRow = { id: string; eventType: string; consumer: string; aggregateId: string; attempts: number; lastError: string | null }
interface Kpis { revenueToday: number; ordersToday: number; totalOrders: number; averageOrderValue: number }

const orderLink = (orderId: string, orderNumber: string | null) => (
  <Link href={`/admin/orders/${orderId}`} className="font-semibold text-bw-action-ink underline"><Code>{orderNumber ?? shortId(orderId)}</Code></Link>
)

/** Founder overview (W2): everything waiting on a human, each item from its owning module. */
export default function AdminHome() {
  const attention = useApi<Attention>('/operations/queues/attention', { pollMs: 30000 })
  const kpis = useApi<Kpis>('/operations/dashboard/kpis')
  const a = attention.data
  const waiting = a
    ? a.supplyActionRequired.total + a.customerDecisionsPending.total + a.distributionRequired.total + a.failedDeliveries.total +
      a.cashVariances.short.total + a.cashVariances.over.total + a.eventFailures.failed.length + a.eventFailures.dead.length + a.openCases.total
    : undefined

  return (
    <RoleShell role="admin" active="attention" mode="desktop" counts={{ attention: waiting }}>
      <Page>
        <PageHeader title="محتاج تدخل" meta="كل اللي مستني قرار من الإدارة — بيتحدّث كل ٣٠ ثانية" />
        {kpis.data ? (
          <div className="grid gap-3 sm:grid-cols-4">
            {([
              ['طلبات النهارده', <Code key="o">{kpis.data.ordersToday}</Code>],
              ['قيمة طلبات النهارده', <Egp key="r" value={kpis.data.revenueToday} />],
              ['إجمالي الطلبات', <Code key="t">{kpis.data.totalOrders}</Code>],
              ['متوسط الطلب', <Egp key="a" value={kpis.data.averageOrderValue} />],
            ] as const).map(([k, v]) => (
              <div key={k} className="rounded-bw-card border border-bw-line bg-bw-surface p-4">
                <p className="text-bw-small text-bw-ink-soft">{k}</p>
                <p className="text-bw-title font-semibold">{v}</p>
              </div>
            ))}
          </div>
        ) : null}

        {attention.error ? <LoadError message={attention.error.message} onRetry={attention.reload} /> : null}
        {!a && attention.loading ? <Skeleton className="h-40 w-full" /> : null}
        {a && waiting === 0 ? <StateBlock kind="empty" title="مافيش حاجة مستنية تدخل دلوقتي" body="الطلبات الجديدة بتظهر في صفحة الطلبات." /> : null}

        {a ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {a.supplyActionRequired.total ? (
              <Section title={`عجز توفير محتاج قرار (${a.supplyActionRequired.total})`}>
                <ul>{a.supplyActionRequired.items.map((i) => (
                  <QueueRow key={i.orderId + i.category} tone="warn" title={orderLink(i.orderId, i.orderNumber)} detail={<>كمية مش متغطية: <Code>{i.unresolvedQuantity}</Code> · {i.category}</>} meta={formatDateTime(i.since)} />
                ))}</ul>
              </Section>
            ) : null}
            {a.customerDecisionsPending.total ? (
              <Section title={`مستني رد العميل (${a.customerDecisionsPending.total})`}>
                <ul>{a.customerDecisionsPending.items.map((i) => (
                  <QueueRow key={i.orderId + i.reason} tone="pending" title={orderLink(i.orderId, i.orderNumber)} detail={<>الكمية: <Code>{i.unresolvedQuantity}</Code> · ينتهي {formatDateTime(i.expiresAt)}</>} />
                ))}</ul>
              </Section>
            ) : null}
            {a.distributionRequired.total ? (
              <Section title={`توزيع كمية جزئية على أكتر من طلب (${a.distributionRequired.total})`} aside={<Link className="text-bw-small font-semibold text-bw-action-ink underline" href="/admin/sourcing">أوامر الشراء</Link>}>
                <ul>{a.distributionRequired.items.map((i) => (
                  <QueueRow key={i.lineId} tone="warn" title={<>أمر شراء <Code>{shortId(i.purchaseOrderId)}</Code></>} detail={<>المؤكد <Code>{`${i.confirmedQuantity ?? 0}/${i.requestedQuantity}`}</Code> على <Code>{i.orderAllocations}</Code> طلبات</>} />
                ))}</ul>
              </Section>
            ) : null}
            {a.failedDeliveries.total ? (
              <Section title={`محاولات توصيل فاشلة (${a.failedDeliveries.total})`}>
                <ul>{a.failedDeliveries.items.map((i) => (
                  <QueueRow key={i.orderId} tone="danger" title={orderLink(i.orderId, i.orderNumber)} detail={i.reasonCode ? FAILURE_REASONS[i.reasonCode] ?? i.reasonCode : '—'} meta={formatDateTime(i.failedAt)} />
                ))}</ul>
              </Section>
            ) : null}
            {a.cashVariances.short.total + a.cashVariances.over.total ? (
              <Section title="فروق في عدّ النقدية">
                <ul>{[...a.cashVariances.short.items, ...a.cashVariances.over.items].map((i) => (
                  <QueueRow key={i.orderId} tone="danger" title={orderLink(i.orderId, i.orderNumber)} detail={<>متوقع <Egp value={i.expectedAmount} /> · أعلن <Egp value={i.declaredAmount} /> · اتعدّ <Egp value={i.countedAmount} /> · الفرق <Egp value={i.variance} /></>} />
                ))}</ul>
              </Section>
            ) : null}
            {a.deliveredUnsettled.total ? (
              <Section title={`كاش اتحصّل ولسه ماتعدّش (${a.deliveredUnsettled.total})`} aside={<Link className="text-bw-small font-semibold text-bw-action-ink underline" href="/admin/cash">التحصيل</Link>}>
                <ul>{a.deliveredUnsettled.items.map((i) => (
                  <QueueRow key={i.orderId} tone="warn" title={orderLink(i.orderId, i.orderNumber)} detail={<>أعلن المندوب <Egp value={i.declaredAmount} /></>} />
                ))}</ul>
              </Section>
            ) : null}
            {a.eventFailures.failed.length + a.eventFailures.dead.length ? (
              <Section title="أحداث النظام اللي فشلت">
                <ul>{[...a.eventFailures.failed, ...a.eventFailures.dead].map((e) => (
                  <QueueRow key={e.id} tone="danger" title={<Code>{e.eventType}</Code>} detail={<>{e.consumer} · محاولات <Code>{e.attempts}</Code> · {e.lastError ?? ''}</>} />
                ))}</ul>
              </Section>
            ) : null}
            {a.openCases.total ? (
              <Section title={`حالات واستثناءات مفتوحة (${a.openCases.total})`}>
                <ul>{a.openCases.items.map((c) => (
                  <QueueRow key={c.id} tone={c.priority === 'critical' || c.priority === 'high' ? 'danger' : 'warn'} title={c.title} detail={c.orderId ? orderLink(c.orderId, null) : null} meta={formatDateTime(c.createdAt)} />
                ))}</ul>
              </Section>
            ) : null}
          </div>
        ) : null}
      </Page>
    </RoleShell>
  )
}
