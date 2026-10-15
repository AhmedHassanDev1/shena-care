/*
 * Development-only demo data for the Admin Overview. Everything here is DERIVED from one set of
 * fixture orders so the KPIs, chart, tables and attention queues always agree with each other.
 *
 *  - Deterministic: a fixed-seed generator, never Math.random(); same hour → same data.
 *  - Anchored to Africa/Cairo: "today" is Cairo's today and no timestamp is in the future.
 *  - Shapes follow the real API responses (OrderStatus, PaymentMethod, SettlementStatus, …).
 *  - Money: totalAmount = line items + the 50 EGP delivery fee; codAmount only on COD orders.
 *    Cash counts (a queue SIZE) are never mixed with EGP amounts.
 *
 * Imported only behind `MOCK_OVERVIEW`, so it is absent from production bundles.
 */
import type { Attention } from '../../components/workspace/overview/types';
import type { OverviewOrder } from '../admin-overview';

export type DemoOrder = OverviewOrder & { currency: 'EGP'; hasPin: true; phone: string };

export interface OverviewFixtures {
  orders: DemoOrder[]; // newest first, like GET /admin/orders
  attention: Attention;
  kpis: { ordersToday: number; totalOrders: number };
}

/* ── Africa/Cairo time (handles the summer-time offset) ─────────────────────────────────────── */

const cairoParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function cairoOffsetMs(at: Date): number {
  const p = Object.fromEntries(cairoParts.formatToParts(at).map((x) => [x.type, x.value]));
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wallAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function cairoWallToUtc(y: number, m: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - cairoOffsetMs(new Date(guess));
  return new Date(guess - cairoOffsetMs(new Date(first)));
}

/** Start (00:00 Cairo) of the Cairo calendar day `daysAgo` days before `now`. */
function cairoDayStart(now: Date, daysAgo: number): Date {
  const p = Object.fromEntries(cairoParts.formatToParts(now).map((x) => [x.type, x.value]));
  const day = new Date(Date.UTC(+p.year, +p.month - 1, +p.day - daysAgo));
  return cairoWallToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, 0);
}

/* ── Seeded generator ───────────────────────────────────────────────────────────────────────── */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Egyptian commerce vocabulary ───────────────────────────────────────────────────────────── */

const CUSTOMERS = [
  'منى عبد الرحمن', 'أحمد سمير', 'نورهان إبراهيم', 'محمود عادل', 'سارة حسن', 'يوسف خالد',
  'هبة الله مصطفى', 'عمر فتحي', 'دعاء السيد', 'كريم أنور', 'ريم طارق', 'مصطفى جمال',
  'ياسمين هشام', 'عبد الله رضا', 'آية محمود', 'إسلام شريف', 'فاطمة الزهراء علي', 'تامر نبيل',
  'مي عصام', 'حسام الدين ماهر', 'رنا وليد', 'بسمة أشرف', 'زياد مدحت', 'جهاد كمال',
  'علا فؤاد', 'شهد ياسر', 'كارم صبحي', 'ليلى مجدي',
];

const AREAS: Array<[area: string, governorate: string]> = [
  ['مدينة نصر', 'القاهرة'], ['المعادي', 'القاهرة'], ['التجمع الخامس', 'القاهرة'],
  ['مصر الجديدة', 'القاهرة'], ['الرحاب', 'القاهرة'], ['الزمالك', 'القاهرة'],
  ['شبرا', 'القاهرة'], ['حلوان', 'القاهرة'], ['الدقي', 'الجيزة'], ['المهندسين', 'الجيزة'],
  ['الشيخ زايد', 'الجيزة'], ['6 أكتوبر', 'الجيزة'], ['فيصل', 'الجيزة'], ['حدائق الأهرام', 'الجيزة'],
];

/** Skincare / haircare catalogue; prices in EGP. Names only price the baskets (not in the API). */
const CATALOGUE: Array<[name: string, price: number]> = [
  ['سيروم فيتامين C 30 مل', 485], ['كريم مرطب بالسيراميد', 320], ['غسول وجه لطيف', 210],
  ['واقي شمس SPF50', 395], ['تونر النياسيناميد', 275], ['شامبو ضد القشرة', 180],
  ['زيت أرغان للشعر', 260], ['ماسك الكيراتين للشعر', 340], ['بلسم بروتين', 195],
];
const DELIVERY_FEE_EGP = 50;

const ORDERS_PER_DAY = [9, 12, 10, 14, 8, 11, 13, 11, 9, 12, 10, 8, 13, 9]; // index 0 = today
const SAMPLE_DAYS = ORDERS_PER_DAY.length;

type Status = 'placed' | 'confirmed' | 'packing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';
/** Current-status mix by age: fresh orders are early in the flow, old ones are terminal. */
const STATUS_MIX: Array<Array<[Status, number]>> = [
  [['placed', 0.5], ['confirmed', 0.2], ['packing', 0.1], ['shipped', 0.08], ['delivered', 0.1], ['cancelled', 0.02]],
  [['placed', 0.2], ['confirmed', 0.1], ['packing', 0.08], ['shipped', 0.22], ['delivered', 0.32], ['cancelled', 0.05], ['returned', 0.03]],
  [['placed', 0.1], ['packing', 0.05], ['shipped', 0.12], ['delivered', 0.63], ['cancelled', 0.05], ['returned', 0.05]],
  [['shipped', 0.03], ['delivered', 0.85], ['cancelled', 0.06], ['returned', 0.06]],
];
const OLD_MIX: Array<[Status, number]> = [['delivered', 0.86], ['cancelled', 0.07], ['returned', 0.07]];

const hex = (rng: () => number, length: number) =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join('');
const uuid = (rng: () => number) =>
  `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-8${hex(rng, 3)}-${hex(rng, 12)}`;
const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

/**
 * Exactly `count` statuses following the mix (largest remainder), ordered oldest-first so the
 * oldest orders of a day are the furthest along the workflow and the newest are just placed.
 */
const FLOW: Status[] = ['delivered', 'returned', 'cancelled', 'shipped', 'packing', 'confirmed', 'placed'];
function statusesFor(mix: Array<[Status, number]>, count: number): Status[] {
  const shares = mix.map(([status, weight]) => ({ status, whole: Math.floor(weight * count), rest: (weight * count) % 1 }));
  let missing = count - shares.reduce((sum, s) => sum + s.whole, 0);
  for (const s of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (missing-- <= 0) break;
    s.whole++;
  }
  return shares
    .flatMap((s) => Array<Status>(s.whole).fill(s.status))
    .sort((a, b) => FLOW.indexOf(a) - FLOW.indexOf(b));
}

/* ── Builder ────────────────────────────────────────────────────────────────────────────────── */

const iso = (ms: number) => new Date(ms).toISOString();
const money = (n: number) => n.toFixed(2);
const HOUR = 3_600_000;
const MINUTE = 60_000;

export function buildOverviewFixtures(now: Date = new Date()): OverviewFixtures {
  const rng = mulberry32(20261015);
  const nowMs = now.getTime();
  const orders: Array<DemoOrder & { age: number }> = [];

  for (let age = 0; age < SAMPLE_DAYS; age++) {
    const dayStart = cairoDayStart(now, age).getTime();
    // Today's orders spread over the (hour-floored) elapsed day so none is ever in the future.
    const elapsed = nowMs - dayStart;
    const spanToday = elapsed >= HOUR ? Math.floor(elapsed / HOUR) * HOUR : Math.max(elapsed - 2 * MINUTE, MINUTE);
    const count = ORDERS_PER_DAY[age];
    const statuses = statusesFor(STATUS_MIX[age] ?? OLD_MIX, count);
    for (let k = 0; k < count; k++) {
      const fraction = (k + 0.5 + (rng() - 0.5) * 0.6) / count;
      const createdMs =
        age === 0 ? dayStart + Math.floor(fraction * spanToday) : dayStart + 8 * HOUR + Math.floor(fraction * 15.5 * HOUR);
      const basket = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => pick(rng, CATALOGUE));
      const units = basket.map(([, price]) => ({ price, qty: 1 + (rng() < 0.25 ? 1 : 0) }));
      const subtotal = units.reduce((sum, u) => sum + u.price * u.qty, 0);
      const total = subtotal + DELIVERY_FEE_EGP;
      const [area, governorate] = pick(rng, AREAS);
      const paymentRoll = rng();
      const paymentMethod = paymentRoll < 0.72 ? 'COD' : paymentRoll < 0.88 ? 'CARD' : 'MOBILE_WALLET';
      orders.push({
        age,
        id: uuid(rng),
        orderNumber: `ORD-${hex(rng, 16).toUpperCase()}`,
        status: statuses[k],
        customerName: pick(rng, CUSTOMERS),
        governorate,
        area,
        paymentMethod,
        totalAmount: total,
        codAmount: paymentMethod === 'COD' ? total : null,
        currency: 'EGP',
        hasPin: true,
        phone: `010${Math.floor(rng() * 1e8).toString().padStart(8, '0')}`,
        itemCount: units.reduce((sum, u) => sum + u.qty, 0),
        createdAt: iso(createdMs),
      });
    }
  }
  orders.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  /* Queues are chosen FROM the orders, so every row points at an order that exists in the table. */
  const created = (o: DemoOrder) => Date.parse(o.createdAt);
  const after = (o: DemoOrder, ms: number) => Math.min(created(o) + ms, nowMs - 5 * MINUTE);
  const oldestFirst = <T extends DemoOrder>(list: T[]) => [...list].sort((a, b) => created(a) - created(b));
  const recent = (statuses: Status[], maxAge: number) =>
    oldestFirst(orders.filter((o) => statuses.includes(o.status as Status) && o.age <= maxAge));

  const waiting = recent(['placed'], 2);
  const shortage = waiting.slice(0, 4);
  const decisions = waiting.slice(4, 7);
  const stuck = recent(['shipped'], 4).slice(0, 3);
  const delivered = oldestFirst(orders.filter((o) => o.status === 'delivered' && o.codAmount !== null));
  const cashBase = (o: DemoOrder) => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    expectedAmount: money(o.codAmount!),
  });

  const countable = delivered.filter((o) => o.age >= 2 && o.age <= 4);
  const shortOrders = countable.slice(0, 2);
  const overOrders = countable.slice(2, 3);
  const flagged = new Set([...shortOrders, ...overOrders].map((o) => o.id));
  // The courier declared the cash at hand-over; the hub has not counted it yet (today / yesterday).
  const unsettled = delivered.filter((o) => o.age <= 1 && !flagged.has(o.id));

  const FAILURES = ['CUSTOMER_UNREACHABLE', 'ADDRESS_NOT_FOUND', 'RESCHEDULE_REQUESTED'];
  const page = <T>(items: T[]) => ({ total: items.length, items: items.slice(0, 10) });

  const attention: Attention = {
    supplyActionRequired: page(
      shortage.map((o, i) => ({
        orderId: o.id,
        orderNumber: o.orderNumber,
        category: 'SOURCE_EXHAUSTED',
        unresolvedQuantity: 1 + (i % 2),
        since: iso(after(o, 25 * MINUTE)),
      })),
    ),
    customerDecisionsPending: page(
      decisions.map((o, i) => ({
        orderId: o.id,
        orderNumber: o.orderNumber,
        reason: 'unavailable',
        unresolvedQuantity: 1 + (i % 2),
        expiresAt: iso(created(o) + 24 * HOUR),
      })),
    ),
    distributionRequired: page(
      [
        [12, 8, 2], [10, 6, 3], [6, 4, 2],
      ].map(([requested, confirmed, allocations]) => ({
        purchaseOrderId: uuid(rng),
        lineId: uuid(rng),
        requestedQuantity: requested,
        confirmedQuantity: confirmed,
        orderAllocations: allocations,
      })),
    ),
    failedDeliveries: page(
      stuck.map((o, i) => ({
        orderId: o.id,
        orderNumber: o.orderNumber,
        reasonCode: FAILURES[i % FAILURES.length],
        failedAt: iso(after(o, 20 * HOUR)),
      })),
    ),
    cashVariances: {
      short: page(
        shortOrders.map((o, i) => ({
          ...cashBase(o),
          declaredAmount: money(o.codAmount!),
          countedAmount: money(o.codAmount! - (i === 0 ? 60 : 35)),
          variance: money(-(i === 0 ? 60 : 35)),
        })),
      ),
      over: page(
        overOrders.map((o) => ({
          ...cashBase(o),
          declaredAmount: money(o.codAmount!),
          countedAmount: money(o.codAmount! + 20),
          variance: money(20),
        })),
      ),
    },
    deliveredUnsettled: page(
      unsettled.map((o) => ({
        ...cashBase(o),
        declaredAmount: money(o.codAmount!),
        countedAmount: null,
        variance: null,
      })),
    ),
    eventFailures: {
      failed: [
        {
          id: uuid(rng),
          eventType: 'order.placed',
          consumer: 'sourcing.supply-plan',
          aggregateId: shortage[0]?.id ?? uuid(rng),
          attempts: 3,
          lastError: 'Supplier catalogue timeout while planning SKU coverage',
        },
        {
          id: uuid(rng),
          eventType: 'purchase_order.confirmed',
          consumer: 'sourcing.supply-plan-advance',
          aggregateId: uuid(rng),
          attempts: 2,
          lastError: 'Order lock timeout',
        },
      ],
      dead: [
        {
          id: uuid(rng),
          eventType: 'purchase_order.shortfall',
          consumer: 'sourcing.supply-plan-advance',
          aggregateId: uuid(rng),
          attempts: 8,
          lastError: 'Shortfall exceeds the confirmed quantity',
        },
      ],
    },
    openCases: (() => {
      const nth = (list: DemoOrder[], i: number) => list[i]?.id ?? null;
      const cases = [
        ['critical', 'شحنة متأخرة — العميل لا يرد بعد محاولتين من المندوب الخاص', nth(stuck, 0), 30],
        ['high', 'فرق استلام في مخزن ONE: وصل 8 من 12 — سيروم فيتامين C', null, 9],
        ['high', 'عجز في عدّ نقدية مندوب خاص — 60 ج.م', nth(shortOrders, 0), 20],
        ['high', 'فرق استلام في مخزن ONE: عبوتان بتاريخ صلاحية قصير — زيت أرغان', null, 14],
        ['medium', 'عبوة شامبو متضررة عند الاستلام', nth(delivered, 0), 40],
        ['medium', 'العميل طلب تغيير العنوان بعد خروج الشحنة', nth(stuck, 1), 6],
        ['medium', 'المورد غيّر السعر بعد التأكيد — ماسك الكيراتين', null, 26],
        ['low', 'استفسار عن موعد تسليم طلب مرتجع', nth(orders.filter((o) => o.status === 'returned'), 0), 52],
      ] as const;
      const rank: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
      // Same order as the API: priority first, then the oldest.
      return page(
        cases
          .map(([priority, title, orderId, hoursAgo]) => ({
            id: uuid(rng),
            title,
            priority,
            orderId,
            createdAt: iso(nowMs - hoursAgo * HOUR),
          }))
          .sort((a, b) => rank[b.priority] - rank[a.priority] || Date.parse(a.createdAt) - Date.parse(b.createdAt)),
      );
    })(),
  };

  const todayStart = cairoDayStart(now, 0).getTime();
  return {
    orders: orders.map(({ age: _age, ...order }) => order),
    attention,
    kpis: {
      ordersToday: orders.filter((o) => created(o) >= todayStart).length,
      totalOrders: orders.length,
    },
  };
}
