import type { Attention } from '@/components/workspace/overview/types';

export interface OverviewOrder {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  governorate: string | null;
  area: string | null;
  paymentMethod: string;
  totalAmount: number;
  codAmount: number | null;
  itemCount: number;
  createdAt: string;
}
export interface OrderBucket {
  date: string;
  delivered: number;
  active: number;
  other: number;
  total: number;
}
const cairoDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** A bounded sample grouped by creation day and CURRENT status, never delivery throughput. */
export function orderBuckets(
  rows: Pick<OverviewOrder, 'createdAt' | 'status'>[],
  now = new Date(),
): OrderBucket[] {
  const today = cairoDate.format(now);
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 6 + index);
    return { date: date.toISOString().slice(0, 10), delivered: 0, active: 0, other: 0, total: 0 };
  });
  const byDate = new Map(buckets.map((b) => [b.date, b]));
  for (const row of rows) {
    const date = new Date(row.createdAt);
    if (!Number.isFinite(date.getTime())) continue;
    const bucket = byDate.get(cairoDate.format(date));
    if (!bucket) continue;
    if (row.status === 'delivered') bucket.delivered++;
    else if (['placed', 'confirmed', 'packing', 'shipped'].includes(row.status)) bucket.active++;
    else bucket.other++;
    bucket.total++;
  }
  return buckets;
}

/** Queue entries may overlap by order; event samples are capped, so not part of this total. */
export function attentionCounts(a: Attention): number[] {
  return [
    a.supplyActionRequired.total,
    a.customerDecisionsPending.total,
    a.distributionRequired.total,
    a.failedDeliveries.total,
    a.cashVariances.short.total + a.cashVariances.over.total,
    a.openCases.total,
  ];
}
