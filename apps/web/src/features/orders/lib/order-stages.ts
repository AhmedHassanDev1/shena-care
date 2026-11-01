import type { StatusTone } from '@/components/ui/status-chip';
import type { TimelineItem } from '@/components/ui/timeline';
import { formatDayTime } from '@/lib/i18n/format';
import type { Locale, Messages } from '@/lib/i18n/messages';
import type { CustomerStage, OrderTracking } from '@/lib/orders';
import { toGovernorate } from '@/features/checkout/lib/checkout-draft';

/** Chip tone per customer stage (OrdersD): in progress cobalt, delivered ok, needs attention warn, closed gray. */
export function stageTone(stage: CustomerStage): StatusTone {
  switch (stage) {
    case 'DELIVERED':
      return 'ok';
    case 'ACTION_REQUIRED':
    case 'DELIVERY_ISSUE':
    case 'CANCELLATION_REQUESTED':
      return 'warn';
    case 'CANCELLED':
      return 'gray';
    default:
      return 'cobalt';
  }
}

export function stageLabel(stage: CustomerStage, m: Messages): string {
  return m[`orderChip${stage}` as keyof Messages] as string;
}

/** «شغّالة» vs «خلصت» (CommerceMobile ٦ filter). */
export function isFinished(stage: CustomerStage): boolean {
  return stage === 'DELIVERED' || stage === 'CANCELLED';
}

/** Position on the delivery ladder: received → confirmed → preparing → with the courier → delivered. */
const LADDER: Record<CustomerStage, number> = {
  RECEIVED: 0,
  CONFIRMING_PRODUCTS: 0,
  ACTION_REQUIRED: 0,
  CONFIRMED: 1,
  PREPARING: 2,
  OUT_FOR_DELIVERY: 3,
  DELIVERY_ISSUE: 3,
  DELIVERED: 4,
  CANCELLATION_REQUESTED: -1,
  CANCELLED: -1,
};

/**
 * The tracking rows of OrdersD / CommerceMobile ٧ from the server's projection — nothing inferred beyond it:
 * الطلب اتسجّل · الدفع: كاش عند الاستلام (na: no payment step for cash) · اتأكد للتجهيز · بيتجهّز · مع المندوب · اتسلّم.
 * A step is `done` only when the server reports it reached; the current one is `now` (or `warn` / `err` for a
 * decision, a failed delivery or a cancellation); later ones are `next`. A cancelled order ends at «اتلغى».
 */
export function trackingSteps(order: OrderTracking, m: Messages, locale: Locale): TimelineItem[] {
  const at = (stage: CustomerStage) => order.timeline.find((event) => event.status === stage)?.occurredAt ?? null;
  const time = (stage: CustomerStage) => {
    const when = at(stage);
    return when ? formatDayTime(when, locale) : undefined;
  };
  // How far the order got: its own stage, or for a cancellation the furthest stage it reached before.
  const reached =
    LADDER[order.status] >= 0
      ? LADDER[order.status]
      : Math.max(0, ...order.timeline.map((event) => LADDER[event.status]).filter((n) => n >= 0));
  const closing = order.status === 'CANCELLED' || order.status === 'CANCELLATION_REQUESTED';
  const state = (step: number): TimelineItem['dot'] => (step < reached || (step === reached && order.status === 'DELIVERED') ? 'done' : step === reached && !closing ? 'now' : 'next');

  const steps: TimelineItem[] = [
    { id: 'received', label: m.stageRegistered, detail: formatDayTime(order.createdAt, locale), dot: 'done' },
    { id: 'payment', label: m.stagePaymentCod, detail: m.stagePaymentCodLater, dot: 'na' },
  ];

  if (order.status === 'ACTION_REQUIRED') {
    steps.push({ id: 'confirm', label: m.stageActionRequired, detail: m.stageActionRequiredDetail, dot: 'warn' });
  } else if (reached >= 1) {
    steps.push({ id: 'confirm', label: m.stageConfirmed, detail: time('CONFIRMED'), dot: 'done' });
  } else if (!closing) {
    steps.push({ id: 'confirm', label: m.stageConfirm, detail: m.stageConfirmWaiting, dot: 'now' });
  }

  const later: Array<{ id: string; step: number; label: string; stage: CustomerStage; detail?: string }> = [
    { id: 'preparing', step: 2, label: m.stagePreparing, stage: 'PREPARING', detail: m.stagePreparingDetail },
    { id: 'courier', step: 3, label: m.stageOutForDelivery, stage: 'OUT_FOR_DELIVERY' },
    { id: 'delivered', step: 4, label: m.stageDelivered, stage: 'DELIVERED' },
  ];
  for (const row of later) {
    if (closing && row.step > reached) break;
    if (row.id === 'courier' && order.status === 'DELIVERY_ISSUE') {
      steps.push({ id: row.id, label: m.stageDeliveryIssue, detail: m.stageDeliveryIssueDetail, dot: 'warn' });
      continue;
    }
    const dot = state(row.step);
    steps.push({
      id: row.id,
      label: row.label,
      detail: dot === 'done' ? time(row.stage) ?? (row.step === 4 && order.delivery.deliveredAt ? formatDayTime(order.delivery.deliveredAt, locale) : undefined) : dot === 'now' ? row.detail : undefined,
      dot,
    });
  }

  if (order.status === 'CANCELLATION_REQUESTED') {
    steps.push({ id: 'cancel', label: m.stageCancelRequested, detail: m.stageCancelRequestedDetail, dot: 'warn' });
  } else if (order.status === 'CANCELLED') {
    steps.push({ id: 'cancel', label: m.stageCancelled, detail: time('CANCELLED'), dot: 'err' });
  }
  return steps;
}

/** «عمارة ١٤، شارع مكرم عبيد، مدينة نصر، القاهرة»: the stored governorate (Cairo/Giza) in the interface language. */
export function addressLine(address: OrderTracking['deliveryAddress'], m: Messages): string {
  const governorate = toGovernorate(address.governorate);
  const governorateName = governorate === 'Cairo' ? m.checkoutCairo : governorate === 'Giza' ? m.checkoutGiza : address.governorate;
  return [address.address, address.area, governorateName].filter(Boolean).join('، ');
}
