import { BadRequestException } from '@nestjs/common';

/** Finance reports use Cairo calendar days: a day runs from Cairo midnight to the next Cairo midnight (daylight saving included). */
const TZ = 'Africa/Cairo';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_REPORT_DAYS = 366;

/** Cairo's offset from UTC (ms) at an instant. */
function offsetMs(at: Date): number {
  const p = Object.fromEntries(partsFormat.formatToParts(at).map(part => [part.type, Number(part.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a Cairo calendar day starts. */
export function cairoDayStartUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const first = wall - offsetMs(new Date(wall));
  return new Date(wall - offsetMs(new Date(first)));
}

export const cairoYmd = (at: Date): string => dayFormat.format(at);

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const ms = (value: string) => { const [y, m, d] = value.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export interface ReportRange { from: string; to: string; start: Date; end: Date; days: number }

/** `from` and `to` are inclusive Cairo dates; the default is the last 30 days ending today. */
export function resolveRange(from?: string, to?: string, now = new Date()): ReportRange {
  const today = cairoYmd(now);
  const resolvedTo = to ?? today;
  const resolvedFrom = from ?? addDays(resolvedTo, -29);
  for (const value of [resolvedFrom, resolvedTo]) {
    if (!YMD.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
      throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'Dates must be real calendar dates as YYYY-MM-DD.' });
    }
  }
  if (resolvedTo < resolvedFrom) throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'The end date is before the start date.' });
  const days = daysBetween(resolvedFrom, resolvedTo) + 1;
  if (days > MAX_REPORT_DAYS) throw new BadRequestException({ code: 'DATE_RANGE_TOO_LONG', message: `Choose at most ${MAX_REPORT_DAYS} days.` });
  return { from: resolvedFrom, to: resolvedTo, start: cairoDayStartUtc(resolvedFrom), end: cairoDayStartUtc(addDays(resolvedTo, 1)), days };
}
