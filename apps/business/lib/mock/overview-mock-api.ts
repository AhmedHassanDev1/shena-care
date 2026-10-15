/*
 * Development-only stand-in for the three reads behind the Admin Overview. It answers the same
 * paths with the same response shapes as the NestJS API, from the shared fixtures, so the page and
 * its data-processing functions are identical in both modes. Read-only: there is no write path.
 *
 * `state` lets a developer exercise the non-happy screens on demand; it is never chosen for the
 * user by a failed request.
 */
import { ApiError } from '../api';
import { buildOverviewFixtures, type OverviewFixtures } from './overview-fixtures';

export type MockOverviewState = 'live' | 'loading' | 'empty' | 'error' | 'forbidden';
export const MOCK_STATES: Array<{ id: MockOverviewState; label: string }> = [
  { id: 'live', label: 'بيانات' },
  { id: 'loading', label: 'تحميل' },
  { id: 'empty', label: 'فارغ' },
  { id: 'error', label: 'خطأ' },
  { id: 'forbidden', label: 'غير مصرح' },
];

const HOUR = 3_600_000;
const cache = new Map<number, OverviewFixtures>();
/** Same hour → same object, so 30-second polling never reshuffles the screen. */
function fixturesAt(now: Date): OverviewFixtures {
  const key = Math.floor(now.getTime() / HOUR);
  let fixtures = cache.get(key);
  if (!fixtures) {
    cache.clear();
    fixtures = buildOverviewFixtures(now);
    cache.set(key, fixtures);
  }
  return fixtures;
}

const emptyPage = { total: 0, items: [] };
const emptyAttention = {
  supplyActionRequired: emptyPage,
  customerDecisionsPending: emptyPage,
  distributionRequired: emptyPage,
  failedDeliveries: emptyPage,
  cashVariances: { short: emptyPage, over: emptyPage },
  deliveredUnsettled: emptyPage,
  eventFailures: { failed: [], dead: [] },
  openCases: emptyPage,
};

function route(path: string, fixtures: OverviewFixtures, empty: boolean): unknown {
  const url = new URL(path, 'http://demo.local');
  switch (url.pathname) {
    case '/operations/queues/attention':
      return empty ? emptyAttention : fixtures.attention;
    case '/operations/dashboard/kpis':
      return empty ? { ordersToday: 0, totalOrders: 0 } : fixtures.kpis;
    case '/admin/orders': {
      // Same filters and paging as AdminOrderQueryDto / listOrdersForStaff (take ≤ 100).
      const q = url.searchParams.get('q')?.trim().toLowerCase();
      const status = url.searchParams.get('status');
      const take = Math.min(Number(url.searchParams.get('take') ?? 20), 100);
      const skip = Number(url.searchParams.get('skip') ?? 0);
      const matches = empty
        ? []
        : fixtures.orders.filter(
            (o) =>
              (!status || o.status === status) &&
              (!q ||
                o.orderNumber.toLowerCase().includes(q) ||
                o.customerName.toLowerCase().includes(q) ||
                o.phone.includes(q)),
          );
      // The list endpoint never returns the customer's phone.
      return { total: matches.length, items: matches.slice(skip, skip + take).map(({ phone: _phone, ...order }) => order) };
    }
    default:
      throw new ApiError(`Demo data has no route for ${url.pathname}`, 404);
  }
}

export function mockOverviewRequest<T>(
  path: string,
  signal: AbortSignal,
  options: { state?: MockOverviewState; now?: Date; delayMs?: number } = {},
): Promise<T> {
  const { state = 'live', now = new Date(), delayMs = 350 } = options;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    if (signal.aborted) return abort();
    if (state === 'loading') {
      signal.addEventListener('abort', abort, { once: true }); // never settles, like a hung request
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      try {
        if (state === 'error') throw new ApiError('Demo: simulated server error', 500);
        if (state === 'forbidden') throw new ApiError('Demo: simulated missing permission', 403);
        resolve(route(path, fixturesAt(now), state === 'empty') as T);
      } catch (error) {
        reject(error);
      }
    }, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        abort();
      },
      { once: true },
    );
  });
}
