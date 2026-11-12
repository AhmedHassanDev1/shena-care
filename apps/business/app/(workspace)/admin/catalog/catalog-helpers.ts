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
  media: Array<{ id: string; url: string; altText: string | null; isPrimary: boolean }>
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
