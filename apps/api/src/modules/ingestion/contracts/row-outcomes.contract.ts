/**
 * GLO-285: a policy-excluded row costs no per-row record. Exclusions collapse to one entry per reason; the retained
 * original file, its checksum and the pinned policy version reproduce any individual row decision.
 */
export interface RowOutcomeGroup {
  outcome: 'POLICY_SKIP';
  reason: string;
  count: number;
  /** Inclusive [first, last] source rows, compressed; bounded by the parser's row limit. */
  rowRanges: Array<[number, number]>;
  /** Most frequent stated brand labels, for the exclusion report. Never used for any decision. */
  topBrands: Array<{ label: string; count: number }>;
}

const MAX_TRACKED_LABELS = 500;
const TOP_LABELS = 20;

export function isRowOutcomeGroup(entry: unknown): entry is RowOutcomeGroup {
  return typeof entry === 'object' && entry !== null && Number.isInteger((entry as RowOutcomeGroup).count) && Array.isArray((entry as RowOutcomeGroup).rowRanges);
}

/** Rows an outcome list accounts for, whether stored per row or aggregated. */
export function countOutcomeRows(entries: ReadonlyArray<{ outcome?: string }>, ...outcomes: string[]): number {
  return entries.reduce((sum, entry) => outcomes.includes(entry.outcome ?? '') ? sum + (isRowOutcomeGroup(entry) ? entry.count : 1) : sum, 0);
}

export class RowOutcomeSkipCollector {
  private readonly groups = new Map<string, { count: number; rowRanges: Array<[number, number]>; labels: Map<string, number> }>();

  add(reason: string, sourceRow: number, brandLabel: string): void {
    let group = this.groups.get(reason);
    if (!group) this.groups.set(reason, group = { count: 0, rowRanges: [], labels: new Map() });
    group.count++;
    const last = group.rowRanges[group.rowRanges.length - 1];
    if (last && last[1] === sourceRow - 1) last[1] = sourceRow;
    else group.rowRanges.push([sourceRow, sourceRow]);
    if (group.labels.has(brandLabel) || group.labels.size < MAX_TRACKED_LABELS) group.labels.set(brandLabel, (group.labels.get(brandLabel) ?? 0) + 1);
  }

  toEntries(): RowOutcomeGroup[] {
    return [...this.groups].map(([reason, group]) => ({
      outcome: 'POLICY_SKIP', reason, count: group.count, rowRanges: group.rowRanges,
      topBrands: [...group.labels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_LABELS).map(([label, count]) => ({ label, count })),
    }));
  }
}

export interface RowAccounting {
  totalRows: number;
  eligible: number;
  policyExcluded: number;
  unresolvedScope: number;
  invalid: number;
  duplicate: number;
  outOfScope: number;
  policyId: string | null;
  policyVersion: number | null;
}

/** Every parsed row lands in exactly one bucket; a mismatch is a defect, never a rounding detail. */
export function rowAccounting(entries: ReadonlyArray<{ outcome?: string }>, totalRows: number, policy: { policyId: string | null; policyVersion: number | null }): RowAccounting {
  const accounting = {
    totalRows,
    eligible: countOutcomeRows(entries, 'IMPORTED', 'IMPORTED_MANUAL'),
    policyExcluded: countOutcomeRows(entries, 'POLICY_SKIP'),
    unresolvedScope: countOutcomeRows(entries, 'POLICY_HOLD'),
    invalid: countOutcomeRows(entries, 'INVALID'),
    duplicate: countOutcomeRows(entries, 'DUPLICATE'),
    outOfScope: countOutcomeRows(entries, 'OUT_OF_SCOPE'),
    ...policy,
  };
  const accounted = accounting.eligible + accounting.policyExcluded + accounting.unresolvedScope + accounting.invalid + accounting.duplicate + accounting.outOfScope;
  if (accounted !== totalRows) throw new Error(`Row accounting mismatch: ${accounted} of ${totalRows} source rows classified`);
  return accounting;
}
