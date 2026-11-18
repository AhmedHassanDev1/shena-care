import { Prisma } from '@prisma/client';
import { derivePrintState } from '../../src/modules/fulfillment/services/print-state';
import { isValidGtin } from '../../src/modules/fulfillment/services/barcode-format';
import { evaluateOrderProfit, orderPurchaseCost } from '../../src/application/composition/services/order-profitability';

const at = (second: number) => new Date(Date.UTC(2026, 10, 18, 10, 0, second));
const event = (type: string, second: number, reasonCode?: string, notes?: string) => ({ type, createdAt: at(second), reasonCode: reasonCode ?? null, notes: notes ?? null });

describe('print state of a shipment', () => {
  it('is pending until both papers are confirmed, and a label cannot count before it exists', () => {
    expect(derivePrintState([])).toMatchObject({ receipt: 'pending', label: 'pending', labelGenerated: false, ready: false });
    expect(derivePrintState([event('LABEL_GENERATED', 1), event('RECEIPT_PRINTED', 2)])).toMatchObject({ receipt: 'printed', label: 'pending', labelGenerated: true, ready: false });
    expect(derivePrintState([event('LABEL_GENERATED', 1), event('RECEIPT_PRINTED', 2), event('LABEL_PRINTED', 3)]).ready).toBe(true);
  });

  it('lets the latest outcome of each document win, so a later failure reopens a printed document', () => {
    const printed = [event('LABEL_GENERATED', 1), event('RECEIPT_PRINTED', 2), event('LABEL_PRINTED', 3)];
    const failedLabel = derivePrintState([...printed, event('PRINT_FAILED', 4, 'LABEL', 'ink ran out')]);
    expect(failedLabel).toMatchObject({ receipt: 'printed', label: 'failed', ready: false, lastFailure: { document: 'LABEL', note: 'ink ran out' } });
    const reprinted = derivePrintState([...printed, event('PRINT_FAILED', 4, 'LABEL', 'ink ran out'), event('LABEL_PRINTED', 5)]);
    expect(reprinted).toMatchObject({ label: 'printed', ready: true, lastFailure: null });
  });

  it('treats a failure with no document as both papers failing, and ignores event order in the input', () => {
    const both = derivePrintState([event('PRINT_FAILED', 4, undefined, 'jam'), event('LABEL_GENERATED', 1), event('RECEIPT_PRINTED', 2), event('LABEL_PRINTED', 3)]);
    expect(both).toMatchObject({ receipt: 'failed', label: 'failed', ready: false, lastFailure: { document: 'BOTH' } });
    const receiptOnly = derivePrintState([event('LABEL_GENERATED', 1), event('LABEL_PRINTED', 2), event('PRINT_FAILED', 3, 'RECEIPT', 'smudged')]);
    expect(receiptOnly).toMatchObject({ receipt: 'failed', label: 'printed', ready: false });
  });
});

describe('retail barcode check', () => {
  it('accepts valid GTIN-8/12/13/14 and refuses mistyped, short, long or non-numeric codes', () => {
    expect(isValidGtin('6223000010018')).toBe(false); // check digit does not match
    expect(isValidGtin('4006381333931')).toBe(true); // EAN-13
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('40063813339')).toBe(false); // 11 digits
    expect(isValidGtin('ABC40063813339')).toBe(false);
    expect(isValidGtin('')).toBe(false);
  });
});

describe('order profitability', () => {
  const base = { goodsNet: 10000, customerDeliveryFee: 5000 };

  it('is a profit only when every cost is recorded and revenue exceeds them', () => {
    expect(evaluateOrderProfit({ ...base, cogs: 4000, packaging: 500, courier: 5000 })).toMatchObject({ state: 'PROFIT', complete: true, marginSoFar: 5500, missing: [] });
    // The courier cost beyond what the customer paid is the company's cost; below it, nothing.
    expect(evaluateOrderProfit({ ...base, cogs: 4000, packaging: 500, courier: 8000 }).marginSoFar).toBe(2500);
    expect(evaluateOrderProfit({ ...base, cogs: 4000, packaging: 500, courier: 1000 }).marginSoFar).toBe(5500);
  });

  it('is a loss as soon as the recorded costs exceed the goods sold, even with costs still missing', () => {
    expect(evaluateOrderProfit({ ...base, cogs: 15000, packaging: 500, courier: null })).toMatchObject({ state: 'LOSS', marginSoFar: -5500, complete: false, missing: ['COURIER_COST'] });
    expect(evaluateOrderProfit({ ...base, cogs: 10000, packaging: 500, courier: 5000 }).state).toBe('LOSS');
  });

  it('never calls an order fine while a cost is missing, and a break-even order is not a loss', () => {
    expect(evaluateOrderProfit({ ...base, cogs: 4000, packaging: null, courier: null })).toMatchObject({ state: 'PENDING_COSTS', missing: ['PACKAGING_COST', 'COURIER_COST'] });
    expect(evaluateOrderProfit({ ...base, cogs: null, packaging: 500, courier: 5000 })).toMatchObject({ state: 'PENDING_COSTS', missing: ['PURCHASE_COST'] });
    expect(evaluateOrderProfit({ ...base, cogs: 9500, packaging: 500, courier: 5000 })).toMatchObject({ state: 'PROFIT', marginSoFar: 0 });
  });
});

describe('order purchase cost', () => {
  const lines = [{ id: 'a', quantity: 2 }, { id: 'b', quantity: 1 }];
  const dec = (value: number) => new Prisma.Decimal(value);

  it('sums fully costed lines and is unknown when any unit is uncosted or not bought', () => {
    const costed = new Map([['a', { units: 2, costedUnits: 2, cost: dec(60) }], ['b', { units: 1, costedUnits: 1, cost: dec(10) }]]);
    expect(orderPurchaseCost(lines, costed, undefined)?.toNumber()).toBe(70);
    const partial = new Map([['a', { units: 2, costedUnits: 1, cost: dec(30) }], ['b', { units: 1, costedUnits: 1, cost: dec(10) }]]);
    expect(orderPurchaseCost(lines, partial, undefined)).toBeNull();
    expect(orderPurchaseCost(lines, new Map([['a', { units: 2, costedUnits: 2, cost: dec(60) }]]), undefined)).toBeNull();
  });

  it('falls back to complete supplier invoice costs only when the Buy List costs are not complete', () => {
    expect(orderPurchaseCost(lines, new Map(), { complete: true, actualCogs: '42.50' })?.toNumber()).toBe(42.5);
    expect(orderPurchaseCost(lines, new Map(), { complete: false, actualCogs: null })).toBeNull();
  });
});
