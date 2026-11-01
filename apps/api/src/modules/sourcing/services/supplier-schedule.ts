import {
  DEFAULT_DISPATCH_CHECKPOINTS,
  DEFAULT_SCHEDULE_TIME_ZONE,
  getProcurementBatchConfig,
} from '../config/procurement-batch.config';

/**
 * Supplier working schedule (owner decision 2026-10-25, updated GLO-283).
 * Approved default supplier operating window: 09:00–01:00 the following day in local timezone.
 * Warehouses are closed on Friday unless specified otherwise.
 * Normal dispatch checkpoints: 09:00, 12:00, 15:00, 18:00, 21:00, 00:00.
 */
export const SCHEDULE_TIME_ZONE = DEFAULT_SCHEDULE_TIME_ZONE;
export const DEFAULT_CLOSED_WEEKDAYS = [5]; // 0 = Sunday … 6 = Saturday; 5 = Friday

export interface SupplierSchedule {
  closedWeekdays: number[];
  /** "HH:MM", both or neither. Defaults to 09:00–01:00 (crosses midnight) when empty. */
  opensAt?: string | null;
  closesAt?: string | null;
  /** Explicit closure dates "YYYY-MM-DD" (holidays, special closures). */
  closedDates?: string[] | null;
}

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHEDULE_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function local(at: Date, timeZone = SCHEDULE_TIME_ZONE) {
  const formatter = timeZone === SCHEDULE_TIME_ZONE ? parts : new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const get = Object.fromEntries(formatter.formatToParts(at).map(p => [p.type, p.value]));
  const date = `${get.year}-${get.month}-${get.day}`;
  return { date, minutes: Number(get.hour) * 60 + Number(get.minute) };
}

export const weekdayOf = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();
export const addDays = (date: string, days: number) => new Date(new Date(date + 'T00:00:00Z').getTime() + days * 86_400_000).toISOString().slice(0, 10);
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Cairo calendar date (YYYY-MM-DD) of an instant. */
export const cairoDate = (at: Date) => local(at).date;

/** UTC instant for a calendar wall time in the configured IANA zone. */
export function wallTime(date: string, minutes = 0, timeZone = SCHEDULE_TIME_ZONE): Date {
  const wanted = new Date(date + 'T00:00:00Z').getTime() + minutes * 60_000;
  let candidate = wanted;
  for (let attempt = 0; attempt < 4; attempt++) {
    const seen = local(new Date(candidate), timeZone);
    const observed = new Date(seen.date + 'T00:00:00Z').getTime() + seen.minutes * 60_000;
    if (observed === wanted) return new Date(candidate);
    candidate += wanted - observed;
  }
  throw new Error('Supplier wall time does not exist in configured timezone');
}

/** Cairo calendar conversion retained for customer delivery-date contracts. */
export const cairoWallTime = (date: string, minutes = 0): Date => wallTime(date, minutes, SCHEDULE_TIME_ZONE);

export const isOpenDay = (date: string, schedule: SupplierSchedule) => {
  if (schedule.closedWeekdays && schedule.closedWeekdays.includes(weekdayOf(date))) return false;
  if (schedule.closedDates && schedule.closedDates.includes(date)) return false;
  return true;
};

/**
 * Checks if a supplier is currently operating and able to receive orders.
 * Handles both standard same-day hours and midnight-crossing hours (e.g. 09:00 to 01:00 next day).
 */
export function isSupplierOperating(at: Date, schedule: SupplierSchedule, timeZone = getProcurementBatchConfig().timeZone): boolean {
  const opensAt = schedule.opensAt ?? getProcurementBatchConfig().defaultOpensAt;
  const closesAt = schedule.closesAt ?? getProcurementBatchConfig().defaultClosesAt;

  const now = local(at, timeZone);
  const opens = toMinutes(opensAt);
  const closes = toMinutes(closesAt);

  if (opens === closes) {
    return isOpenDay(now.date, schedule);
  }

  if (opens < closes) {
    // Normal same-day window (e.g. 08:00 to 17:00)
    if (!isOpenDay(now.date, schedule)) return false;
    return now.minutes >= opens && now.minutes < closes;
  }

  // Midnight-crossing window (e.g. 09:00 to 01:00 following day)
  // 1. Started today at `opens` and runs through midnight:
  if (isOpenDay(now.date, schedule) && now.minutes >= opens) {
    return true;
  }

  // 2. Started yesterday at `opens` and runs until `closes` today:
  const yesterday = addDays(now.date, -1);
  if (isOpenDay(yesterday, schedule) && now.minutes < closes) {
    return true;
  }

  return false;
}

/** Convenience check for whether the supplier can receive a purchase order at timestamp `at`. */
export function supplierResponseDeadline(issuedAt: Date, schedule: SupplierSchedule, workingMinutes: number, timeZone = getProcurementBatchConfig().timeZone): Date {
  if (!Number.isSafeInteger(workingMinutes) || workingMinutes <= 0) throw new Error('Invalid supplier response duration');
  const opens = toMinutes(schedule.opensAt ?? getProcurementBatchConfig().defaultOpensAt);
  const closes = toMinutes(schedule.closesAt ?? getProcurementBatchConfig().defaultClosesAt);
  let remaining = workingMinutes * 60_000;
  const firstDay = addDays(local(issuedAt, timeZone).date, -1);
  // Intersect whole working windows, rather than walking every minute or counting closed time.
  for (let dayOffset = 0; dayOffset < 370; dayOffset++) {
    const day = addDays(firstDay, dayOffset);
    if (!isOpenDay(day, schedule)) continue;
    const start = wallTime(day, opens, timeZone).getTime();
    const end = wallTime(closes <= opens ? addDays(day, 1) : day, closes, timeZone).getTime();
    const availableFrom = Math.max(start, issuedAt.getTime());
    if (end <= availableFrom) continue;
    if (end - availableFrom >= remaining) return new Date(availableFrom + remaining);
    remaining -= end - availableFrom;
  }
  throw new Error('No supplier response window within one year');
}

export function canSupplierReceiveOrder(at: Date, schedule: SupplierSchedule, timeZone = getProcurementBatchConfig().timeZone): boolean {
  return isSupplierOperating(at, schedule, timeZone);
}

/**
 * Checks whether an allocation is eligible for dispatch in a scheduled batch run.
 * Rules:
 * 1. Supplier must be operating at batchRunAt.
 * 2. Orders arriving after 00:00 and before 01:00 wait for the next eligible batch (09:00),
 *    unless an authorized early flush occurs.
 * 3. Allocation selectedAt must be <= batchRunAt.
 */
export function isEligibleForScheduledBatch(
  allocationSelectedAt: Date,
  batchRunAt: Date,
  schedule: SupplierSchedule,
  timeZone = getProcurementBatchConfig().timeZone,
): boolean {
  if (!isSupplierOperating(batchRunAt, schedule, timeZone)) {
    return false;
  }

  const allocLocal = local(allocationSelectedAt, timeZone);
  const runLocal = local(batchRunAt, timeZone);

  // If order was selected between 00:00 and 01:00 (0 <= minutes < 60)
  // and the scheduled batch is running during that same night before 09:00:
  if (allocLocal.minutes >= 0 && allocLocal.minutes < 60 && runLocal.minutes < 9 * 60 && allocLocal.date === runLocal.date) {
    return false;
  }

  // Use the latest elapsed checkpoint so a delayed/restarted worker can catch up,
  // while demand arriving after that cutoff stays in the next consolidated batch.
  const checkpoints = getProcurementBatchConfig().dispatchCheckpoints.map(toMinutes).sort((a, b) => a - b);
  const elapsed = checkpoints.filter(checkpoint => checkpoint <= runLocal.minutes);
  if (!elapsed.length) return false;
  const cutoff = wallTime(runLocal.date, elapsed[elapsed.length - 1], timeZone);
  return allocationSelectedAt.getTime() <= cutoff.getTime();
}

/** First day strictly after `orderedAt` (Cairo) on which a supplier with this schedule is open. */
export function firstOpenDayAfter(orderedAt: Date, closedWeekdays: number[], closedDates?: string[]): string {
  const today = cairoDate(orderedAt);
  const schedule: SupplierSchedule = { closedWeekdays, closedDates };
  for (let ahead = 1; ahead <= 14; ahead++) {
    const day = addDays(today, ahead);
    if (isOpenDay(day, schedule)) return day;
  }
  return addDays(today, 1);
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
 * opening. Handles midnight-crossing operating windows correctly.
 */
export function nextOpening(
  at: Date,
  schedule: SupplierSchedule,
  options: { defaultToOperatingWindow?: boolean } = {},
): Date {
  const timeZone = getProcurementBatchConfig().timeZone;
  const now = local(at, timeZone);

  const hasExplicitHours = Boolean(schedule.opensAt);
  const opensAt = schedule.opensAt ?? (options.defaultToOperatingWindow ? getProcurementBatchConfig().defaultOpensAt : null);
  const closesAt = schedule.closesAt ?? (options.defaultToOperatingWindow ? getProcurementBatchConfig().defaultClosesAt : null);

  const opens = opensAt ? toMinutes(opensAt) : 0;

  // Check if currently operating
  if (opensAt && closesAt) {
    if (isSupplierOperating(at, { ...schedule, opensAt, closesAt }, timeZone)) {
      return at;
    }
  } else if (!hasExplicitHours && !options.defaultToOperatingWindow) {
    // Legacy behavior: no hours means open all day on open days
    if (isOpenDay(now.date, schedule)) return at;
  }

  // Not operating right now; determine next opening
  // If today is an open day and before today's opening:
  if (isOpenDay(now.date, schedule) && now.minutes < opens) {
    return wallTime(now.date, opens, timeZone);
  }

  // Find next open day
  for (let ahead = 1; ahead <= 14; ahead++) {
    const day = addDays(now.date, ahead);
    if (isOpenDay(day, schedule)) return cairoWallTime(day, opens);
  }

  return at;
}

/** Calculates the next dispatch checkpoint (09:00, 12:00, 15:00, 18:00, 21:00, 00:00). */
export function nextDispatchCheckpoint(
  at: Date,
  checkpoints = DEFAULT_DISPATCH_CHECKPOINTS,
  timeZone = getProcurementBatchConfig().timeZone,
): Date {
  const now = local(at, timeZone);
  const sortedMinutes = checkpoints.map(toMinutes).sort((a, b) => a - b);

  for (const chk of sortedMinutes) {
    if (now.minutes < chk) {
      return wallTime(now.date, chk, timeZone);
    }
  }

  // After last checkpoint today; next checkpoint is the first one tomorrow
  const tomorrow = addDays(now.date, 1);
  return wallTime(tomorrow, sortedMinutes[0], timeZone);
}
