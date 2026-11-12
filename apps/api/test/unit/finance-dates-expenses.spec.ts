import { addDays, cairoDayStartUtc, cairoYmd, resolveRange } from '../../src/application/composition/services/finance-dates';
import { expenseOccurrences, isValidYmd } from '../../src/modules/operations/services/finance-expense.service';

describe('Finance reporting dates', () => {
  it('starts a Cairo day at local midnight, across the daylight-saving change', () => {
    expect(cairoDayStartUtc('2026-01-10').toISOString()).toBe('2026-01-09T22:00:00.000Z'); // UTC+2
    expect(cairoDayStartUtc('2026-07-10').toISOString()).toBe('2026-07-09T21:00:00.000Z'); // UTC+3
  });

  it('labels an instant with its Cairo calendar day', () => {
    expect(cairoYmd(new Date('2031-03-14T22:30:00Z'))).toBe('2031-03-15');
    expect(cairoYmd(new Date('2031-03-15T21:30:00Z'))).toBe('2031-03-15');
    expect(cairoYmd(new Date('2031-03-15T22:00:00Z'))).toBe('2031-03-16');
  });

  it('defaults to the last 30 days and rejects impossible, reversed or oversized ranges', () => {
    const range = resolveRange(undefined, undefined, new Date('2031-03-15T10:00:00Z'));
    expect(range).toMatchObject({ from: '2031-02-14', to: '2031-03-15', days: 30 });
    expect(range.end.getTime() - range.start.getTime()).toBe(30 * 86_400_000);
    expect(() => resolveRange('2031-02-30', '2031-03-15')).toThrow();
    expect(() => resolveRange('2031-03-16', '2031-03-15')).toThrow();
    expect(() => resolveRange('2029-01-01', '2031-03-15')).toThrow();
    expect(addDays('2031-12-31', 1)).toBe('2032-01-01');
  });
});

describe('Expense occurrences', () => {
  it('counts a one-off expense only inside the range', () => {
    const expense = { incurredOn: '2031-03-10', recurrence: 'NONE' as const };
    expect(expenseOccurrences(expense, '2031-03-01', '2031-03-31')).toEqual(['2031-03-10']);
    expect(expenseOccurrences(expense, '2031-03-11', '2031-03-31')).toEqual([]);
    expect(expenseOccurrences(expense, '2031-02-01', '2031-03-09')).toEqual([]);
  });

  it('repeats a monthly expense on its day, using the last day of shorter months', () => {
    const expense = { incurredOn: '2031-01-31', recurrence: 'MONTHLY' as const };
    expect(expenseOccurrences(expense, '2031-01-01', '2031-04-30')).toEqual(['2031-01-31', '2031-02-28', '2031-03-31', '2031-04-30']);
    expect(expenseOccurrences(expense, '2031-02-15', '2031-03-15')).toEqual(['2031-02-28']);
  });

  it('stops a recurring expense at its end date and never before its start', () => {
    const expense = { incurredOn: '2031-02-10', recurrence: 'MONTHLY' as const, endsOn: '2031-04-09' };
    expect(expenseOccurrences(expense, '2031-01-01', '2031-12-31')).toEqual(['2031-02-10', '2031-03-10']);
    expect(expenseOccurrences(expense, '2030-01-01', '2031-02-09')).toEqual([]);
  });

  it('repeats a weekly expense every seven days from its first date', () => {
    const expense = { incurredOn: '2031-03-01', recurrence: 'WEEKLY' as const };
    expect(expenseOccurrences(expense, '2031-03-10', '2031-03-31')).toEqual(['2031-03-15', '2031-03-22', '2031-03-29']);
  });

  it('validates real calendar dates', () => {
    expect(isValidYmd('2032-02-29')).toBe(true);
    expect(isValidYmd('2031-02-29')).toBe(false);
    expect(isValidYmd('2031-13-01')).toBe(false);
    expect(isValidYmd('31-01-2031')).toBe(false);
  });
});
