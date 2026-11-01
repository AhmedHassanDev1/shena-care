import { lossShares } from '../../src/modules/ordering/public';

describe('who bears the loss of a return (owner decision 2026-10-25)', () => {
  it('follows the cause', () => {
    expect(lossShares('SUPPLIER')).toEqual({ supplier: 100, hub: 0, shinacare: 0 });
    expect(lossShares('HUB')).toEqual({ supplier: 0, hub: 100, shinacare: 0 });
    expect(lossShares('APP')).toEqual({ supplier: 0, hub: 0, shinacare: 100 });
  });

  it('splits a general problem between ShinaCare and the hub', () => {
    expect(lossShares('GENERAL')).toEqual({ supplier: 0, hub: 50, shinacare: 50 });
  });

  it('means nobody loses when the goods are sealed and go back to the supplier', () => {
    expect(lossShares('NONE')).toBeNull();
  });

  it('takes explicit shares for several at fault, which must add up to 100', () => {
    expect(lossShares('SPLIT', { supplier: 60, hub: 40, shinacare: 0 })).toEqual({ supplier: 60, hub: 40, shinacare: 0 });
    expect(() => lossShares('SPLIT', { supplier: 60, hub: 30 })).toThrow(RangeError);
    expect(() => lossShares('SPLIT', { supplier: 50.5, hub: 49.5 })).toThrow(RangeError);
    expect(() => lossShares('SPLIT')).toThrow(RangeError);
  });
});
