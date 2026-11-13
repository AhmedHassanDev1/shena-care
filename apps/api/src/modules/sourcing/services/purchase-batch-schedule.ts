/**
 * Cutoff schedule of the purchase batches. Pure functions (no clock, no database): every local day starts at `startTime` in `timeZone`
 * and cuts every `intervalMinutes` after it, for as long as the slot is still inside that 24-hour window; the next day starts over at
 * `startTime`. A slot is identified by its UTC instant, so one cutoff can only ever produce one batch, whatever the settings were
 * when it was computed.
 */

export interface ScheduleSettings { intervalMinutes: number; startTime: string; timeZone: string }

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 1440;
export const DEFAULT_SCHEDULE: ScheduleSettings = { intervalMinutes: 180, startTime: '09:00', timeZone: 'Africa/Cairo' };

const MINUTE = 60_000;
const START_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(timeZone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone }); return timeZone.length > 0 && timeZone.length <= 64; } catch { return false; }
}

/** Returns the reasons a schedule is not acceptable (empty when it is). */
export function validateSchedule(input: ScheduleSettings): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < MIN_INTERVAL_MINUTES || input.intervalMinutes > MAX_INTERVAL_MINUTES) {
    problems.push(`The interval must be a whole number of minutes between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}`);
  }
  if (!START_TIME.test(input.startTime)) problems.push('The start time must look like 09:00 (24-hour HH:mm)');
  if (!isValidTimeZone(input.timeZone)) problems.push('The time zone is not a valid IANA zone (for example Africa/Cairo)');
  return problems;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (positive east of Greenwich). */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(instant / 1000) * 1000;
}

/** The UTC instant at which the wall clock of `timeZone` reads year-month-day hour:minute. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - offsetMs(wall, timeZone);
  guess = wall - offsetMs(guess, timeZone); // second pass settles the instants around a daylight-saving change
  return guess;
}

/** Local calendar date (in `timeZone`) of an instant. */
function localDate(instant: number, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function dayStart(instant: number, dayShift: number, settings: ScheduleSettings): number {
  const { year, month, day } = localDate(instant, settings.timeZone);
  const [hour, minute] = settings.startTime.split(':').map(Number);
  // Date.UTC normalises day overflow/underflow, which is exactly the calendar arithmetic needed for the neighbouring local day.
  const shifted = new Date(Date.UTC(year, month - 1, day + dayShift));
  return zonedTimeToUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), hour, minute, settings.timeZone);
}

/** Every cutoff of the local days around `instant`, ascending. */
function slotsAround(instant: number, settings: ScheduleSettings): number[] {
  const step = settings.intervalMinutes * MINUTE;
  const perDay = Math.floor((1440 - 1) / settings.intervalMinutes) + 1;
  const slots: number[] = [];
  for (const shift of [-1, 0, 1]) {
    const start = dayStart(instant, shift, settings);
    for (let k = 0; k < perDay; k++) slots.push(start + k * step);
  }
  return slots.sort((a, b) => a - b);
}

/** The most recent cutoff at or before `now` (the one whose batch must exist by now). */
export function latestSlotAtOrBefore(now: Date, settings: ScheduleSettings): Date {
  const at = now.getTime();
  const slots = slotsAround(at, settings).filter(slot => slot <= at);
  return new Date(slots[slots.length - 1]);
}

/** The first cutoff strictly after `now`. */
export function nextSlotAfter(now: Date, settings: ScheduleSettings): Date {
  const at = now.getTime();
  return new Date(slotsAround(at, settings).find(slot => slot > at)!);
}

export const slotKeyOf = (cutoff: Date) => `slot:${cutoff.toISOString()}`;
