/**
 * The automatic catalog decision rules, in one place and free of I/O so every rule is testable on its own.
 *
 * Principles the rules encode:
 *  - Automatic is the default. A person is asked only when a decision is genuinely theirs: a real identity or safety contradiction, or input the pipeline cannot obtain.
 *  - Confidence never authorises a high-risk decision by itself. Identity links and safety-relevant facts need deterministic evidence.
 *  - Unknown stays unknown. A missing barcode, ingredient list or instruction is recorded as unknown and processing continues.
 */
export const DECISION_RULE_VERSION = 'autopilot@1';

export type CatalogDecisionState = 'AUTO_ACCEPT' | 'AUTO_LINK' | 'SKIP' | 'HOLD_CRITICAL' | 'RETRY_AUTOMATIC';
export type Severity = 'CRITICAL' | 'HIGH';
export type ExceptionAction = 'RESOLVE' | 'CORRECT' | 'REJECT' | 'RETRY';

export interface Recommendation {
  action: ExceptionAction;
  label: string;
  /** What the precomputed action would apply, e.g. { skuId } to link or { factId } to keep. */
  payload?: Record<string, unknown>;
}

export interface HoldReason { reasonCode: string; severity: Severity; summary: string; field?: string; recommended?: Recommendation }

// ─── Import rows ─────────────────────────────────────────────────────────────

/** Row holds the matcher produces and what each one means for a person. Anything not listed is not a reason to stop. */
const ROW_HOLDS: Record<string, Omit<HoldReason, 'recommended'> & { action: ExceptionAction; label: string }> = {
  IDENTITY_CONFLICT: { reasonCode: 'IDENTITY_CONFLICT', severity: 'CRITICAL', summary: 'The row contradicts the catalog SKU it resembles (brand, size, formula or barcode)', action: 'CORRECT', label: 'Correct the row or reject it' },
  COMPETING_IDENTITIES: { reasonCode: 'COMPETING_IDENTITIES', severity: 'CRITICAL', summary: 'More than one catalog SKU could be this product', action: 'RESOLVE', label: 'Pick the SKU this row is' },
  IDENTITY_UNCONFIRMED: { reasonCode: 'IDENTITY_UNCONFIRMED', severity: 'HIGH', summary: 'Same brand, name and size as one catalog SKU, but nothing independent confirms it is the same product', action: 'RESOLVE', label: 'Confirm the suggested SKU' },
  POSSIBLE_DUPLICATE_CANDIDATE: { reasonCode: 'POSSIBLE_DUPLICATE_CANDIDATE', severity: 'HIGH', summary: 'Another open row may be the same product worded differently', action: 'RESOLVE', label: 'Decide whether they are the same product' },
  MISSING_BRAND: { reasonCode: 'MISSING_BRAND', severity: 'HIGH', summary: 'No brand could be read or inferred', action: 'CORRECT', label: 'Add the brand' },
  MISSING_NET_CONTENT: { reasonCode: 'MISSING_NET_CONTENT', severity: 'HIGH', summary: 'Size and unit are needed to tell this product apart from its other sizes', action: 'CORRECT', label: 'Add the size' },
  SIZE_UNREADABLE: { reasonCode: 'SIZE_UNREADABLE', severity: 'HIGH', summary: 'The size cell is not a readable quantity and unit', action: 'CORRECT', label: 'Correct the size' },
  POLICY_BRAND_SPELLING_UNCONFIRMED: { reasonCode: 'BRAND_SPELLING_UNCONFIRMED', severity: 'HIGH', summary: 'The brand is not on the Catalog Policy but closely resembles an allowed brand', action: 'CORRECT', label: 'Use the suggested brand' },
  POLICY_NOT_ADMITTED: { reasonCode: 'POLICY_NOT_ADMITTED', severity: 'HIGH', summary: 'The current Catalog Policy no longer admits this row', action: 'RETRY', label: 'Re-check against the current policy' },
  SIZE_NOT_CONFIRMED: { reasonCode: 'SIZE_NOT_CONFIRMED', severity: 'HIGH', summary: 'The product page names the product but not this size, so the variant is not proven', action: 'CORRECT', label: 'Add the page for this exact size' },
  BRAND_SPELLING_UNCONFIRMED: { reasonCode: 'BRAND_SPELLING_UNCONFIRMED', severity: 'HIGH', summary: 'The brand is not on the Catalog Policy but closely resembles an allowed brand', action: 'RESOLVE', label: 'Confirm the brand spelling' },
  POLICY_BRAND_AMBIGUOUS: { reasonCode: 'POLICY_BRAND_AMBIGUOUS', severity: 'HIGH', summary: 'The brand name points to more than one allowed brand', action: 'CORRECT', label: 'Choose the brand' },
  POLICY_CATEGORY_AMBIGUOUS: { reasonCode: 'POLICY_CATEGORY_AMBIGUOUS', severity: 'HIGH', summary: 'The category or product type fits more than one approved leaf category (e.g. a 2-in-1)', action: 'CORRECT', label: 'Choose the category' },
  POLICY_CATEGORY_REQUIRES_LEAF: { reasonCode: 'POLICY_CATEGORY_REQUIRES_LEAF', severity: 'HIGH', summary: 'A precise sub-category is required by the Catalog Policy', action: 'CORRECT', label: 'Choose the sub-category' },
  POLICY_CATEGORY_UNKNOWN: { reasonCode: 'POLICY_CATEGORY_UNKNOWN', severity: 'HIGH', summary: 'Neither the category cell nor the product name says what kind of product this is, and no catalog SKU or verified page settles it', action: 'CORRECT', label: 'Choose the category' },
  POLICY_CATEGORY_CONFLICTS_PRODUCT_TYPE: { reasonCode: 'POLICY_CATEGORY_CONFLICTS_PRODUCT_TYPE', severity: 'HIGH', summary: 'The stated category contradicts the product type the name states, and one of the readings would be admitted', action: 'CORRECT', label: 'Correct the category or the name' },
  POLICY_NOT_CONFIGURED: { reasonCode: 'POLICY_NOT_CONFIGURED', severity: 'HIGH', summary: 'No Catalog Policy is active yet', action: 'RETRY', label: 'Publish a Catalog Policy, then retry' },
  POLICY_CATEGORY_HIERARCHY_UNKNOWN: { reasonCode: 'POLICY_CATEGORY_HIERARCHY_UNKNOWN', severity: 'HIGH', summary: 'The category hierarchy is not fully in the Catalog Policy', action: 'CORRECT', label: 'Fix the category' },
  NO_IDENTITY_SOURCE: { reasonCode: 'NO_IDENTITY_SOURCE', severity: 'HIGH', summary: 'A new product needs a manufacturer or trusted product page to verify its identity; none was given or found', action: 'CORRECT', label: 'Add the official product page URL, then retry' },
  SOURCE_CONTRADICTS_IDENTITY: { reasonCode: 'SOURCE_CONTRADICTS_IDENTITY', severity: 'CRITICAL', summary: 'The product page describes a different product or size than the row', action: 'CORRECT', label: 'Correct the row or the page URL' },
  SOURCE_NOT_TRUSTED: { reasonCode: 'SOURCE_NOT_TRUSTED', severity: 'HIGH', summary: 'The only page found is not the manufacturer or a trusted distributor', action: 'CORRECT', label: 'Add an official product page URL' },
  BARCODE_CONFLICT: { reasonCode: 'BARCODE_CONFLICT', severity: 'CRITICAL', summary: 'A verified barcode disagrees with the barcode stated for this product', action: 'CORRECT', label: 'Settle which barcode is right' },
  RETRY_EXHAUSTED: { reasonCode: 'RETRY_EXHAUSTED', severity: 'HIGH', summary: 'The product page kept failing after automatic retries', action: 'RETRY', label: 'Retry now' },
  BRAND_NOT_VERIFIED: { reasonCode: 'BRAND_NOT_VERIFIED', severity: 'HIGH', summary: 'The brand is new and its official website could not be verified, so it was not created', action: 'CORRECT', label: 'Give the brand\'s English name or an official product page URL, then retry' },
  BRAND_MATCHES_EXISTING: { reasonCode: 'BRAND_MATCHES_EXISTING', severity: 'HIGH', summary: 'The brand\'s official name is a brand the catalog already holds', action: 'CORRECT', label: 'Use the existing brand name' },
  BRAND_EXISTS_NOT_ENABLED: { reasonCode: 'BRAND_EXISTS_NOT_ENABLED', severity: 'HIGH', summary: 'The brand is in the catalog but not enabled in the Catalog Policy', action: 'RETRY', label: 'Enable the brand in the Catalog Policy, then retry' },
};

export function rowHold(code: keyof typeof ROW_HOLDS | string, recommendedPayload?: Record<string, unknown>, summary?: string): HoldReason {
  const hold = ROW_HOLDS[code] ?? { reasonCode: code, severity: 'HIGH' as Severity, summary: summary ?? code, action: 'RESOLVE' as ExceptionAction, label: 'Decide' };
  return { reasonCode: hold.reasonCode, severity: hold.severity, summary: summary ?? hold.summary,
    recommended: { action: hold.action, label: hold.label, ...(recommendedPayload && { payload: recommendedPayload }) } };
}

/** Policy outcomes that are a deterministic "not in our catalog": skipped with no person involved. */
const POLICY_SKIPS = new Set(['POLICY_BRAND_NOT_ALLOWED', 'POLICY_CATEGORY_DENIED', 'POLICY_CATEGORY_NOT_ALLOWED', 'POLICY_CATEGORY_NOT_ALLOWED_FOR_BRAND',
  'POLICY_PRODUCT_EXCLUDED', 'POLICY_BRAND_NOT_IN_ALLOWLIST', 'POLICY_PRODUCT_TYPE_NOT_IN_TAXONOMY']);

export interface MatchedRowFacts {
  outcome: 'PENDING' | 'LINKED_EXISTING' | 'NEW_CANDIDATE' | 'HOLD' | 'REJECTED';
  reasonCode: string | null;
  matchedSkuId: string | null;
  /** True when an Admin settled the row by hand. */
  resolvedByAdmin: boolean;
  suggestedSkuId?: string | null;
}

/**
 * The decision for a row once matching has run, before any new-product work. NEW_CANDIDATE returns null: it needs source verification first and is decided by the
 * new-product steps (decideNewProduct).
 */
export function decideMatchedRow(row: MatchedRowFacts): { decision: CatalogDecisionState; reasonCode: string; hold?: HoldReason } | null {
  const code = row.reasonCode ?? '';
  switch (row.outcome) {
    case 'LINKED_EXISTING':
      return { decision: 'AUTO_LINK', reasonCode: row.resolvedByAdmin ? 'ADMIN_LINKED' : code || 'VERIFIED_EXISTING_SKU' };
    case 'REJECTED':
      if (row.resolvedByAdmin) return { decision: 'SKIP', reasonCode: 'ADMIN_REJECTED' };
      if (POLICY_SKIPS.has(code) || code === 'INVALID' || code === 'OUT_OF_SCOPE' || code.startsWith('POLICY_')) return { decision: 'SKIP', reasonCode: code };
      if (code === 'MISSING_NAME' || code === 'NAME_TOO_LONG' || code === 'FIELD_TOO_LONG') return { decision: 'SKIP', reasonCode: code };
      // The same product waiting from an earlier row: it is linked when that row's product exists (a later recheck), never a second product.
      if (code === 'DUPLICATE_OF_ROW') return null;
      return { decision: 'SKIP', reasonCode: code || 'REJECTED' };
    case 'HOLD': {
      const mapped = code === 'AMBIGUOUS_IDENTITY' ? (row.suggestedSkuId ? 'IDENTITY_UNCONFIRMED' : 'COMPETING_IDENTITIES')
        : code === 'INVALID_BARCODE' ? 'IDENTITY_UNCONFIRMED' : code === 'POLICY_BRAND_SPELLING_UNCONFIRMED' ? 'BRAND_SPELLING_UNCONFIRMED' : code;
      return { decision: 'HOLD_CRITICAL', reasonCode: mapped, hold: rowHold(mapped, row.suggestedSkuId ? { skuId: row.suggestedSkuId } : undefined) };
    }
    case 'NEW_CANDIDATE':
    case 'PENDING':
    default:
      return null;
  }
}

/**
 * When may a row whose name, brand and packaging equal exactly one catalog SKU be linked without a person? Only with support that does not come from the row's own
 * wording: the pipeline itself created that SKU from the same identity fingerprint, the SKU's verified identity source is the same page the row names, or a barcode
 * verified on the SKU equals the row's. Name and size alone never link (a reformulation or a reused name would merge silently).
 */
export function independentLinkSupport(input: {
  rowFingerprint: string; rowSourceUrl: string | null; rowBarcode: string | null;
  sku: { identityStatus: string; barcode: string | null; barcodeStatus: string; identityEvidence: { fingerprints?: string[]; sourceUrls?: string[] } | null };
  /** Earlier rows with this fingerprint that settled on this SKU (pipeline-created or linked). */
  provenanceRows: number;
}): { supported: boolean; basis: string | null } {
  const evidence = input.sku.identityEvidence ?? {};
  if (input.provenanceRows > 0 || evidence.fingerprints?.includes(input.rowFingerprint)) return { supported: true, basis: 'PIPELINE_PROVENANCE' };
  const verified = input.sku.identityStatus === 'EVIDENCE_VERIFIED' || input.sku.identityStatus === 'ADMIN_VERIFIED' || input.sku.identityStatus === 'BARCODE_VERIFIED';
  if (verified && input.rowSourceUrl && evidence.sourceUrls?.some(url => sameUrl(url, input.rowSourceUrl!))) return { supported: true, basis: 'SAME_VERIFIED_SOURCE' };
  if (input.rowBarcode && input.sku.barcode && input.sku.barcodeStatus === 'VERIFIED' && input.sku.barcode === input.rowBarcode) return { supported: true, basis: 'VERIFIED_BARCODE' };
  return { supported: false, basis: null };
}

export function sameUrl(a: string, b: string): boolean {
  const canon = (value: string) => {
    try {
      const url = new URL(value);
      // A storefront serves one product page under any collection: /collections/<any>/products/<handle> is /products/<handle>.
      const path = url.pathname.replace(/\/+$/, '').toLowerCase().replace(/^\/collections\/[^/]+(\/products\/[^/]+)$/, '$1');
      return `${url.hostname.replace(/^www\./, '').toLowerCase()}${path}`;
    } catch { return value.trim().toLowerCase(); }
  };
  return canon(a) === canon(b);
}

// ─── New products: identity verification against a source page ──────────────

export type SourceTier = 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR' | 'RETAILER';

export interface SourceCheck {
  url: string;
  tier: SourceTier;
  /** OK, or the fetcher's outcome (TIMEOUT, HTTP_5xx, ROBOTS_DISALLOWED, ...). */
  outcome: string;
  retryable: boolean;
  identityMatched: boolean;
  /** The page states this SKU's size; false when it states another size. null when it names no size at all. */
  sizeConfirmed: boolean | null;
  rejectedReasons: string[];
  /** A GTIN in the page's structured data, if any. */
  pageGtin: string | null;
  /** Only when the row stated no size: the single size the page's own title names, with its words. */
  pageSize?: { value: number; unit: string };
  pageSizeExcerpt?: string;
}

/**
 * Verdict from pages the pipeline found itself (a sibling size's pages, search results): only a page that verifies the row counts. A page about another product is
 * just a wrong search hit, never a contradiction of the row; with no verifying page the row has no identity source yet.
 */
export function decideFromFoundPages(checks: SourceCheck[], row: { barcode: string | null }): ReturnType<typeof decideNewProduct> {
  const relevant = checks.filter(check => !check.rejectedReasons.includes('IDENTITY_MISMATCH') && !check.rejectedReasons.includes('SIZE_MISMATCH'));
  const verdict = decideNewProduct(relevant, row);
  if (verdict.decision === 'AUTO_ACCEPT' || verdict.decision === 'RETRY_AUTOMATIC' || verdict.reasonCode === 'BARCODE_CONFLICT') return verdict;
  return { decision: 'HOLD_CRITICAL', reasonCode: 'NO_IDENTITY_SOURCE', hold: rowHold('NO_IDENTITY_SOURCE', { tried: checks.map(check => ({ url: check.url, outcome: check.outcome, reasons: check.rejectedReasons })) },
    checks.length ? 'No page found on the brand\'s site or a trusted distributor states this product and this size' : 'No product page was given, and none was found on the brand\'s site or a trusted distributor') };
}

/** The single size trusted pages state for a row that named none; several different sizes, or none, leave it unknown. */
export function sizeFromFoundPages(checks: SourceCheck[]): { size: { value: number; unit: string }; check: SourceCheck } | null {
  const stating = checks.filter(check => check.tier !== 'RETAILER' && check.outcome === 'OK' && check.identityMatched && check.pageSize);
  const distinct = [...new Map(stating.map(check => [`${check.pageSize!.value}${check.pageSize!.unit}`, check])).values()];
  return distinct.length === 1 ? { size: distinct[0].pageSize!, check: distinct[0] } : null;
}

/**
 * Identity of a product new to the catalog is verified by evidence: a manufacturer or trusted-distributor page that names the same brand and product and states the
 * same size. A barcode is not required. A retailer page alone is not enough. A transient failure is retried automatically.
 */
export function decideNewProduct(checks: SourceCheck[], row: { barcode: string | null }): {
  decision: CatalogDecisionState; reasonCode: string; verifiedBy?: SourceCheck; hold?: HoldReason;
} {
  if (!checks.length) return { decision: 'HOLD_CRITICAL', reasonCode: 'NO_IDENTITY_SOURCE', hold: rowHold('NO_IDENTITY_SOURCE') };
  const trusted = checks.filter(check => check.tier !== 'RETAILER');
  const contradicted = checks.find(check => check.outcome === 'OK' && check.tier !== 'RETAILER' &&
    (check.rejectedReasons.includes('IDENTITY_MISMATCH') || check.rejectedReasons.includes('SIZE_MISMATCH')));
  const verified = trusted.find(check => check.outcome === 'OK' && check.identityMatched && check.sizeConfirmed === true);
  if (contradicted && !verified) return { decision: 'HOLD_CRITICAL', reasonCode: 'SOURCE_CONTRADICTS_IDENTITY', hold: rowHold('SOURCE_CONTRADICTS_IDENTITY', { url: contradicted.url, reasons: contradicted.rejectedReasons }) };
  if (verified) {
    // A barcode stated on the row that a manufacturer page contradicts is a real conflict; one it simply does not mention is not.
    if (row.barcode && verified.pageGtin && verified.tier === 'OFFICIAL_MANUFACTURER' && !sameGtin(row.barcode, verified.pageGtin)) {
      return { decision: 'HOLD_CRITICAL', reasonCode: 'BARCODE_CONFLICT', hold: rowHold('BARCODE_CONFLICT', { stated: row.barcode, official: verified.pageGtin, url: verified.url }) };
    }
    return { decision: 'AUTO_ACCEPT', reasonCode: 'IDENTITY_VERIFIED_BY_SOURCE', verifiedBy: verified };
  }
  if (checks.some(check => check.retryable)) return { decision: 'RETRY_AUTOMATIC', reasonCode: 'SOURCE_TEMPORARILY_UNAVAILABLE' };
  // A trusted page that names the product but no size at all leaves the variant unproven.
  const sizeless = trusted.find(check => check.outcome === 'OK' && check.identityMatched && check.sizeConfirmed === null);
  if (sizeless) return { decision: 'HOLD_CRITICAL', reasonCode: 'SIZE_NOT_CONFIRMED', hold: rowHold('SIZE_NOT_CONFIRMED', { url: sizeless.url }, 'The product page names the product but not this size, so the variant is not proven') };
  if (!trusted.length) return { decision: 'HOLD_CRITICAL', reasonCode: 'SOURCE_NOT_TRUSTED', hold: rowHold('SOURCE_NOT_TRUSTED', { urls: checks.map(check => check.url) }) };
  return { decision: 'HOLD_CRITICAL', reasonCode: 'NO_IDENTITY_SOURCE', hold: rowHold('NO_IDENTITY_SOURCE', { tried: checks.map(check => ({ url: check.url, outcome: check.outcome })) },
    'The product page could not be read or did not describe this product') };
}

export const MAX_AUTOMATIC_ATTEMPTS = 5;
/** Exponential backoff for recoverable failures: 1, 2, 4, 8 minutes. */
export function nextAttemptDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
}

export function sameGtin(a: string, b: string): boolean {
  const key = (value: string) => value.replace(/\D/g, '').replace(/^0+/, '');
  return key(a) === key(b);
}

// ─── Facts ───────────────────────────────────────────────────────────────────

export type FactVerdict =
  | { kind: 'APPLY'; rule: string }
  | { kind: 'KEEP_UNVERIFIED'; rule: string; reason: string }
  | { kind: 'REJECT'; rule: string; reason: string }
  | { kind: 'CRITICAL'; rule: string; reason: string; hold: HoldReason };

export interface FactReading { id: string; field: string; value: unknown; tiers: SourceTier[]; status: 'PROPOSED' | 'CONFLICT' | 'REJECTED' | 'APPLIED' }

/** Fields whose disagreement can hurt someone or change what the product is. */
const CRITICAL_ON_CONFLICT = new Set(['identity.size', 'identity.gtin', 'composition.inci', 'composition.activeConcentrations', 'usage.instructions', 'safety.warnings', 'attributes.spf']);
/** Evidence that is kept for people and never written to the catalog as a fact. */
const EVIDENCE_ONLY = new Set(['identity.name', 'identity.brand', 'claims.manufacturerStated', 'media.sourceImages']);

const TIER_RANK: Record<SourceTier, number> = { OFFICIAL_MANUFACTURER: 3, TRUSTED_DISTRIBUTOR: 2, RETAILER: 1 };
const bestTier = (reading: FactReading) => Math.max(0, ...reading.tiers.map(tier => TIER_RANK[tier] ?? 0));

/** Medical or treatment wording a cosmetic description may not carry into the storefront. */
const MEDICAL_CLAIM = /\b(cures?|treats?|treatment of|acne treatment|treat(?:s|ing)? (?:mild |moderate |severe )*acne|heals?|prevents? (?:hair loss|acne|eczema|psoriasis)|stops? hair loss|anti[- ]?hair[- ]?loss|regrow|clinically proven to (?:cure|treat|stop)|eczema|psoriasis|dermatitis|alopecia|infection|antibacterial|antifungal|prescription)\b|علاج|يعالج|يشفي|تساقط الشعر|الصلع|الاكزيما/i;
/**
 * Instructions that say the product stays on, and ones that say it comes off. "Leave on for 3-5 minutes, then rinse" is a contact time of a rinse-off product, not a
 * leave-in: "leave (it) on" followed by a duration never counts as leave-on (regression from the real Clary Conditioner and Mask pages, 2026-11-06).
 */
const LEAVE_ON = /\b(leave[- ]in|do not rinse|don't rinse|no rinse|without rinsing|no need to rinse|until (?:fully |completely |totally )?absorbed|leave (?:it |them )?on(?!\s+(?:the\s+hair\s+|hair\s+|skin\s+)?(?:for|about|approximately|around|up to|between)?\s*\d))\b|بدون شطف|لا يشطف|لا تشطف|حتى (?:يتم )?الامتصاص|حتى يمتص/i;
const RINSE_OFF = /\b(rinse(?: off| out| thoroughly| well)?|wash off|wash out)\b|اشطف|يشطف/i;

export function rinseMode(lines: string[]): 'LEAVE_ON' | 'RINSE_OFF' | 'CONTRADICTORY' | 'UNKNOWN' {
  const text = lines.join(' ');
  const leave = LEAVE_ON.test(text);
  // "do not rinse" contains "rinse": only count a rinse instruction that is not part of a leave-on phrase.
  const rinse = RINSE_OFF.test(text.replace(new RegExp(LEAVE_ON.source, 'gi'), ' '));
  if (leave && rinse) return 'CONTRADICTORY';
  return leave ? 'LEAVE_ON' : rinse ? 'RINSE_OFF' : 'UNKNOWN';
}

export function hasMedicalClaim(text: string): boolean {
  return MEDICAL_CLAIM.test(text);
}

/**
 * Field-level verdicts for every open reading of one SKU. Deterministic: same readings in, same verdicts out.
 *  - Evidence-only fields are verified as evidence and never applied.
 *  - A single reading from a manufacturer or trusted distributor is applied; a retailer-only reading stays unverified (unknown in the catalog).
 *  - Disagreement on a descriptive field: the higher authority wins; equal authority leaves the field unknown. No person is needed.
 *  - Disagreement on size, barcode, ingredients, active concentration, instructions or warnings opens one critical exception per field.
 *  - Marketing never overrides instructions: a description or claim that contradicts the stated use is dropped, the instruction stands.
 */
export function decideFacts(readings: FactReading[]): Map<string, FactVerdict> {
  const verdicts = new Map<string, FactVerdict>();
  const open = readings.filter(reading => reading.status === 'PROPOSED' || reading.status === 'CONFLICT');
  const byField = new Map<string, FactReading[]>();
  for (const reading of open) byField.set(reading.field, [...(byField.get(reading.field) ?? []), reading]);
  const applied = (field: string) => readings.filter(reading => reading.field === field && reading.status === 'APPLIED');

  const usage = [...(byField.get('usage.instructions') ?? []), ...applied('usage.instructions')];
  const usageMode = rinseMode(usage.flatMap(reading => reading.value as string[]));

  for (const [field, list] of byField) {
    const sorted = [...list].sort((a, b) => bestTier(b) - bestTier(a) || a.id.localeCompare(b.id));
    const trusted = sorted.filter(reading => bestTier(reading) >= TIER_RANK.TRUSTED_DISTRIBUTOR);

    if (EVIDENCE_ONLY.has(field)) {
      for (const reading of sorted) verdicts.set(reading.id, { kind: 'KEEP_UNVERIFIED', rule: 'EVIDENCE_ONLY_FIELD', reason: 'Kept as evidence; never written to the catalog as a fact' });
      continue;
    }
    if (!trusted.length) {
      for (const reading of sorted) verdicts.set(reading.id, { kind: 'KEEP_UNVERIFIED', rule: 'RETAILER_ONLY', reason: 'Only a retailer states this; the catalog keeps it unknown' });
      continue;
    }

    if (field === 'marketing.description') {
      for (const reading of sorted) {
        const text = String(reading.value);
        if (hasMedicalClaim(text)) verdicts.set(reading.id, { kind: 'REJECT', rule: 'MEDICAL_CLAIM_NOT_PUBLISHED', reason: 'Treatment or medical wording is not published as a product description' });
        else if (usageMode !== 'UNKNOWN' && usageMode !== 'CONTRADICTORY' && rinseMode([text]) !== 'UNKNOWN' && rinseMode([text]) !== usageMode) {
          verdicts.set(reading.id, { kind: 'REJECT', rule: 'MARKETING_CONTRADICTS_INSTRUCTIONS', reason: `The description says ${rinseMode([text])} but the instructions say ${usageMode}; instructions win` });
        }
      }
      const remaining = sorted.filter(reading => !verdicts.has(reading.id));
      if (remaining.length) pickBest(field, remaining, verdicts);
      continue;
    }

    if (field === 'usage.instructions') {
      // Compared with what the catalog already states too: a new source never quietly contradicts an applied instruction.
      const inCatalog = applied(field);
      const modes = [...trusted, ...inCatalog].map(reading => rinseMode(reading.value as string[]));
      if (modes.includes('CONTRADICTORY') || (modes.includes('LEAVE_ON') && modes.includes('RINSE_OFF'))) {
        const hold: HoldReason = { reasonCode: 'USAGE_INSTRUCTIONS_CONTRADICT', severity: 'CRITICAL', field, summary: 'Sources disagree on whether the product is rinsed off or left on',
          recommended: inCatalog.length ? { action: 'REJECT', label: 'Keep the instruction already in the catalog', payload: { keepFactId: inCatalog[0].id } }
            : { action: 'RESOLVE', label: 'Keep the manufacturer instruction', payload: { factId: trusted[0].id } } };
        for (const reading of trusted) verdicts.set(reading.id, { kind: 'CRITICAL', rule: 'RINSE_MODE_CONFLICT', reason: hold.summary, hold });
        for (const reading of sorted.filter(r => !trusted.includes(r))) verdicts.set(reading.id, { kind: 'KEEP_UNVERIFIED', rule: 'RETAILER_ONLY', reason: 'Lower authority than a conflicting source' });
        continue;
      }
    }

    if (field === 'safety.warnings') {
      // Warnings add caution and never remove it: every trusted warning is kept.
      for (const reading of trusted) verdicts.set(reading.id, { kind: 'APPLY', rule: 'WARNINGS_ACCUMULATE' });
      for (const reading of sorted.filter(r => !trusted.includes(r))) verdicts.set(reading.id, { kind: 'KEEP_UNVERIFIED', rule: 'RETAILER_ONLY', reason: 'Only a retailer states this warning' });
      continue;
    }

    if (field === 'composition.fragrance') {
      // The ingredient list outranks a "fragrance-free" claim: PRESENT is the safe and stated reading.
      const present = trusted.find(reading => reading.value === 'PRESENT');
      if (present) {
        verdicts.set(present.id, { kind: 'APPLY', rule: 'INCI_OUTRANKS_CLAIM' });
        for (const reading of sorted.filter(r => r !== present)) verdicts.set(reading.id, { kind: 'REJECT', rule: 'CLAIM_CONTRADICTED_BY_INCI', reason: 'The ingredient list names a fragrance' });
        continue;
      }
    }

    const distinct = trusted.length;
    if (distinct > 1) {
      const top = bestTier(trusted[0]);
      const leaders = trusted.filter(reading => bestTier(reading) === top);
      if (CRITICAL_ON_CONFLICT.has(field)) {
        const hold: HoldReason = { reasonCode: `${field.toUpperCase().replace(/\./g, '_')}_CONFLICT`, severity: 'CRITICAL', field,
          summary: `Trusted sources state different values for ${field}`,
          recommended: leaders.length === 1 ? { action: 'RESOLVE', label: 'Keep the manufacturer value', payload: { factId: leaders[0].id } } : { action: 'RESOLVE', label: 'Choose the correct value' } };
        for (const reading of trusted) verdicts.set(reading.id, { kind: 'CRITICAL', rule: 'CRITICAL_FIELD_CONFLICT', reason: hold.summary, hold });
        continue;
      }
      if (leaders.length === 1) {
        verdicts.set(leaders[0].id, { kind: 'APPLY', rule: 'HIGHER_AUTHORITY_WINS' });
        for (const reading of sorted.filter(r => r !== leaders[0])) verdicts.set(reading.id, { kind: 'REJECT', rule: 'LOWER_AUTHORITY_CONFLICT', reason: 'A higher-authority source states another value' });
      } else {
        for (const reading of sorted) verdicts.set(reading.id, { kind: 'KEEP_UNVERIFIED', rule: 'EQUAL_AUTHORITY_CONFLICT', reason: 'Equally authoritative sources disagree; the catalog keeps this unknown' });
      }
      continue;
    }
    pickBest(field, sorted, verdicts);
  }
  return verdicts;
}

function pickBest(field: string, sorted: FactReading[], verdicts: Map<string, FactVerdict>) {
  const [best, ...rest] = sorted;
  if (bestTier(best) >= TIER_RANK.TRUSTED_DISTRIBUTOR) verdicts.set(best.id, { kind: 'APPLY', rule: best.tiers.includes('OFFICIAL_MANUFACTURER') ? 'OFFICIAL_SOURCE' : 'TRUSTED_DISTRIBUTOR_SOURCE' });
  else verdicts.set(best.id, { kind: 'KEEP_UNVERIFIED', rule: 'RETAILER_ONLY', reason: 'Only a retailer states this' });
  for (const reading of rest) if (!verdicts.has(reading.id)) verdicts.set(reading.id, { kind: 'REJECT', rule: 'LOWER_AUTHORITY_CONFLICT', reason: `A better-sourced value was kept for ${field}` });
}

// ─── Media ───────────────────────────────────────────────────────────────────

export interface ImageCandidate { url: string; width: number; height: number; tier: SourceTier; reusedBySku: string | null }

export const MIN_IDENTITY_EDGE = 400;

/**
 * Picks the authentic image to use as the identity packshot: a manufacturer or trusted-distributor image, at least 400 px on each side, not already proof for another
 * SKU. Never upscales to pass; a too-small source is reported, not used.
 */
export function chooseIdentityImage(candidates: ImageCandidate[]): { chosen: ImageCandidate | null; rejected: Array<{ url: string; reason: string }> } {
  const rejected: Array<{ url: string; reason: string }> = [];
  const usable = candidates.filter(candidate => {
    if (candidate.tier === 'RETAILER') { rejected.push({ url: candidate.url, reason: 'SOURCE_NOT_AUTHENTIC_ENOUGH' }); return false; }
    if (candidate.reusedBySku) { rejected.push({ url: candidate.url, reason: `IMAGE_IS_PROOF_FOR_ANOTHER_SKU:${candidate.reusedBySku}` }); return false; }
    if (Math.min(candidate.width, candidate.height) < MIN_IDENTITY_EDGE) { rejected.push({ url: candidate.url, reason: `RESOLUTION_TOO_LOW:${candidate.width}x${candidate.height}` }); return false; }
    return true;
  });
  usable.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || Math.min(b.width, b.height) - Math.min(a.width, a.height) || a.url.localeCompare(b.url));
  return { chosen: usable[0] ?? null, rejected };
}

/** Compositor warnings that mean the editorial image may show damage. Any of these keeps the derivative out; scale notes do not. */
export const DAMAGE_WARNINGS = ['TOUCHES_IMAGE_EDGE', 'ENCLOSED_BACKGROUND', 'LOW_EDGE_CONTRAST', 'RESIDUAL_SHADOW', 'DETACHED_PART', 'UPSCALED_SMALL_SOURCE'] as const;

export function decideEditorial(report: { warnings: string[] } | null, processing: 'SUCCEEDED' | 'FAILED' | string): { approve: boolean; reason: string } {
  if (processing !== 'SUCCEEDED' || !report) return { approve: false, reason: 'PROCESSING_FAILED' };
  const damage = report.warnings.filter(warning => (DAMAGE_WARNINGS as readonly string[]).includes(warning));
  return damage.length ? { approve: false, reason: `QUALITY:${damage.join(',')}` } : { approve: true, reason: 'QUALITY_CHECKS_PASSED' };
}
