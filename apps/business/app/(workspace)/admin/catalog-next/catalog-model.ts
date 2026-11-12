const DEFAULT_API_URL = 'http://localhost:3001'

export function resolveCatalogMediaUrl(
  url: string | null | undefined,
  apiBase = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL,
): string | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null
  const base = apiBase.replace(/\/$/, '')
  if (trimmed.startsWith('/')) return `${base}${trimmed}`
  return trimmed
}

export type SkuPrimaryMediaState =
  | 'PUBLISHED'
  | 'APPROVED'
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'MISSING'

export type ProductMediaStatus =
  | 'PUBLISHED'
  | 'APPROVED_UNPUBLISHED'
  | 'PENDING_REVIEW'
  | 'MISSING'

export type MediaHiddenReason =
  | 'PRODUCT_NOT_PUBLISHED'
  | 'NOT_REVIEWED_MEDIA'
  | 'REVIEW_IDENTITY_MISMATCH'
  | 'NOT_STORED_LOCALLY'

export type CatalogMedia = {
  id: string
  url: string
  altText: string | null
  isPrimary: boolean
  /** True when the storefront serves this image. When false the Admin still previews it through an authenticated route. */
  publiclyServed: boolean
  hiddenReason: MediaHiddenReason | null
}

export type CatalogSku = {
  id: string
  code: string
  variantName: string
  barcode: string | null
  size: number | null
  sizeUnit: string | null
  packCount: number
  isActive: boolean
  hasOuterCarton: boolean | null
  identityStatus: string
  barcodeStatus: string
  primaryMediaState: SkuPrimaryMediaState
  isListed: boolean
  currentPrice: {
    id: string
    amount: number
    compareAtAmount: number | null
    currency: string
  } | null
  readinessIssues: string[]
}

export type CatalogItem = {
  id: string
  name: string
  slug: string
  description: string | null
  isPublished: boolean
  archivedAt: string | null
  brandId: string
  categoryId: string
  productLineId: string | null
  brand: { id: string; name: string; slug: string }
  category: { id: string; name: string; slug: string; parentId: string | null } | null
  productLine: { id: string; name: string; slug: string } | null
  media: CatalogMedia[]
  mediaStatus: ProductMediaStatus
  skus: CatalogSku[]
  readiness: {
    status: 'READY' | 'NEEDS_ATTENTION' | 'ARCHIVED'
    issues: string[]
  }
}

export type CatalogItemsResponse = {
  total: number
  page: number
  limit: number
  summary: {
    total: number
    published: number
    draft: number
    archived: number
    missingImage: number
  }
  items: CatalogItem[]
}

export type BrandLine = {
  id: string
  brandId?: string
  name: string
  slug: string
  description: string | null
  imageUrl?: string | null
  isActive: boolean
}

export type BrandSummary = {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  websiteUrl: string | null
  countryOfOrigin: string | null
  isActive: boolean
  aliases: string[]
  productCount: number
  publishedProductCount: number
  productLines: BrandLine[]
}

export type CategoryChildNode = {
  id: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  sortOrder: number
  isActive: boolean
  directProductCount: number
}

export type CategoryNode = {
  id: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  sortOrder: number
  isActive: boolean
  directProductCount: number
  totalProductCount: number
  children: CategoryChildNode[]
}

export type PolicyRuleEffect = 'ALLOW' | 'DENY'
export type PolicyMode = 'OPEN' | 'ALLOWLIST_ONLY'

export type PolicyBrandRule = {
  id?: string
  name: string
  effect: PolicyRuleEffect
  aliases?: string[]
  note?: string
}

export type PolicyCategoryRule = {
  id: string
  name: string
  effect: PolicyRuleEffect
  note?: string
}

export type PolicyBrandCategoryRule = {
  brandId?: string
  brandName: string
  categoryId: string
  categoryName: string
  effect: PolicyRuleEffect
  note?: string
}

export type PolicyDocument = {
  mode: PolicyMode
  brands: PolicyBrandRule[]
  categories: PolicyCategoryRule[]
  brandCategoryRules: PolicyBrandCategoryRule[]
  excludedTerms: string[]
  disabledExcludedClasses: string[]
}

export type PolicyStateResponse = {
  current: {
    id: string | null
    version: number
    reason: string | null
    actorId: string | null
    approvedAt: string | null
    document: PolicyDocument
  }
  history: Array<{
    id: string
    version: number | null
    status: string
    reason: string
    actorId: string
    approvedAt: string | null
    createdAt: string
  }>
  systemExcludedClasses: Array<{
    key: string
    phraseCount: number
    samplePhrases: string[]
  }>
}

export type PolicyEvaluationResult = {
  outcome: 'ALLOW' | 'SKIP' | 'REVIEW'
  decision: 'CONTINUE' | 'SKIP'
  reasonCode: string
  detail: string | null
  mode: PolicyMode
  policyVersion: number | null
  matchedBrands: Array<{ brandId: string; label: string; basis: string }>
  excludedClassesDetected: string[]
}

export type WorkbenchReadiness = {
  skuId: string
  productId: string
  isPublished: boolean
  ready: boolean
  blockers: string[]
  warnings: string[]
  media: Record<string, string>
  facts: { applied: string[]; pending: string[]; conflicts: string[] }
  identity: { status: string; barcodeStatus: string; barcode: string | null }
  openExceptions: number
  commerce: {
    isListed: boolean
    price: { amount: number; currency: string } | null
  }
}

export const READINESS_ISSUE_LABELS: Record<string, string> = {
  CATEGORY_MISSING: 'بلا تصنيف',
  IDENTITY_INCOMPLETE: 'بيانات النسخة ناقصة',
  IDENTITY_NOT_VERIFIED: 'الهوية غير موثقة',
  CARTON_DECISION_MISSING: 'قرار الكرتونة مفقود',
  CARTON_PROOF_NOT_APPROVED: 'إثبات الكرتونة غير معتمد',
  PRIMARY_PACKSHOT_MISSING: 'بلا صورة رئيسية',
  PRIMARY_PACKSHOT_NOT_APPROVED: 'الصورة غير معتمدة',
  PRIMARY_PACKSHOT_PENDING_REVIEW: 'صورة بانتظار المراجعة',
  PRIMARY_PACKSHOT_REJECTED: 'صورة مرفوضة',
  PRIMARY_PACKSHOT_NOT_PUBLISHED: 'صورة معتمدة غير منشورة',
  SELLING_PRICE_MISSING: 'السعر غير محدد',
  LISTING_NOT_ACTIVE: 'مخفي عن العرض',
  SKU_INACTIVE: 'النسخة موقوفة',
  NO_REVIEWED_FACTS: 'لا توجد حقائق مراجعة',
  FACT_CONFLICT_UNRESOLVED: 'تعارض حقائق مفتوح',
  CRITICAL_FACT_NOT_REVIEWED: 'حقائق حرجة غير مراجعة',
  CRITICAL_EXCEPTION_OPEN: 'توجد مشكلة حرجة مفتوحة',
  BARCODE_MISSING: 'الباركود غير مسجل',
  EDITORIAL_IMAGE_NOT_APPROVED: 'صورة تحريرية غير معتمدة',
  INGREDIENTS_NOT_REVIEWED: 'المكونات غير مراجعة',
  USAGE_NOT_REVIEWED: 'طريقة الاستخدام غير مراجعة',
}

export function readinessIssueLabel(code: string): string {
  return READINESS_ISSUE_LABELS[code] ?? code
}

export const EXCLUDED_CLASS_LABELS: Record<string, string> = {
  MEDICINE: 'الأدوية والمستحضرات الدوائية',
  BABY_FEEDING_DIAPERS: 'حفاضات وألبان ومستلزمات الرضع',
  MAKEUP: 'المكياج ومستحضرات التجميل الملونة',
  FRAGRANCE: 'العطور والبرفيوم والبودي سبلاش',
  ORAL_CARE: 'العناية بالفم والأسنان',
  MEDICAL_DEVICE: 'الأجهزة والمستلزمات الطبية',
  SHAVING: 'أدوات الحلاقة',
  HAIR_COLOR: 'صبغات الشعر',
}

export const POLICY_REASON_LABELS: Record<string, string> = {
  HARD_IDENTIFIER: 'تم التمرير بفضل معرف موثق (باركود أو كود مورد معروف).',
  CATALOG_BRAND: 'الماركة معرفة في الكتالوج وغير مستبعدة في السياسة.',
  POLICY_BRAND_ALLOWED: 'الماركة مدرجة ضمن قائمة السماح.',
  POLICY_BRAND_CATEGORY_ALLOWED: 'تركيب الماركة والتصنيف مسموح به صراحةً في السياسة.',
  POLICY_BRAND_DENIED: 'الماركة مستبعدة في سياسة الإدخال.',
  POLICY_CATEGORY_DENIED: 'التصنيف مستبعد في سياسة الإدخال.',
  POLICY_BRAND_CATEGORY_DENIED: 'تركيب الماركة والتصنيف مستبعد بالسياسة.',
  POLICY_EXCLUDED_TERM: 'يحتوي العنوان على عبارة مستبعدة بالسياسة.',
  BRAND_NOT_IN_ALLOWLIST: 'الماركة غير مدرجة في قائمة السماح الحصرية.',
  CATEGORY_NOT_IN_ALLOWLIST: 'التصنيف غير مدرج في قائمة السماح الحصرية.',
  NOT_IN_ALLOWLIST: 'الوضع الحصري مفعّل ولم تطابق أي ماركة مسموح بها.',
  UNKNOWN_SCOPE: 'ماركة غير معروفة في الوضع المفتوح — يُحوّل للمراجعة قبل اعتماد الكتالوج.',
}

export function policyReasonLabel(code: string): string {
  if (code.startsWith('OUT_OF_SCOPE_')) {
    const klass = code.replace('OUT_OF_SCOPE_', '')
    return `خارج نطاق الكتالوج: ${EXCLUDED_CLASS_LABELS[klass] ?? klass}`
  }
  return POLICY_REASON_LABELS[code] ?? code
}

export function flattenCategories(nodes: CategoryNode[]): Array<{
  id: string
  name: string
  parentId: string | null
  parentName: string | null
  isActive: boolean
}> {
  const out: Array<{
    id: string
    name: string
    parentId: string | null
    parentName: string | null
    isActive: boolean
  }> = []
  for (const root of nodes) {
    out.push({
      id: root.id,
      name: root.name,
      parentId: null,
      parentName: null,
      isActive: root.isActive,
    })
    for (const child of root.children) {
      out.push({
        id: child.id,
        name: child.name,
        parentId: root.id,
        parentName: root.name,
        isActive: child.isActive,
      })
    }
  }
  return out
}

/* ── Image visibility: why a stored image is not shown to customers ─────────────────────────── */

export const MEDIA_HIDDEN_LABELS: Record<MediaHiddenReason, string> = {
  PRODUCT_NOT_PUBLISHED: 'الصورة محفوظة وتظهر للعملاء بعد نشر المنتج',
  NOT_REVIEWED_MEDIA: 'الصورة بلا مراجعة هوية معتمدة، فلن تظهر للعملاء',
  REVIEW_IDENTITY_MISMATCH: 'بيانات النسخة تغيّرت بعد مراجعة الصورة، أعد مراجعتها قبل النشر',
  NOT_STORED_LOCALLY: 'الصورة مخزنة خارج الخادم',
}

export function mediaHiddenLabel(reason: MediaHiddenReason | null | undefined): string | null {
  return reason ? MEDIA_HIDDEN_LABELS[reason] ?? null : null
}

/** The path of the Admin-only route that streams a stored product image (draft or hidden ones included). */
export function adminMediaPath(mediaId: string): string {
  return `/catalog/items/media/${mediaId}/file`
}

/* ── Readiness: which editor section fixes which blocker ───────────────────────────────────── */

export type EditorSection = 'details' | 'skus' | 'media'

const ISSUE_ORDER = [
  'CATEGORY_MISSING',
  'IDENTITY_INCOMPLETE',
  'IDENTITY_NOT_VERIFIED',
  'BARCODE_MISSING',
  'CARTON_DECISION_MISSING',
  'CARTON_PROOF_NOT_APPROVED',
  'PRIMARY_PACKSHOT_MISSING',
  'PRIMARY_PACKSHOT_REJECTED',
  'PRIMARY_PACKSHOT_PENDING_REVIEW',
  'PRIMARY_PACKSHOT_NOT_APPROVED',
  'PRIMARY_PACKSHOT_NOT_PUBLISHED',
  'EDITORIAL_IMAGE_NOT_APPROVED',
  'SELLING_PRICE_MISSING',
  'LISTING_NOT_ACTIVE',
  'SKU_INACTIVE',
]

export function issueSection(code: string): EditorSection {
  if (code === 'CATEGORY_MISSING') return 'details'
  if (code.startsWith('PRIMARY_PACKSHOT') || code === 'EDITORIAL_IMAGE_NOT_APPROVED' || code === 'CARTON_PROOF_NOT_APPROVED') {
    return 'media'
  }
  return 'skus'
}

/** Blockers sorted by what must be resolved first; unknown codes go last. */
export function sortIssues(issues: string[]): string[] {
  const rank = (code: string) => {
    const index = ISSUE_ORDER.indexOf(code)
    return index === -1 ? ISSUE_ORDER.length : index
  }
  return [...issues].sort((a, b) => rank(a) - rank(b))
}

export const SECTION_LABELS: Record<EditorSection, string> = {
  details: 'بيانات المنتج',
  skus: 'النسخ والنشر',
  media: 'الصور',
}

/* ── Error messages in Arabic, keyed by the API's error code ────────────────────────────────── */

export const CATALOG_ERROR_MESSAGES: Record<string, string> = {
  BRAND_HAS_DEPENDENCIES: 'لا يمكن حذف الماركة لأنها مرتبطة بمنتجات أو خطوط إنتاج. أوقفها بدلًا من حذفها.',
  BRAND_IN_ALLOWLIST_POLICY: 'لا يمكن حذف الماركة لأن لها قاعدة في قائمة السماح. أزل القاعدة واحفظ إصدارًا جديدًا أولًا.',
  CATEGORY_HAS_DEPENDENCIES: 'لا يمكن حذف التصنيف لأنه يحتوي على منتجات أو تصنيفات فرعية.',
  CATEGORY_IN_ALLOWLIST_POLICY: 'لا يمكن حذف التصنيف لأن له قاعدة في قائمة السماح. أزل القاعدة واحفظ إصدارًا جديدًا أولًا.',
  CATEGORY_HAS_CHILDREN: 'لا يمكن جعل تصنيف رئيسي يحتوي على تصنيفات فرعية تابعًا لتصنيف آخر.',
  CATEGORY_MAX_DEPTH: 'التصنيفات تدعم مستويين فقط: رئيسي وفرعي.',
  UNKNOWN_BRAND_ID: 'الماركة المحددة غير موجودة في الكتالوج.',
  UNKNOWN_CATEGORY_ID: 'التصنيف المحدد غير موجود في الكتالوج.',
}

export function catalogErrorMessage(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback
  if (error.code && CATALOG_ERROR_MESSAGES[error.code]) return CATALOG_ERROR_MESSAGES[error.code]
  const message = error.message ?? ''
  if (/SKU with code/i.test(message)) return 'كود النسخة مستخدم بالفعل في منتج آخر.'
  if (/SKU with barcode/i.test(message)) return 'الباركود مسجل بالفعل على نسخة أخرى.'
  if (/brand with (name|slug)/i.test(message)) return 'يوجد ماركة بنفس الاسم أو المعرّف بالفعل.'
  if (/category with (name|slug)/i.test(message)) return 'يوجد تصنيف بنفس الاسم أو المعرّف بالفعل.'
  if (/product line with slug/i.test(message)) return 'يوجد خط إنتاج بنفس المعرّف بالفعل.'
  if (/product with slug/i.test(message)) return 'يوجد منتج بنفس المعرّف بالفعل.'
  if (/Restore the archived product/i.test(message)) return 'استعد المنتج من الأرشيف قبل تعديله.'
  return message || fallback
}

/* ── Product list filters live in the URL so a list survives opening a product and coming back ─ */

export type ProductStatusFilter = 'all' | 'published' | 'draft' | 'archived'
export type ProductReadinessFilter = '' | 'missing_image' | 'pending_image' | 'missing_price' | 'not_listed' | 'incomplete' | 'ready'

export type ProductFilters = {
  q: string
  brand: string
  cat: string
  status: ProductStatusFilter
  ready: ProductReadinessFilter
  page: number
}

const STATUSES: ProductStatusFilter[] = ['all', 'published', 'draft', 'archived']
const READINESS: ProductReadinessFilter[] = ['', 'missing_image', 'pending_image', 'missing_price', 'not_listed', 'incomplete', 'ready']

export function parseProductFilters(get: (key: string) => string | null): ProductFilters {
  const status = (get('status') ?? 'all') as ProductStatusFilter
  const ready = (get('ready') ?? '') as ProductReadinessFilter
  const page = Number.parseInt(get('page') ?? '1', 10)
  return {
    q: get('q') ?? '',
    brand: get('brand') ?? '',
    cat: get('cat') ?? '',
    status: STATUSES.includes(status) ? status : 'all',
    ready: READINESS.includes(ready) ? ready : '',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

/** Query string for GET /catalog/items. */
export function productsApiQuery(filters: ProductFilters, limit = 25): string {
  const params = new URLSearchParams()
  params.set('page', String(filters.page))
  params.set('limit', String(limit))
  if (filters.q.trim()) params.set('q', filters.q.trim())
  if (filters.brand) params.set('brandId', filters.brand)
  if (filters.cat) params.set('categoryId', filters.cat)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.ready) params.set('readiness', filters.ready)
  return params.toString()
}

export function hasActiveProductFilters(filters: ProductFilters): boolean {
  return Boolean(filters.q.trim() || filters.brand || filters.cat || filters.status !== 'all' || filters.ready)
}

export const READINESS_FILTER_LABELS: Record<Exclude<ProductReadinessFilter, ''>, string> = {
  ready: 'بياناتها مكتملة وجاهزة',
  incomplete: 'بيانات ناقصة (تصنيف أو باركود أو حجم)',
  missing_image: 'بلا صورة',
  pending_image: 'صورة بانتظار المراجعة',
  missing_price: 'بلا سعر بيع',
  not_listed: 'غير ظاهرة بالمتجر',
}

/* ── Allowlist: the engine's real order of decision, taken from ScopeGate.decide ─────────────── */

export const POLICY_DECISION_ORDER: Array<{ title: string; body: string }> = [
  { title: 'معرّف موثق', body: 'سطر يحمل باركودًا أو كودًا معروفًا يمرّ دائمًا إلى المطابقة، قبل أي قاعدة أخرى.' },
  { title: 'عبارة مستبعدة', body: 'إن احتوى العنوان على عبارة من قائمة العبارات المستبعدة يُستبعد السطر.' },
  { title: 'ماركة موجودة بالكتالوج', body: 'استبعاد الماركة، ثم استثناء (ماركة + تصنيف)، ثم قاعدة التصنيف، ثم السماح الحصري بالماركة.' },
  { title: 'ماركة غير معروفة', body: 'ماركة ممنوعة بالاسم، ثم فئات الاستبعاد المدمجة (أدوية، مكياج…)، ثم قاعدة التصنيف، ثم الوضع الحصري، وإلا يحوَّل للمراجعة.' },
]

/* ── Product rows: only exceptions are highlighted ─────────────────────────────────────────── */

export function skuSizeText(sku: Pick<CatalogSku, 'size' | 'sizeUnit'> | undefined): string {
  if (!sku || sku.size === null || sku.size === undefined) return ''
  return `${sku.size}${sku.sizeUnit ? ` ${sku.sizeUnit}` : ''}`
}

/** "250 ml" or "250 ml +2" when the product has more variants. */
export function productSizeText(item: Pick<CatalogItem, 'skus'>): string {
  const first = skuSizeText(item.skus[0])
  if (!first) return item.skus.length > 1 ? `${item.skus.length} نسخ` : ''
  return item.skus.length > 1 ? `${first} +${item.skus.length - 1}` : first
}

export function productPrice(item: Pick<CatalogItem, 'skus'>): { amount: number; currency: string } | null {
  const priced = item.skus.find((sku) => sku.currentPrice)
  return priced?.currentPrice ? { amount: priced.currentPrice.amount, currency: priced.currentPrice.currency } : null
}

export type RowStatus = {
  label: string
  tone: 'muted' | 'warn' | 'cobalt'
  /** Blocking issue codes, most important first. Empty for a healthy row. */
  issues: string[]
}

/** A healthy row stays quiet. A draft is only a draft: the real publish gate is checked in the editor, not guessed here. */
export function rowStatus(item: Pick<CatalogItem, 'archivedAt' | 'isPublished' | 'readiness'>): RowStatus {
  if (item.archivedAt) return { label: 'مؤرشف', tone: 'muted', issues: [] }
  const issues = sortIssues(item.readiness.issues)
  if (issues.length) return { label: readinessIssueLabel(issues[0]), tone: 'warn', issues }
  if (item.isPublished) return { label: 'منشور', tone: 'muted', issues: [] }
  return { label: 'مسودة', tone: 'muted', issues: [] }
}

export function summaryLine(summary: { total: number; published: number; draft: number; archived: number; missingImage: number }): string {
  const parts = [`${summary.total} منتج`, `${summary.published} منشور`, `${summary.draft} مسودة`]
  if (summary.archived > 0) parts.push(`${summary.archived} مؤرشف`)
  if (summary.missingImage > 0) parts.push(`${summary.missingImage} بلا صورة`)
  return parts.join(' · ')
}

export const STATUS_FILTER_LABELS: Record<ProductStatusFilter, string> = {
  all: 'الكل',
  published: 'منشور',
  draft: 'مسودة',
  archived: 'مؤرشف',
}

/* ── Allowlist: one flat list of rules the engine really evaluates ─────────────────────────── */

export type RuleKind = 'brand' | 'category' | 'pair' | 'term' | 'system'

export type FlatRule = {
  key: string
  kind: RuleKind
  /** Index inside its own array of the policy document (not used for system rules). */
  index: number
  title: string
  detail?: string
  effect: PolicyRuleEffect | 'SYSTEM_ON' | 'SYSTEM_OFF'
}

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  brand: 'ماركة',
  category: 'تصنيف',
  pair: 'ماركة + تصنيف',
  term: 'عبارة',
  system: 'مدمجة',
}

export function flattenPolicy(
  doc: PolicyDocument,
  systemClasses: Array<{ key: string }> = [],
): FlatRule[] {
  const rules: FlatRule[] = []
  doc.brands.forEach((brand, index) =>
    rules.push({
      key: `brand-${brand.id ?? brand.name}`,
      kind: 'brand',
      index,
      title: brand.name,
      detail: brand.aliases?.length ? brand.aliases.join('، ') : brand.id ? undefined : 'خارج الكتالوج',
      effect: brand.effect,
    }),
  )
  doc.categories.forEach((category, index) =>
    rules.push({ key: `category-${category.id}`, kind: 'category', index, title: category.name, effect: category.effect }),
  )
  doc.brandCategoryRules.forEach((rule, index) =>
    rules.push({
      key: `pair-${rule.brandId ?? rule.brandName}-${rule.categoryId}`,
      kind: 'pair',
      index,
      title: `${rule.brandName} ← ${rule.categoryName}`,
      detail: rule.note,
      effect: rule.effect,
    }),
  )
  doc.excludedTerms.forEach((term, index) =>
    rules.push({ key: `term-${term}`, kind: 'term', index, title: term, effect: 'DENY' }),
  )
  systemClasses.forEach((klass, index) =>
    rules.push({
      key: `system-${klass.key}`,
      kind: 'system',
      index,
      title: EXCLUDED_CLASS_LABELS[klass.key] ?? klass.key,
      detail: klass.key,
      effect: doc.disabledExcludedClasses.includes(klass.key) ? 'SYSTEM_OFF' : 'SYSTEM_ON',
    }),
  )
  return rules
}

export function ruleEffectText(effect: FlatRule['effect']): { text: string; tone: 'ok' | 'danger' | 'muted' } {
  if (effect === 'ALLOW') return { text: 'مسموح', tone: 'ok' }
  if (effect === 'DENY') return { text: 'مستبعد', tone: 'danger' }
  if (effect === 'SYSTEM_ON') return { text: 'مستبعد تلقائيًا', tone: 'danger' }
  return { text: 'الاستبعاد معطّل', tone: 'muted' }
}

/** The same document with one rule changed, added or removed; never mutates the original. */
export function withRuleRemoved(doc: PolicyDocument, rule: FlatRule): PolicyDocument {
  const drop = <T,>(list: T[]) => list.filter((_, i) => i !== rule.index)
  if (rule.kind === 'brand') return { ...doc, brands: drop(doc.brands) }
  if (rule.kind === 'category') return { ...doc, categories: drop(doc.categories) }
  if (rule.kind === 'pair') return { ...doc, brandCategoryRules: drop(doc.brandCategoryRules) }
  if (rule.kind === 'term') return { ...doc, excludedTerms: drop(doc.excludedTerms) }
  return doc
}
