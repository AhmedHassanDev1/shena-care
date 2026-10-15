'use client';
import Link from 'next/link';
import { Code, QueueRow, Section } from '@/components/bw/primitives';
import { Egp } from '@/components/workspace/kit';
import { FAILURE_REASONS, formatDateTime, shortId } from '@/lib/labels';
import type { Attention } from './types';
const orderLink = (orderId: string, orderNumber: string | null) => (
  <Link href={`/admin/orders/${orderId}`} className="font-semibold text-bw-action-ink underline">
    <Code>{orderNumber ?? shortId(orderId)}</Code>
    <span className="ms-2">عرض الطلب ←</span>
  </Link>
);
export function AttentionQueues({ a }: { a: Attention }) {
  return (
    <div className="ao-queues space-y-3">
      {a.supplyActionRequired.total ? (
        <Section title={`عجز توفير محتاج قرار (${a.supplyActionRequired.total})`}>
          <ul>
            {a.supplyActionRequired.items.map((i) => (
              <QueueRow
                key={i.orderId + i.category}
                tone="warn"
                title={orderLink(i.orderId, i.orderNumber)}
                detail={
                  <>
                    كمية مش متغطية: <Code>{i.unresolvedQuantity}</Code> · {i.category}
                  </>
                }
                meta={formatDateTime(i.since)}
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {a.customerDecisionsPending.total ? (
        <Section title={`مستني رد العميل (${a.customerDecisionsPending.total})`}>
          <ul>
            {a.customerDecisionsPending.items.map((i) => (
              <QueueRow
                key={i.orderId + i.reason}
                tone="pending"
                title={orderLink(i.orderId, i.orderNumber)}
                detail={
                  <>
                    الكمية: <Code>{i.unresolvedQuantity}</Code> · ينتهي{' '}
                    {formatDateTime(i.expiresAt)}
                  </>
                }
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {a.distributionRequired.total ? (
        <Section
          title={`توزيع كمية جزئية على أكتر من طلب (${a.distributionRequired.total})`}
          aside={
            <Link
              className="text-bw-small font-semibold text-bw-action-ink underline"
              href="/admin/sourcing"
            >
              أوامر الشراء
            </Link>
          }
        >
          <ul>
            {a.distributionRequired.items.map((i) => (
              <QueueRow
                key={i.lineId}
                tone="warn"
                title={
                  <>
                    أمر شراء <Code>{shortId(i.purchaseOrderId)}</Code>
                  </>
                }
                detail={
                  <>
                    المؤكد <Code>{`${i.confirmedQuantity ?? 0}/${i.requestedQuantity}`}</Code> على{' '}
                    <Code>{i.orderAllocations}</Code> طلبات
                  </>
                }
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {a.failedDeliveries.total ? (
        <Section title={`محاولات توصيل فاشلة (${a.failedDeliveries.total})`}>
          <ul>
            {a.failedDeliveries.items.map((i) => (
              <QueueRow
                key={i.orderId}
                tone="danger"
                title={orderLink(i.orderId, i.orderNumber)}
                detail={i.reasonCode ? (FAILURE_REASONS[i.reasonCode] ?? i.reasonCode) : '—'}
                meta={formatDateTime(i.failedAt)}
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {a.cashVariances.short.total + a.cashVariances.over.total ? (
        <Section title="فروق في عدّ النقدية">
          <ul>
            {[...a.cashVariances.short.items, ...a.cashVariances.over.items].map((i) => (
              <QueueRow
                key={i.orderId}
                tone="danger"
                title={orderLink(i.orderId, i.orderNumber)}
                detail={
                  <>
                    متوقع <Egp value={i.expectedAmount} /> · أعلن <Egp value={i.declaredAmount} /> ·
                    اتعدّ <Egp value={i.countedAmount} /> · الفرق <Egp value={i.variance} />
                  </>
                }
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {a.deliveredUnsettled.total ? (
        <Section
          title={`كاش اتحصّل ولسه ماتعدّش (${a.deliveredUnsettled.total})`}
          aside={
            <Link
              className="text-bw-small font-semibold text-bw-action-ink underline"
              href="/admin/cash"
            >
              التحصيل
            </Link>
          }
        >
          <ul>
            {a.deliveredUnsettled.items.map((i) => (
              <QueueRow
                key={i.orderId}
                tone="warn"
                title={orderLink(i.orderId, i.orderNumber)}
                detail={
                  <>
                    أعلن المندوب <Egp value={i.declaredAmount} />
                  </>
                }
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {a.eventFailures.failed.length + a.eventFailures.dead.length ? (
        <Section title="أحداث النظام اللي فشلت">
          <ul>
            {[...a.eventFailures.failed, ...a.eventFailures.dead].map((e) => (
              <QueueRow
                key={e.id}
                tone="danger"
                title={<Code>{e.eventType}</Code>}
                detail={
                  <>
                    {e.consumer} · محاولات <Code>{e.attempts}</Code> · {e.lastError ?? ''}
                  </>
                }
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {a.openCases.total ? (
        <Section title={`حالات واستثناءات مفتوحة (${a.openCases.total})`}>
          <ul>
            {a.openCases.items.map((c) => (
              <QueueRow
                key={c.id}
                tone={c.priority === 'critical' || c.priority === 'high' ? 'danger' : 'warn'}
                title={c.title}
                detail={c.orderId ? orderLink(c.orderId, null) : null}
                meta={formatDateTime(c.createdAt)}
              />
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
