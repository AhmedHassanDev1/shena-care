/** Owner policy (2026-10-25): goods reaching the hub must still have at least this many months of shelf life. */
export const DEFAULT_MIN_SHELF_LIFE_MONTHS = 6;

export function minShelfLifeMonths(raw = process.env.MIN_SHELF_LIFE_MONTHS): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MIN_SHELF_LIFE_MONTHS;
  const months = Number(raw);
  return Number.isInteger(months) && months >= 0 ? months : DEFAULT_MIN_SHELF_LIFE_MONTHS;
}

/** Why a printed expiry (YYYY-MM-DD) makes a unit unacceptable at receiving, or null when it is fine. */
export function expiryProblem(expiryDate: string, today = new Date(), months = minShelfLifeMonths()): 'EXPIRED' | 'SHORT_DATED' | null {
  const day = today.toISOString().slice(0, 10);
  if (expiryDate < day) return 'EXPIRED';
  const earliest = new Date(today);
  earliest.setUTCMonth(earliest.getUTCMonth() + months);
  return expiryDate < earliest.toISOString().slice(0, 10) ? 'SHORT_DATED' : null;
}
