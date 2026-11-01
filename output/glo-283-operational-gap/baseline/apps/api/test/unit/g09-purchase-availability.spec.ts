// GLO-280 / GLO-281 — the single availability policy (no database needed).
import { customerAvailabilityWindowMs, provisionalOrderingEnabled, resolvePurchaseAvailability } from '../../src/modules/sourcing/services/availability-policy';

const HOUR = 3600000;
const now = new Date('2026-10-23T12:00:00Z');
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
const resolve = (offers: Array<{ lastConfirmedAt: Date | null; lastObservedAt: Date }>, provisional = false) =>
  resolvePurchaseAvailability(offers, now, 24 * HOUR, provisional);

describe('GLO-281 purchase availability policy', () => {
  it('no available offer → UNAVAILABLE', () => {
    expect(resolve([])).toMatchObject({ state: 'UNAVAILABLE', orderable: false, validUntil: null });
  });

  it('a fresh confirmation is CONFIRMED and orderable, whatever the policy switch says', () => {
    for (const provisional of [false, true]) {
      expect(resolve([{ lastConfirmedAt: ago(2), lastObservedAt: ago(2) }], provisional)).toMatchObject({ state: 'CONFIRMED', orderable: true });
    }
    expect(resolve([{ lastConfirmedAt: ago(2), lastObservedAt: ago(2) }]).validUntil).toEqual(new Date(ago(2).getTime() + 24 * HOUR));
  });

  it('a fresh feed signal without confirmation is PROVISIONAL: orderable only when the owner switch is on', () => {
    const feedOnly = [{ lastConfirmedAt: null, lastObservedAt: ago(1) }];
    expect(resolve(feedOnly, false)).toMatchObject({ state: 'PROVISIONAL', orderable: false, confirmedAt: null });
    expect(resolve(feedOnly, true)).toMatchObject({ state: 'PROVISIONAL', orderable: true });
  });

  it('a stale confirmation does not become provisional availability through an old observation', () => {
    expect(resolve([{ lastConfirmedAt: ago(30), lastObservedAt: ago(30) }], true)).toMatchObject({ state: 'UNAVAILABLE', orderable: false });
  });

  it('a stale confirmation plus a fresh feed signal is PROVISIONAL, not CONFIRMED', () => {
    expect(resolve([{ lastConfirmedAt: ago(30), lastObservedAt: ago(1) }])).toMatchObject({ state: 'PROVISIONAL', orderable: false });
  });

  it('several suppliers: one fresh confirmation anywhere is enough; future-dated timestamps are ignored', () => {
    expect(resolve([{ lastConfirmedAt: null, lastObservedAt: ago(1) }, { lastConfirmedAt: ago(5), lastObservedAt: ago(5) }]).state).toBe('CONFIRMED');
    const future = new Date(now.getTime() + HOUR);
    expect(resolve([{ lastConfirmedAt: future, lastObservedAt: future }]).state).toBe('UNAVAILABLE');
  });

  it('reads its configuration from the environment with safe defaults and validation', () => {
    expect(customerAvailabilityWindowMs({})).toBe(24 * HOUR);
    expect(customerAvailabilityWindowMs({ SUPPLIER_AVAILABILITY_MAX_AGE_HOURS: '6' })).toBe(6 * HOUR);
    expect(() => customerAvailabilityWindowMs({ SUPPLIER_AVAILABILITY_MAX_AGE_HOURS: '0' })).toThrow();
    expect(provisionalOrderingEnabled({})).toBe(true); // owner decision 2026-10-25: a fresh supplier signal is orderable
    expect(provisionalOrderingEnabled({ SUPPLIER_PROVISIONAL_ORDERABLE: 'true' })).toBe(true);
    expect(provisionalOrderingEnabled({ SUPPLIER_PROVISIONAL_ORDERABLE: 'false' })).toBe(false);
  });
});
