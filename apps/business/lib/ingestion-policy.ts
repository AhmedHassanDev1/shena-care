/** UI draft and transport helpers. Eligibility decisions remain on the server. */
export type Effect = 'ALLOW' | 'DENY'
export type Brand = { id: string; name: string; isActive: boolean; effect: Effect | null; aliases: string[] }
export type Category = { id: string; name: string; slug?: string; parentId: string | null; isActive: boolean; effect: Effect | null; aliases?: string[] }
export type Mapping = { supplierId: string; label: string; categoryIds: string[] }
export type PolicyDocument = { brands: Brand[]; categories: Category[]; mappings: Mapping[] }
export type Policy = { id: string; version: number | null; baseVersion: number; document: PolicyDocument; reason: string; actorId: string; approvedAt: string | null;
  impact: { existingOffersAffected: number; existingOffersChanged: number; acceptedOrdersChanged: number } }
export type Options = { brands: Brand[]; categories: Category[]; suppliers: Array<{ id: string; name: string }> }
export type HoldGroup = { supplierId: string; brandKey: string; categoryKey: string; count: number; jobCount: number; reasons: string[];
  examples: Array<{ jobId: string; sourceRow: number; brand: string; category: string; name: string }>;
  suggestions: Array<{ brandId: string; name: string; score: number; effect: Effect | null }> }
export type GroupResponse = { groups: HoldGroup[]; totalGroups: number; totalRows: number; limit: number }
export type Change = { key: string; kind: 'brand' | 'category' | 'mapping'; name: string; before: string; after: string; supplierId?: string }
export const cleanAliases = (aliases: string[]) => [...new Set(aliases.map(a => a.trim()).filter(Boolean))]
export const effectLabel = (effect: Effect | null) => effect === 'ALLOW' ? 'مسموح' : effect === 'DENY' ? 'منع صريح' : 'غير مفعّل'
export const searchLabel = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\u064B-\u065F\u0670ـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, '')
const sameAliases = (a: string[], b: string[]) => JSON.stringify(cleanAliases(a).sort()) === JSON.stringify(cleanAliases(b).sort())
const mappingKey = (m: Mapping) => `${m.supplierId}:${m.label}`
const sameTargets = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

export function createDraft(current: Pick<Policy, 'document'> | null, options: Options): PolicyDocument {
  const brands = new Map(current?.document.brands.map(b => [b.id, b]))
  const categories = new Map(current?.document.categories.map(c => [c.id, c]))
  return {
    brands: options.brands.map(b => ({ ...b, effect: brands.get(b.id)?.effect ?? null, aliases: [...(brands.get(b.id)?.aliases ?? [])] })),
    categories: options.categories.map(c => ({ ...c, effect: categories.get(c.id)?.effect ?? null, aliases: [...(categories.get(c.id)?.aliases ?? [])] })),
    mappings: (current?.document.mappings ?? []).map(m => ({ ...m, categoryIds: [...m.categoryIds] })),
  }
}
export function policyChanges(current: Pick<Policy, 'document'> | null, draft: PolicyDocument): Change[] {
  const changes: Change[] = []
  for (const kind of ['brand', 'category'] as const) {
    const plural = kind === 'brand' ? 'brands' : 'categories'
    const old = new Map((current?.document[plural] ?? []).map(b => [b.id, b]))
    for (const item of draft[plural]) {
      const previous = old.get(item.id)
      const aliasChanged = !sameAliases(item.aliases ?? [], previous?.aliases ?? [])
      if (item.effect !== (previous?.effect ?? null) || aliasChanged) changes.push({ key: `${kind}:${item.id}`, kind, name: item.name,
        before: effectLabel(previous?.effect ?? null), after: `${effectLabel(item.effect)}${aliasChanged ? ` · الأسماء: ${cleanAliases(item.aliases ?? []).join('، ') || 'بدون أسماء إضافية'}` : ''}` })
    }
  }
  const old = new Map((current?.document.mappings ?? []).map(m => [mappingKey(m), m]))
  const next = new Map(draft.mappings.map(m => [mappingKey(m), m]))
  const names = (ids: string[]) => ids.map(id => draft.categories.find(c => c.id === id)?.name ?? id).join('، ')
  for (const [key, m] of next) {
    const previous = old.get(key)
    if (!previous || !sameTargets(previous.categoryIds, m.categoryIds)) changes.push({ key, kind: 'mapping', supplierId: m.supplierId, name: m.label, before: previous ? names(previous.categoryIds) : 'بدون ربط', after: names(m.categoryIds) })
  }
  for (const [key, m] of old) if (!next.has(key)) changes.push({ key, kind: 'mapping', supplierId: m.supplierId, name: m.label, before: names(m.categoryIds), after: 'إزالة الربط' })
  return changes
}
export function previewRequest(current: Pick<Policy, 'document' | 'version'> | null, draft: PolicyDocument, reason: string) {
  const oldBrand = new Map(current?.document.brands.map(b => [b.id, b]))
  const oldCategory = new Map(current?.document.categories.map(c => [c.id, c]))
  const rulesChanged = draft.brands.some(b => b.effect !== (oldBrand.get(b.id)?.effect ?? null)) || draft.categories.some(c => c.effect !== (oldCategory.get(c.id)?.effect ?? null))
  const unknownAliasTarget = draft.brands.some(b => !oldBrand.has(b.id) && cleanAliases(b.aliases).length) || draft.categories.some(c => !oldCategory.has(c.id) && cleanAliases(c.aliases ?? []).length)
  const namesOnly = current && !rulesChanged && !unknownAliasTarget
  return { path: `/ingestion/eligibility/${namesOnly ? 'mappings/preview' : 'preview'}`, body: {
    expectedVersion: current?.version ?? 0, reason: reason.trim(),
    brands: draft.brands.filter(b => namesOnly ? oldBrand.has(b.id) : b.effect || cleanAliases(b.aliases).length).map(b => ({ id: b.id, ...(!namesOnly ? { effect: b.effect } : {}), aliases: cleanAliases(b.aliases) })),
    categories: draft.categories.filter(c => namesOnly ? oldCategory.has(c.id) : c.effect || cleanAliases(c.aliases ?? []).length).map(c => ({ id: c.id, ...(!namesOnly ? { effect: c.effect } : {}), aliases: cleanAliases(c.aliases ?? []) })),
    mappings: draft.mappings,
  } }
}
/** Presentation grouping only; never grants eligibility or changes taxonomy. */
export function categoryGroup(category: Category, categories: Category[]): string {
  const byId = new Map(categories.map(c => [c.id, c]))
  const seen = new Set<string>()
  const ancestry: Category[] = []
  let current: Category | undefined = category
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    ancestry.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  for (const item of ancestry) {
    const text = `${item.slug ?? ''} ${item.name}`.toLowerCase()
    if (/hair|shampoo|conditioner|scalp|شعر|شامبو|بلسم|فرو[ةه]/.test(text)) return 'الشعر'
    if (/skin|facial|face|sunscreen|moistur|serum|بشر[ةه]|وجه|شمس|مرطب|سيروم/.test(text)) return 'البشرة'
  }
  return 'تصنيفات أخرى'
}
