import { allocateScarceQuantity, recoveryExclusions } from '../../src/modules/sourcing/services/procurement-policy';

describe('GLO-283 procurement policy', () => {
  const at = new Date('2027-01-13T10:00:00Z');
  const offer = { costPrice: 50, currency: 'EGP', minimumOrderUnits: 1, orderMultipleUnits: 1,
    supplier: { closedWeekdays: [5], closedDates: [], opensAt: '09:00', closesAt: '01:00', pickupLeadMinutes: 30 } };
  const context = { now: at, quantity: 4, maximumUnitCost: 100, currency: 'EGP', deliveryDeadline: new Date('2027-01-14T21:59:59Z') };

  it('excludes closed, incompatible pack, margin and infeasible pickup offers before recovery issuance', () => {
    expect(recoveryExclusions(offer, context)).toEqual([]);
    expect(recoveryExclusions({ ...offer, supplier: { ...offer.supplier, closedWeekdays: [3] } }, context)).toContain('SUPPLIER_CLOSED');
    expect(recoveryExclusions({ ...offer, orderMultipleUnits: 3 }, context)).toContain('ORDER_MULTIPLE');
    expect(recoveryExclusions({ ...offer, minimumOrderUnits: 6 }, context)).toContain('MOQ');
    expect(recoveryExclusions({ ...offer, costPrice: 101 }, context)).toContain('MARGIN_LIMIT');
    expect(recoveryExclusions({ ...offer, supplier: { ...offer.supplier, pickupLeadMinutes: null } }, context)).toContain('PICKUP_FEASIBILITY_UNKNOWN');
    expect(recoveryExclusions(offer, { ...context, deliveryDeadline: new Date(at.getTime() + 10 * 60000) })).toContain('DELIVERY_PROMISE');
  });

  it('allocates only available stock by deadline, readiness, FIFO and stable order ID', () => {
    const entry = (id: string, deadline: number, ready: boolean, created: number) => ({ id, orderId: id,
      quantity: 2, deliveryDeadline: deadline, otherwiseReady: ready, orderCreatedAt: created });
    const entries = [entry('d', 2, true, 0), entry('c', 1, false, 0), entry('b', 1, true, 1), entry('a', 1, true, 1)];
    expect([...allocateScarceQuantity(entries, 5)]).toEqual([['a', 2], ['b', 2], ['c', 1], ['d', 0]]);
    expect([...allocateScarceQuantity([...entries].reverse(), 5)]).toEqual([...allocateScarceQuantity(entries, 5)]);
  });
});
