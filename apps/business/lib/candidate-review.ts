/** Review-record contract and reviewer wording. Identity decisions remain on the server; nothing here decides one. */
export type IdentityRoute = 'VERIFIED' | 'CONFLICT' | 'AMBIGUOUS' | 'NEW'
export type IdentityCandidate = { skuId: string; code: string; productName: string; variantName?: string; formula?: string[]; size: number | null; sizeUnit: string | null;
  packCount: number | null; score: number; samePackaging: boolean; shared?: string[]; onlySupplier?: string[]; onlyCatalog?: string[]; missing?: string[]; imageUrl?: string | null }
export type RejectedCandidate = { skuId: string; code: string; productName: string; variantName: string; size: number | null; sizeUnit: string | null;
  packCount: number | null; conflicts: string[] }
export type RowInterpretation = { size: number | null; sizeUnit: string | null; packCount: number | null; formula: string[]; facts: string[]; unreadWords: string[];
  barcodeState: 'VALID' | 'INVALID' | 'MISSING'; unresolved: string[] }
export type IdentityReview = { decision: string; skuId?: string; reviewedBy: string; reviewedAt: string; evidence?: string }
export type SuggestedSku = { id: string; code: string; productName: string; brandName: string; size?: number | null; sizeUnit?: string | null; packCount?: number | null }
export type IdentityMatch = { route: IdentityRoute | null; suggestedSkuId: string | null; suggestedSku: SuggestedSku | null;
  candidates: IdentityCandidate[]; rejectedCandidates: RejectedCandidate[]; interpretation: RowInterpretation; review: IdentityReview | null;
  conflicts: string[]; matchReason: string | null; matchedAt: string | null; confirmable: boolean }
export type VerifiedPackshot = { url: string; review?: { variantName?: string; size?: number; sizeUnit?: string; sourceUrl?: string } | null }

export interface ReviewRecord {
  candidateId: string
  status: string
  identityMatch: IdentityMatch
  originalSupplierRow: { supplierName: string | null; supplierSkuCode: string; statedName: string; barcode: string | null; invalidBarcode: string | null;
    sourceFile?: { fileName: string | null; row: number | null }; price: number; priceType: string | null; currency: string; reportedQuantity: number | null }
  normalizedIdentity: { name: string; brand: string; barcode: string | null; category?: string | null; size?: number | null; sizeUnit?: string | null;
    matchClassification: string; matchReason?: string; matchedSkuId: string | null }
  dependencies: {
    brand: { isCanonical: boolean; draftStatus?: string; name: string }
    ingredients: { canonicalCount: number; activeIngredients: string[]; cautions: string[]; hasForbiddenSubstances: boolean }
    routinePlacement?: { stepOrder?: number; stepType?: string; timing?: string; frequency?: string; requiresDaytimeSunscreen?: boolean }
  }
  contentAndMedia: {
    contentDraft?: { titleEn?: string | null; titleAr?: string | null; shortDescriptionAr?: string | null; isApproved: boolean } | null
    verifiedPackshots: VerifiedPackshot[]
    hasVerifiedPackshot: boolean
  }
  policyAndQualityConflicts: string[]
  canPublish: boolean
}

export type Bilingual = { ar: string; en: string }
export type Reason = Bilingual & { detail?: string }
export type CandidateRow = { skuId: string; code: string; productName: string; variantName?: string; formula?: string[]; size: number | null; sizeUnit: string | null; packCount: number | null;
  score: number | null; samePackaging: boolean | null; suggested: boolean; shared?: string[]; onlySupplier?: string[]; onlyCatalog?: string[]; missing?: string[]; imageUrl?: string | null }

export const ROUTE_LABELS: Record<IdentityRoute, Bilingual> = {
  VERIFIED: { ar: 'هوية موثقة', en: 'Verified identity' },
  CONFLICT: { ar: 'تعارض في الهوية', en: 'Identity conflict' },
  AMBIGUOUS: { ar: 'محتاج تأكيد المراجع', en: 'Needs reviewer confirmation' },
  NEW: { ar: 'منتج جديد', en: 'New product' },
}

/** The stored reason codes. Unknown values show raw beside a generic label rather than a guess. */
export const CONFLICT_LABELS: Record<string, Bilingual> = {
  brand_mismatch: { ar: 'البراند مختلف', en: 'Brand differs' },
  barcode_brand_mismatch: { ar: 'براند الباركود مختلف', en: 'Barcode belongs to another brand' },
  barcode_mismatch: { ar: 'الباركود مختلف', en: 'Barcode differs' },
  barcode_size_mismatch: { ar: 'حجم الباركود مختلف', en: 'Barcode belongs to another size' },
  barcode_collision_multiple_skus: { ar: 'الباركود مسجل على أكتر من منتج', en: 'Barcode is on more than one SKU' },
  barcode_requires_brand_or_name_corroboration: { ar: 'الباركود محتاج تأييد من البراند أو الاسم', en: 'Barcode needs brand or name support' },
  candidate_barcode_brand_conflict: { ar: 'مرشح تاني بنفس الباركود ببراند مختلف', en: 'Another candidate has this barcode under a different brand' },
  candidate_requires_identity_review: { ar: 'المرشح محتاج تأكيد الهوية', en: 'Candidate needs identity review' },
  canonical_sku_inactive: { ar: 'المنتج في الكتالوج غير مفعّل', en: 'Catalog SKU is inactive' },
  different_size_or_variant_requires_review: { ar: 'نفس المنتج بحجم أو نوع مختلف', en: 'Same product in a different size or variant' },
  formula_version_mismatch: { ar: 'إصدار التركيبة مختلف', en: 'Formula version differs' },
  identity_requires_formula_or_description_evidence: { ar: 'محتاج دليل على التركيبة أو الوصف', en: 'Needs formula or description evidence' },
  identity_requires_independent_evidence: { ar: 'محتاج دليل مستقل: الحجم وعدد القطع لازم يكونوا معروفين', en: 'Needs independent evidence: size and pack count must be known' },
  invalid_gtin: { ar: 'الباركود غير صالح', en: 'Invalid barcode' },
  row_size_missing: { ar: 'الصف مذكورش فيه الحجم', en: 'The row states no size' },
  catalog_size_missing: { ar: 'الكتالوج مسجلش حجم للمنتج ده', en: 'The catalog records no size for this SKU' },
  unread_wording: { ar: 'في كلام في الصف محدش فهمه تلقائي', en: 'The row has wording no rule could read' },
  missing_barcode: { ar: 'الباركود ناقص', en: 'Barcode is missing' },
  missing_brand: { ar: 'البراند ناقص', en: 'Brand is missing' },
  missing_name_or_brand: { ar: 'الاسم أو البراند ناقص', en: 'Name or brand is missing' },
  missing_net_content: { ar: 'الحجم الصافي ناقص', en: 'Net content is missing' },
  multiple_candidates_require_review: { ar: 'مفيش مرشح متقدم بوضوح', en: 'No candidate clearly leads' },
  name_match_requires_identity_review: { ar: 'الاسم متطابق بس محتاج تأكيد الهوية', en: 'Name matches but identity needs review' },
  pack_count_mismatch: { ar: 'عدد القطع مختلف', en: 'Pack count differs' },
  product_formulation_mismatch: { ar: 'التركيبة مختلفة', en: 'Formulation differs' },
  size_mismatch: { ar: 'الحجم مختلف', en: 'Size differs' },
  size_unit_mismatch: { ar: 'وحدة الحجم مختلفة', en: 'Size unit differs' },
  source_pack_contradiction: { ar: 'عدد القطع متضارب في ملف المورد', en: 'Supplier file contradicts itself on pack count' },
  source_size_contradiction: { ar: 'الحجم متضارب في ملف المورد', en: 'Supplier file contradicts itself on size' },
  source_unit_contradiction: { ar: 'الوحدة متضاربة في ملف المورد', en: 'Supplier file contradicts itself on unit' },
  supplier_code_reuse: { ar: 'كود المورد مربوط بمنتج تاني', en: 'Supplier code is linked to another SKU' },
  unrecognized_or_invalid_brand: { ar: 'البراند غير معروف', en: 'Unrecognized brand' },
  variant_mismatch: { ar: 'النوع مختلف', en: 'Variant differs' },
}

const REFUSAL_LABELS: Array<[RegExp, Bilingual]> = [
  [/^Selected SKU conflicts/, { ar: 'المنتج ده مش من المرشحين المسموح بيهم للصف ده دلوقتي', en: 'This SKU is no longer a candidate this row may confirm' }],
  [/^SKU not found/, CONFLICT_LABELS.canonical_sku_inactive],
  [/^Only Admin/, { ar: 'التأكيد للأدمن بس', en: 'Only an Admin can confirm' }],
  [/^identity_evidence_required/, { ar: 'اكتب الدليل اللي راجعته الأول', en: 'State the evidence you checked first' }],
  [/^Cannot modify/, { ar: 'الصف اتنشر خلاص ومينفعش يتعدل', en: 'This row is already published' }],
]

export const conflictReason = (raw: string): Reason => {
  const key = raw.trim().replace(/ /g, '_').toLowerCase()
  if (CONFLICT_LABELS[raw]) return CONFLICT_LABELS[raw]
  if (CONFLICT_LABELS[key]) return CONFLICT_LABELS[key]
  // The one stored reason written as a sentence: it names the colliding SKUs, so the detail stays.
  if (/resolves to multiple canonical SKUs/.test(raw)) return { ...CONFLICT_LABELS.barcode_collision_multiple_skus, detail: raw }
  return { ar: 'سبب من الخادم', en: 'Reason from the server', detail: raw }
}

/** Why the server refused a confirmation, split into reasons. The server's wording stays visible when it is not a known code. */
export const refusalReasons = (message: string): Reason[] => {
  const evidence = message.match(/^(?:EXPLICIT_CONFLICT|INSUFFICIENT_EVIDENCE):\s*(.+)$/)
  if (evidence) return evidence[1].split(',').map(reason => conflictReason(reason))
  const known = REFUSAL_LABELS.find(([pattern]) => pattern.test(message))
  return [known ? known[1] : { ar: 'الخادم رفض التأكيد', en: 'The server refused this confirmation', detail: message }]
}

/** Stored rank order, untouched. A suggestion retrieval never ranked (alias or barcode) goes first, marked as such. */
export const MIN_EVIDENCE_LENGTH = 5
export const evidenceIsEnough = (text: string) => text.trim().length >= MIN_EVIDENCE_LENGTH

export const BARCODE_STATE_LABELS: Record<RowInterpretation['barcodeState'], Bilingual> = {
  VALID: { ar: 'باركود صالح', en: 'Valid barcode' },
  INVALID: { ar: 'باركود غير صالح', en: 'Malformed barcode' },
  MISSING: { ar: 'مفيش باركود', en: 'No barcode given' },
}

export const DECISION_LABELS: Record<string, Bilingual> = {
  EXISTING_SKU: { ar: 'اتأكد على منتج موجود', en: 'Confirmed as an existing SKU' },
  NEW_PRODUCT: { ar: 'اتحدد كمنتج مختلف أو جديد', en: 'Marked as a different or new product' },
}

export const candidateRows = (match: IdentityMatch): CandidateRow[] => {
  const ranked: CandidateRow[] = match.candidates.map(candidate => ({ ...candidate, suggested: candidate.skuId === match.suggestedSkuId }))
  const sku = match.suggestedSku
  if (!sku || ranked.some(row => row.skuId === sku.id)) return ranked
  return [{ skuId: sku.id, code: sku.code, productName: sku.productName, size: sku.size ?? null, sizeUnit: sku.sizeUnit ?? null,
    packCount: sku.packCount ?? null, score: null, samePackaging: null, suggested: true }, ...ranked]
}

export const packagingText = (row: Pick<CandidateRow, 'size' | 'sizeUnit' | 'packCount'>): Bilingual => {
  const measure = row.size !== null && row.sizeUnit ? `${row.size} ${row.sizeUnit}` : null
  return {
    // An LTR isolate, or RTL reads "236 ml" as "ml 236".
    ar: `${measure ? `⁦${measure}⁩` : 'الحجم غير مسجل'} · ${row.packCount !== null ? `عدد القطع ${row.packCount}` : 'عدد القطع غير مسجل'}`,
    en: `${measure ?? 'Size not recorded'} · ${row.packCount !== null ? `pack of ${row.packCount}` : 'pack count not recorded'}`,
  }
}

export const samePackagingLabel = (samePackaging: boolean | null): { tone: 'ok' | 'pending'; text: Bilingual } | null =>
  samePackaging === null ? null : samePackaging
    ? { tone: 'ok', text: { ar: 'نفس العبوة', en: 'Same packaging' } }
    : { tone: 'pending', text: { ar: 'العبوة غير مؤكدة', en: 'Packaging not confirmed' } }

/** Empty-state wording only: why this row has nothing to pick from. */
export const emptyCandidatesText = (route: IdentityRoute | null): { title: Bilingual; body: Bilingual } => {
  if (route === null) return { title: { ar: 'المطابقة مخلصتش للصف ده', en: 'No stored match for this row' },
    body: { ar: 'مفيش نتيجة مطابقة محفوظة، فمفيش مرشحين يتعرضوا.', en: 'No match result was stored, so there are no candidates to show.' } }
  if (route === 'NEW') return { title: { ar: 'مفيش مرشحين من الكتالوج', en: 'No catalog candidates' },
    body: { ar: 'مفيش منتج في الكتالوج قريب من الصف ده، فهيتراجع كمنتج جديد.', en: 'Nothing in the catalog is close to this row, so it is reviewed as a new product.' } }
  if (route === 'VERIFIED') return { title: { ar: 'الهوية موثقة ومحتاجتش مرشحين', en: 'Identity is verified; no candidates needed' },
    body: { ar: 'اتربطت بمنتج عن طريق دليل موثق.', en: 'It was linked through verified evidence.' } }
  return { title: { ar: 'مفيش مرشح ينفع يتأكد', en: 'No candidate can be confirmed' },
    body: { ar: 'راجع الأسباب، وصحّح الصف أو اطلب إيضاح من المورد.', en: 'Check the reasons, then correct the row or ask the supplier.' } }
}
