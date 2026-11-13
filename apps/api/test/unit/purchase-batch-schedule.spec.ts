import {
  latestSlotAtOrBefore, nextSlotAfter, slotKeyOf, validateSchedule, zonedTimeToUtc,
} from '../../src/modules/sourcing/services/purchase-batch-schedule';

const cairo = (intervalMinutes: number, startTime = '09:00') => ({ intervalMinutes, startTime, timeZone: 'Africa/Cairo' });
const iso = (value: Date) => value.toISOString();

describe('purchase batch schedule', () => {
  it('converts a Cairo wall clock to the right UTC instant on both sides of the daylight-saving change', () => {
    // Egypt: UTC+2 in winter, UTC+3 in summer.
    expect(iso(new Date(zonedTimeToUtc(2026, 1, 15, 9, 0, 'Africa/Cairo')))).toBe('2026-01-15T07:00:00.000Z');
    expect(iso(new Date(zonedTimeToUtc(2026, 7, 15, 9, 0, 'Africa/Cairo')))).toBe('2026-07-15T06:00:00.000Z');
  });

  it('cuts every 180 minutes from the start time (default policy)', () => {
    const settings = cairo(180);
    // 2026-11-14 is winter time: 09:00 Cairo = 07:00Z; slots 09,12,15,18,21,00,03,06 local.
    expect(iso(latestSlotAtOrBefore(new Date('2026-11-14T10:30:00Z'), settings))).toBe('2026-11-14T10:00:00.000Z'); // 12:30 local → 12:00 local
    expect(iso(nextSlotAfter(new Date('2026-11-14T10:30:00Z'), settings))).toBe('2026-11-14T13:00:00.000Z'); // 15:00 local
    // Exactly on a cutoff the batch of that cutoff is due, the next one is a full interval away.
    expect(iso(latestSlotAtOrBefore(new Date('2026-11-14T13:00:00Z'), settings))).toBe('2026-11-14T13:00:00.000Z');
    expect(iso(nextSlotAfter(new Date('2026-11-14T13:00:00Z'), settings))).toBe('2026-11-14T16:00:00.000Z');
  });

  it('keeps the previous day\'s window open until the new day starts, then restarts at the start time', () => {
    const settings = cairo(180);
    // 07:00 local (05:00Z) is before the 09:00 start: the latest cutoff is the previous window's 06:00 local one.
    expect(iso(latestSlotAtOrBefore(new Date('2026-11-14T05:00:00Z'), settings))).toBe('2026-11-14T04:00:00.000Z');
    expect(iso(nextSlotAfter(new Date('2026-11-14T05:00:00Z'), settings))).toBe('2026-11-14T07:00:00.000Z'); // 09:00 local
  });

  it('is deterministic: the same instant always names the same slot, whatever the call order', () => {
    const settings = cairo(60, '08:30');
    const now = new Date('2026-11-14T12:10:00Z');
    expect(slotKeyOf(latestSlotAtOrBefore(now, settings))).toBe(slotKeyOf(latestSlotAtOrBefore(new Date(now.getTime() + 10 * 60_000), settings)));
  });

  it('rejects schedules the batches cannot run on', () => {
    expect(validateSchedule(cairo(180))).toEqual([]);
    expect(validateSchedule(cairo(5))).toHaveLength(1);
    expect(validateSchedule(cairo(1500))).toHaveLength(1);
    expect(validateSchedule({ ...cairo(180), startTime: '9:00' })).toHaveLength(1);
    expect(validateSchedule({ ...cairo(180), startTime: '24:00' })).toHaveLength(1);
    expect(validateSchedule({ ...cairo(180), timeZone: 'Mars/Olympus' })).toHaveLength(1);
    expect(validateSchedule({ intervalMinutes: 90.5, startTime: '09:00', timeZone: 'UTC' })).toHaveLength(1);
  });
});
