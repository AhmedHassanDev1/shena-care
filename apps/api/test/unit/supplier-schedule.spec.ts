import { cairoDate, cairoWallTime, firstOpenDayAfter, nextOpening, promisedDate } from '../../src/modules/sourcing/services/supplier-schedule';

// January 2027: Cairo is UTC+2. 2027-01-10 is a Sunday; 2027-01-14 Thursday; 2027-01-15 Friday; 2027-01-16 Saturday.
const at = (iso: string) => new Date(iso);
const FRIDAY = [5];

describe('supplier schedule and the promised delivery date', () => {
  it('promises the next day on an ordinary day', () => {
    expect(firstOpenDayAfter(at('2027-01-10T10:00:00Z'), FRIDAY)).toBe('2027-01-11'); // Sunday → Monday
    expect(firstOpenDayAfter(at('2027-01-13T10:00:00Z'), FRIDAY)).toBe('2027-01-14'); // Wednesday → Thursday
  });

  it('sends Thursday and Friday orders to Saturday', () => {
    expect(firstOpenDayAfter(at('2027-01-14T10:00:00Z'), FRIDAY)).toBe('2027-01-16'); // Thursday → Saturday
    expect(firstOpenDayAfter(at('2027-01-15T10:00:00Z'), FRIDAY)).toBe('2027-01-16'); // Friday → Saturday
  });

  it('uses the Cairo calendar day, not the UTC day', () => {
    expect(cairoDate(at('2027-01-14T22:30:00Z'))).toBe('2027-01-15'); // 00:30 Friday in Cairo
    expect(firstOpenDayAfter(at('2027-01-14T22:30:00Z'), FRIDAY)).toBe('2027-01-16');
  });

  it('follows the slowest item, and the fastest supplier of each item', () => {
    const thursday = at('2027-01-13T10:00:00Z'); // Wednesday
    // item 1 only from a Friday-closed supplier (Thursday); item 2 also from a supplier closed Thursday and Friday.
    expect(promisedDate(thursday, [[FRIDAY], [[4, 5], FRIDAY]])).toBe('2027-01-14');
    // item 2 only from a supplier closed Thursday: Saturday?  Thursday closed → Friday is open for it.
    expect(promisedDate(thursday, [[FRIDAY], [[4]]])).toBe('2027-01-15');
    // a Friday-closed supplier and a Friday+Thursday-closed one are both needed (single supplier each).
    expect(promisedDate(thursday, [[FRIDAY], [[4, 5]]])).toBe('2027-01-16');
    expect(promisedDate(thursday, [])).toBe('2027-01-14');
  });

  it('starts the supplier response clock at its next opening', () => {
    const schedule = { closedWeekdays: FRIDAY, opensAt: '09:00', closesAt: '21:00' };
    expect(nextOpening(at('2027-01-13T12:00:00Z'), schedule).toISOString()).toBe('2027-01-13T12:00:00.000Z'); // open (14:00 Cairo)
    expect(nextOpening(at('2027-01-13T19:30:00Z'), schedule).toISOString()).toBe('2027-01-14T07:00:00.000Z'); // after closing → 09:00 next day
    expect(nextOpening(at('2027-01-13T04:00:00Z'), schedule).toISOString()).toBe('2027-01-13T07:00:00.000Z'); // before opening
    expect(nextOpening(at('2027-01-14T19:30:00Z'), schedule).toISOString()).toBe('2027-01-16T07:00:00.000Z'); // Thursday evening → Saturday 09:00
    expect(nextOpening(at('2027-01-15T10:00:00Z'), { closedWeekdays: FRIDAY }).toISOString()).toBe('2027-01-15T22:00:00.000Z'); // Friday, all-day hours → Saturday 00:00 Cairo
  });

  it('converts Cairo wall time across summer time', () => {
    expect(cairoWallTime('2027-01-10', 9 * 60).toISOString()).toBe('2027-01-10T07:00:00.000Z'); // UTC+2
    expect(cairoWallTime('2027-07-10', 9 * 60).toISOString()).toBe('2027-07-10T06:00:00.000Z'); // UTC+3
  });
});
