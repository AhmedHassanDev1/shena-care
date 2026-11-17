/**
 * Morning / Evening resolution for the routine pages.
 *
 * The default comes from the browser's own clock (so from the customer's local time zone) and never from geolocation.
 * The thresholds are configuration, not magic numbers: change `ROUTINE_PERIOD_CONFIG` or pass another config.
 */

export type RoutinePeriod = 'AM' | 'PM';

export interface PeriodConfig {
  /** Local hour (0–23) at which Morning starts. */
  morningStartHour: number;
  /** Local hour (0–23) at which Evening starts. Morning runs until this hour; Evening wraps past midnight. */
  eveningStartHour: number;
}

/** Morning 06:00–17:59, Evening 18:00–05:59. */
export const ROUTINE_PERIOD_CONFIG: PeriodConfig = { morningStartHour: 6, eveningStartHour: 18 };

export const PERIOD_STORAGE_KEY = 'shina.routines.period';

/** The period a local moment belongs to. `date.getHours()` is the browser-local hour. */
export function resolvePeriod(date: Date, config: PeriodConfig = ROUTINE_PERIOD_CONFIG): RoutinePeriod {
  const hour = date.getHours();
  const { morningStartHour: start, eveningStartHour: end } = config;
  if (start === end) return 'AM';
  const inMorning = start < end ? hour >= start && hour < end : hour >= start || hour < end;
  return inMorning ? 'AM' : 'PM';
}

export const isRoutinePeriod = (value: unknown): value is RoutinePeriod => value === 'AM' || value === 'PM';

/** How long a manual Morning/Evening pick outranks the clock. After this, opening a routine follows the local time again. */
export const MANUAL_CHOICE_TTL_MS = 15 * 60 * 1000;

/** What is kept in sessionStorage: the pick and when it was made. */
export const serializeChoice = (period: RoutinePeriod, nowMs: number): string => JSON.stringify({ p: period, t: nowMs });

/** The customer's recent manual pick, or null when there is none, it is corrupt, or it is older than the TTL. */
export function readChoice(raw: string | null | undefined, nowMs: number, ttlMs: number = MANUAL_CHOICE_TTL_MS): RoutinePeriod | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { p?: unknown; t?: unknown };
    if (!isRoutinePeriod(parsed.p) || typeof parsed.t !== 'number') return null;
    const age = nowMs - parsed.t;
    return age >= 0 && age <= ttlMs ? parsed.p : null;
  } catch {
    return null;
  }
}

/**
 * Period on opening a routine page. The default is the customer's own local time (the browser clock, so their time zone; no
 * geolocation permission). A manual pick made within the last few minutes wins, so moving between the three routine pages
 * never flips what they just chose; a fresh visit follows the clock again.
 */
export function initialPeriod(stored: string | null | undefined, now: Date, config: PeriodConfig = ROUTINE_PERIOD_CONFIG, ttlMs: number = MANUAL_CHOICE_TTL_MS): RoutinePeriod {
  return readChoice(stored, now.getTime(), ttlMs) ?? resolvePeriod(now, config);
}
