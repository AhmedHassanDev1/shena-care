import { inCourierCustody } from '../../src/modules/ordering/services/order-tracking.service';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 10, minute));
const ev = (type: string, minute: number) => ({ type, createdAt: at(minute) }) as never;
const shipment = (status: string, events: Array<[string, number]>) =>
  ({ status, events: events.map(([type, minute]) => ev(type, minute)) }) as never;

describe('customer sees "with the courier" once the label is scanned', () => {
  it('flips when the courier scanned a packed parcel', () => {
    expect(inCourierCustody({ status: 'packing' } as never, shipment('packed', [['PACKED', 1], ['HANDOFF_SCANNED', 5]]))).toBe(true);
  });
  it('stays "preparing" before any scan', () => {
    expect(inCourierCustody({ status: 'packing' } as never, shipment('packed', [['PACKED', 1]]))).toBe(false);
  });
  it('ignores a scan from before the parcel was packed again', () => {
    expect(inCourierCustody({ status: 'packing' } as never, shipment('packed', [['HANDOFF_SCANNED', 2], ['PACKED', 6]]))).toBe(false);
  });
  it('a parcel back at the hub after a failed attempt (order already shipped) is not a fresh handoff', () => {
    expect(inCourierCustody({ status: 'shipped' } as never, shipment('packed', [['PACKED', 1], ['HANDOFF_SCANNED', 5]]))).toBe(false);
  });
  it('only applies to packed parcels', () => {
    expect(inCourierCustody({ status: 'packing' } as never, shipment('out_for_delivery', [['PACKED', 1], ['HANDOFF_SCANNED', 5]]))).toBe(false);
  });
});
