/**
 * Supplier working schedule (owner decision 2026-10-25). Warehouses are closed on Friday unless the owner says
 * otherwise; hours are optional and, when empty, mean "open all day". All times are Cairo local time.
 */
export const SCHEDULE_TIME_ZONE = 'Africa/Cairo';
export const DEFAULT_CLOSED_WEEKDAYS = [5]; // 0 = Sunday … 6 = Saturday; 5 = Friday

export interface SupplierSchedule {
  closedWeekdays: number[];
  /** "HH:MM", both or neither. */
  opensAt?: string | null;
  closesAt?: string | null;
}

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHEDULE_TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

function local(at: Date) {
  const get = Object.fromEntries(parts.formatToParts(at).map(p => [p.type, p.value]));
  const date = `${get.year}-${get.month}-${get.day}`;
  return { date, minutes: Number(get.hour) * 60 + Number(get.minute) };
}

const weekdayOf = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();
const addDays = (date: string, days: number) => new Date(new Date(date + 'T00:00:00Z').getTime() + days * 86_400_000).toISOString().slice(0, 10);
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Cairo calendar date (YYYY-MM-DD) of an instant. */
export const cairoDate = (at: Date) => local(at).date;

/** The UTC instant of a Cairo wall-clock time (handles Egypt's summer time). */
export function cairoWallTime(date: string, minutes = 0): Date {
  const guess = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60_000;
  for (const offsetHours of [2, 3]) {
    const candidate = new Date(guess - offsetHours * 3_600_000);
    const seen = local(candidate);
    if (seen.date === date && seen.minutes === minutes) return candidate;
  }
  return new Date(guess - 2 * 3_600_000);
}

const isOpenDay = (date: string, schedule: SupplierSchedule) => !schedule.closedWeekdays.includes(weekdayOf(date));

/** First day strictly after `orderedAt` (Cairo) on which a supplier with this schedule is open. */
export function firstOpenDayAfter(orderedAt: Date, closedWeekdays: number[]): string {
  const today = cairoDate(orderedAt);
  for (let ahead = 1; ahead <= 14; ahead++) {
    const day = addDays(today, ahead);
    if (!closedWeekdays.includes(weekdayOf(day))) return day;
  }
  return addDays(today, 1); // a supplier closed every day cannot define a date
}

/**
 * The delivery date to promise: each item can come from any of its suppliers, so it is ready on the earliest day one
 * of them opens; the order, delivered in one parcel, follows its slowest item. Items without a supplier use the
 * default Friday closure.
 */
export function promisedDate(orderedAt: Date, closedWeekdaysPerItem: number[][][]): string {
  const perItem = closedWeekdaysPerItem.map(suppliers => {
    const options = (suppliers.length ? suppliers : [DEFAULT_CLOSED_WEEKDAYS]).map(closed => firstOpenDayAfter(orderedAt, closed));
    return options.sort()[0];
  });
  return (perItem.length ? perItem : [firstOpenDayAfter(orderedAt, DEFAULT_CLOSED_WEEKDAYS)]).sort().reverse()[0];
}

/**
 * When the response clock of a purchase order sent at `at` starts: now if the supplier is open, otherwise its next
 * opening — so nothing sent on a Friday or at night looks late before the supplier could even see it.
 */
export function nextOpening(at: Date, schedule: SupplierSchedule): Date {
  const now = local(at);
  const opens = schedule.opensAt ? toMinutes(schedule.opensAt) : 0;
  const closes = schedule.closesAt ? toMinutes(schedule.closesAt) : 24 * 60;
  if (isOpenDay(now.date, schedule) && now.minutes >= opens && now.minutes < closes) return at;
  if (isOpenDay(now.date, schedule) && now.minutes < opens) return cairoWallTime(now.date, opens);
  for (let ahead = 1; ahead <= 14; ahead++) {
    const day = addDays(now.date, ahead);
    if (isOpenDay(day, schedule)) return cairoWallTime(day, opens);
  }
  return at;
}
