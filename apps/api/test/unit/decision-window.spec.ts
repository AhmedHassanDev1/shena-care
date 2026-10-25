import { decisionDeadline, decisionWindowHours } from '../../src/modules/ordering/services/decision-window';

// January: Cairo is UTC+2, so 08:00 Cairo is 06:00Z and 23:00 Cairo is 21:00Z.
describe('customer decision window (12 waking hours, night excluded)', () => {
  const at = (iso: string) => new Date(iso);

  it('counts straight through the day', () => {
    expect(decisionDeadline(at('2027-01-10T06:00:00Z'), 12).toISOString()).toBe('2027-01-10T18:00:00.000Z'); // 08:00 → 20:00 Cairo
  });

  it('does not count the night: started at 22:00 it ends at 19:00 the next day', () => {
    expect(decisionDeadline(at('2027-01-10T20:00:00Z'), 12).toISOString()).toBe('2027-01-11T17:00:00.000Z');
  });

  it('starts counting at 08:00 when the decision opens during the night', () => {
    expect(decisionDeadline(at('2027-01-10T23:30:00Z'), 12).toISOString()).toBe('2027-01-11T18:00:00.000Z'); // 01:30 → 20:00 Cairo
  });

  it('reads the window from configuration and ignores nonsense', () => {
    expect(decisionWindowHours(undefined)).toBe(12);
    expect(decisionWindowHours('6')).toBe(6);
    for (const bad of ['', '0', '-3', 'abc', '500']) expect(decisionWindowHours(bad)).toBe(12);
  });
});
