/**
 * How long a customer has to answer an availability decision (owner decision 2026-10-25): 12 hours that do not
 * count the night (23:00–08:00 Cairo time), when the customer is asleep. Started at 22:00, it ends at 19:00 next day.
 */
export const DECISION_WINDOW_HOURS = 12;
export const DECISION_TIME_ZONE = 'Africa/Cairo';
export const DECISION_NIGHT_FROM_HOUR = 23;
export const DECISION_NIGHT_TO_HOUR = 8;

const hourFormat = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: DECISION_TIME_ZONE });
const localHour = (at: Date) => Number(hourFormat.format(at));
const isAwake = (at: Date) => {
  const hour = localHour(at);
  return hour >= DECISION_NIGHT_TO_HOUR && hour < DECISION_NIGHT_FROM_HOUR;
};

export function decisionWindowHours(raw = process.env.DECISION_WINDOW_HOURS): number {
  const hours = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(hours) && hours > 0 && hours <= 72 ? hours : DECISION_WINDOW_HOURS;
}

/** The moment `hours` waking hours after `from` have passed (minute resolution). */
export function decisionDeadline(from: Date, hours = decisionWindowHours()): Date {
  let remaining = Math.round(hours * 60);
  const at = new Date(from.getTime());
  while (remaining > 0) {
    if (isAwake(at)) remaining--; // the minute that starts now
    at.setTime(at.getTime() + 60_000);
  }
  return at;
}
