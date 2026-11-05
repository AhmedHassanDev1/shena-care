/** Catalog Policy read model and presentation helpers. Every admission rule is decided by the API, never here. */
export type PolicyExclusion = { productId: string; brandId: string; name: string; reason: string; actorId: string; at: string }
export type PolicyBrand = {
  id: string; name: string; slug: string; isActive: boolean; logoUrl: string | null; websiteUrl: string | null; description: string | null; countryOfOrigin: string | null
  enabled: boolean; denied: boolean; aliases: string[]; categoryIds: string[]; productCount: number; exclusions: PolicyExclusion[]
}
export type PolicyCategory = { id: string; name: string; slug: string; parentId: string | null; isActive: boolean; sortOrder: number; isLeaf: boolean }
export type CatalogPolicy = { policyId: string | null; version: number; approvedAt: string | null; brands: PolicyBrand[]; categories: PolicyCategory[] }
export type BrandProduct = { id: string; name: string; isPublished: boolean; categoryId: string | null; skus: Array<{ code: string; variantName: string }> }
export type PolicyChange = { policyId: string | null; version: number; changed: boolean }

/** Search folding only (Arabic letter forms, case, punctuation). Duplicate detection itself happens on the server. */
export const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[ً-ٰٟـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}]+/gu, '')

export const brandMatches = (brand: PolicyBrand, query: string) => {
  const q = fold(query)
  return !q || [brand.name, brand.slug, ...brand.aliases].some(label => fold(label).includes(q))
}

/** Enabled brands first, then by name: what is live is what an operator checks first. */
export const sortBrands = (brands: PolicyBrand[]) =>
  [...brands].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, 'ar'))

export type LeafGroup = { id: string; name: string; leaves: PolicyCategory[] }

/** Active exact leaves grouped under their top-level category, in catalog order. Parents are headings, never choices. */
export function leafGroups(categories: PolicyCategory[]): LeafGroup[] {
  const byId = new Map(categories.map(c => [c.id, c]))
  const rootOf = (c: PolicyCategory) => {
    let current = c
    const seen = new Set<string>()
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.parentId)! }
    return current
  }
  const groups = new Map<string, LeafGroup>()
  const other: LeafGroup = { id: 'other', name: 'تصنيفات أخرى', leaves: [] }
  for (const c of categories) {
    if (!c.isLeaf || !c.isActive) continue
    const root = rootOf(c)
    if (root.id === c.id) { other.leaves.push(c); continue }
    if (!groups.has(root.id)) groups.set(root.id, { id: root.id, name: root.name, leaves: [] })
    groups.get(root.id)!.leaves.push(c)
  }
  const order = (a: PolicyCategory, b: PolicyCategory) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ar')
  const result = [...groups.values()].sort((a, b) => order(byId.get(a.id)!, byId.get(b.id)!))
  for (const g of result) g.leaves.sort(order)
  other.leaves.sort(order)
  return other.leaves.length ? [...result, other] : result
}

export const formatDate = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('ar-EG', { numberingSystem: 'latn', dateStyle: 'medium', timeStyle: 'short' })
  : ''

/* ── Smart Add Brand: research preview (the API decides every field's status) ───────────────────────────────────── */
export type FieldStatus = 'VERIFIED' | 'UNVERIFIED'
export type ResearchedField = { value: string; status: FieldStatus; origin: 'PAGE' | 'ADMIN'; sourceUrl: string; excerpt: string; note?: string }
export type BrandResearch = {
  outcome: 'FOUND' | 'PARTIAL' | 'NOT_FOUND' | 'UNAVAILABLE'
  site: { url: string; host: string; verifiedOfficial: boolean; origin: 'ADMIN' | 'SEARCH' } | null
  name: ResearchedField | null; website: ResearchedField | null; description: ResearchedField | null
  country: ResearchedField | null; parentCompany: ResearchedField | null; aliases: ResearchedField[]
  logo: (ResearchedField & { mediaType: string }) | null
  references: Array<{ url: string; title: string; host: string }>
  notes: string[]
}
export type ResearchResponse = { draftId: string; research: BrandResearch }
export type SavedBrand = { brandId: string; version: number; changed: boolean; logoSaved: boolean; logoNote: string | null }
export type BrandIdentity = {
  id: string; name: string; description: string | null; websiteUrl: string | null; countryOfOrigin: string | null; logoUrl: string | null
  fields: Record<string, { status: 'VERIFIED' | 'ADMIN_ENTERED'; sourceUrl?: string } | Array<{ status: string }> | null> | null; decidedAt: string | null
}

/** Plain-language reason for each note the research returns. */
export const researchNote = (note: string): string => ({
  SEARCH_UNAVAILABLE: 'البحث على الإنترنت مش متاح دلوقتي.',
  NO_SITE_FOUND: 'ملقيناش موقع رسمي واضح للبراند.',
  DOMAIN_NOT_BRAND: 'الموقع ده مش دومين البراند نفسه، فكل المعلومات غير مؤكدة.',
  NEEDS_LATIN_NAME: 'مش هنخمّن موقع لاسم عربي. اكتب اسم البراند بالإنجليزي عشان نلاقي الموقع الرسمي ونأكده.',
  LOGO_NOT_FOUND: 'مالقيناش لوجو واضح على الموقع.',
  LOGO_UNUSABLE: 'اللوجو اللي على الموقع مش بصيغة نقدر نحفظها (PNG أو JPG أو WebP).',
  SITE_ROBOTS_DISALLOWED: 'الموقع مانع القراءة الآلية، فمش هنقراه.',
  SITE_NOT_FOUND: 'صفحة الموقع مش موجودة.',
  SITE_ACCESS_DENIED: 'الموقع رفض القراءة.',
  SITE_TIMEOUT: 'الموقع اتأخر في الرد.',
  SITE_UPSTREAM_ERROR: 'الموقع مش بيرد دلوقتي.',
  SITE_UNSAFE_URL: 'عنوان الموقع غير آمن للقراءة.',
}[note] ?? (note.startsWith('SITE_') ? 'مقدرناش نقرا الموقع.' : note))
