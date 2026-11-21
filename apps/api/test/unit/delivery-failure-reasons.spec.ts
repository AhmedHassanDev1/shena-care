import 'reflect-metadata';
import { DELIVERY_FAILURE_REASONS } from '../../src/modules/fulfillment/dto/fulfillment.dto';

// The codes the courier app (apps/business/lib/labels.ts FAILURE_REASONS) offers in the failed-delivery sheet.
// A code missing here makes the API answer 400 and the courier sees an error instead of the failed attempt being recorded.
const COURIER_APP_REASONS = [
  'CUSTOMER_UNREACHABLE', 'CUSTOMER_NOT_FOUND', 'ITEM_MISMATCH', 'WRONG_ITEM', 'CUSTOMER_REFUSED', 'ADDRESS_NOT_FOUND',
  'RESCHEDULE_REQUESTED', 'PIN_MISMATCH', 'NOT_SERVICEABLE', 'PACKAGE_DAMAGED', 'OTHER',
];

describe('delivery failure reasons', () => {
  it('accepts every reason the courier app offers', () => {
    expect(COURIER_APP_REASONS.filter(code => !(DELIVERY_FAILURE_REASONS as readonly string[]).includes(code))).toEqual([]);
  });
  it('still rejects unknown codes', () => {
    expect((DELIVERY_FAILURE_REASONS as readonly string[]).includes('TELEPORTED')).toBe(false);
  });
});
