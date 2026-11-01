import { getMessages } from '@/lib/i18n/messages';
import type { CustomerStage, OrderTracking } from '@/lib/orders';
import { addressLine, isFinished, stageTone, trackingSteps } from './order-stages';

const m = getMessages('ar');

const order = (status: CustomerStage, timeline: Array<[CustomerStage, string]> = []): OrderTracking =>
  ({
    orderNumber: 'ORD-1',
    createdAt: '2026-10-18T07:12:00Z',
    status,
    orderReceived: true,
    availabilityConfirmed: false,
    customerName: 'منة',
    deliveryAddress: { governorate: 'Cairo', area: 'مدينة نصر', address: 'عمارة ١٤' },
    amounts: { originalCodAmount: 570, currentCodAmount: 570, subtotal: 520, shippingFee: 50, currency: 'EGP' },
    items: [],
    timeline: [['RECEIVED', '2026-10-18T07:12:00Z'] as [CustomerStage, string], ...timeline].map(([s, occurredAt]) => ({ status: s, occurredAt })),
    delivery: { certainty: 'unknown', estimatedDate: null, deliveredAt: null, nextUpdateBy: null, promise: null },
    actionRequired: null,
    resolutions: [],
  }) as OrderTracking;

const dots = (o: OrderTracking) => trackingSteps(o, m, 'ar').map((step) => `${step.id}:${step.dot}`);

describe('trackingSteps', () => {
  it('shows cash as a step with no payment action and waits on confirmation', () => {
    expect(dots(order('CONFIRMING_PRODUCTS'))).toEqual([
      'received:done',
      'payment:na',
      'confirm:now',
      'preparing:next',
      'courier:next',
      'delivered:next',
    ]);
  });

  it('marks only what the server reports reached', () => {
    const preparing = order('PREPARING', [['CONFIRMED', '2026-10-18T09:40:00Z'], ['PREPARING', '2026-10-18T10:00:00Z']]);
    expect(dots(preparing)).toEqual(['received:done', 'payment:na', 'confirm:done', 'preparing:now', 'courier:next', 'delivered:next']);
    const delivered = order('DELIVERED', [['CONFIRMED', '2026-10-18T09:40:00Z'], ['DELIVERED', '2026-10-19T10:00:00Z']]);
    expect(dots(delivered).at(-1)).toBe('delivered:done');
  });

  it('flags a decision, a failed delivery and a cancellation', () => {
    expect(dots(order('ACTION_REQUIRED'))).toContain('confirm:warn');
    expect(dots(order('DELIVERY_ISSUE', [['CONFIRMED', '2026-10-18T09:40:00Z']]))).toContain('courier:warn');
    expect(dots(order('CANCELLED', [['CANCELLED', '2026-10-18T09:00:00Z']]))).toEqual(['received:done', 'payment:na', 'cancel:err']);
    expect(dots(order('CANCELLATION_REQUESTED')).at(-1)).toBe('cancel:warn');
  });
});

describe('order stage helpers', () => {
  it('maps tones and the finished filter', () => {
    expect(stageTone('DELIVERED')).toBe('ok');
    expect(stageTone('PREPARING')).toBe('cobalt');
    expect(stageTone('CANCELLED')).toBe('gray');
    expect(isFinished('CANCELLED')).toBe(true);
    expect(isFinished('OUT_FOR_DELIVERY')).toBe(false);
  });

  it('writes the stored governorate in the interface language', () => {
    expect(addressLine(order('RECEIVED').deliveryAddress, m)).toBe('عمارة ١٤، مدينة نصر، القاهرة');
  });
});
