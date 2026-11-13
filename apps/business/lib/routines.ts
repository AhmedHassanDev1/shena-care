/** Routine Studio (GLO-312): shared types and the pure helpers of the editor. The API owns every rule; this only shapes input. */

export type Timing = 'AM' | 'PM' | 'AS_NEEDED'
export const TIMINGS: Array<{ value: Timing; label: string }> = [
  { value: 'AM', label: 'صباحًا' }, { value: 'PM', label: 'مساءً' }, { value: 'AS_NEEDED', label: 'عند الحاجة' },
]
export const timingLabel = (timing: string) => TIMINGS.find((t) => t.value === timing)?.label ?? timing

export type ProductState = 'AVAILABLE' | 'UNAVAILABLE' | 'UNPUBLISHED' | 'INACTIVE' | 'MISSING' | 'UNKNOWN_VARIANT'
type Tone = 'ok' | 'warn' | 'danger' | 'neutral'
export const PRODUCT_STATE: Record<ProductState, [string, Tone]> = {
  AVAILABLE: ['متاح للطلب', 'ok'],
  UNAVAILABLE: ['غير متاح حاليًا', 'warn'],
  UNPUBLISHED: ['غير منشور', 'warn'],
  INACTIVE: ['متوقف في الكتالوج', 'danger'],
  MISSING: ['غير موجود', 'danger'],
  UNKNOWN_VARIANT: ['النوع غير محدد', 'neutral'],
}

export interface ProductView {
  skuId: string | null; productId: string; state: ProductState; productName: string | null; brandName: string | null
  skuCode: string | null; variantName: string | null; size: number | null; sizeUnit: string | null
  price: { amount: number; currency: string; compareAtAmount: number | null } | null
}
export interface StepView {
  id: string; order: number; timing: Timing | 'BOTH'; title: string; instructions: string | null; reason: string | null; isOptional: boolean
  product: ProductView | null; alternatives: ProductView[]
}
export interface RoutineView {
  id: string; title: string; titleEn: string | null; description: string | null; careArea: 'skin' | 'hair'; concernSlug: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'; version: number; references: Array<{ title: string; url: string }>
  publishedAt: string | null; updatedAt: string; steps: StepView[]
}
export interface RoutineListItem { id: string; title: string; status: RoutineView['status']; careArea: string; concernSlug: string | null; version: number; steps: number; updatedAt: string; publishedAt: string | null }
export interface Issue { path: string; code: string; message: string; severity: 'error' | 'warning' }

export const ROUTINE_STATUS: Record<RoutineView['status'], [string, Tone]> = {
  DRAFT: ['مسودة', 'neutral'], PUBLISHED: ['منشور', 'ok'], UNPUBLISHED: ['غير منشور', 'warn'],
}

/** One editor row: products are typed as an identifier the server resolves (never trusted client-side). */
export interface StepDraft { key: string; title: string; timing: Timing; instructions: string; isOptional: boolean; product: string; alternatives: string[] }
export interface RoutineDraft {
  title: string; titleEn: string; description: string; careArea: 'skin' | 'hair'; concernSlug: string
  references: Array<{ title: string; url: string }>; steps: StepDraft[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A pasted identifier → the one field the API expects: a UUID is a skuId, 8–14 digits a barcode, anything else a catalog code. */
export function productRef(identifier: string): { skuId: string } | { barcode: string } | { sku: string } {
  const value = identifier.trim()
  if (UUID.test(value)) return { skuId: value }
  if (/^\d{8,14}$/.test(value)) return { barcode: value }
  return { sku: value }
}

let counter = 0
export const newStep = (): StepDraft => ({ key: `s${Date.now()}-${counter++}`, title: '', timing: 'AM', instructions: '', isOptional: false, product: '', alternatives: [] })

export function draftFromView(view: RoutineView): RoutineDraft {
  return {
    title: view.title, titleEn: view.titleEn ?? '', description: view.description ?? '', careArea: view.careArea, concernSlug: view.concernSlug ?? '',
    references: view.references.length ? view.references : [{ title: '', url: '' }],
    steps: view.steps.map((step) => ({
      key: step.id, title: step.title, timing: step.timing === 'BOTH' ? 'AM' : step.timing, instructions: step.instructions ?? '', isOptional: step.isOptional,
      product: step.product?.skuCode ?? step.product?.skuId ?? '', alternatives: step.alternatives.map((alt) => alt.skuCode ?? alt.skuId ?? '').filter(Boolean),
    })),
  }
}

/** The body for POST/PUT /care/admin/studio/routines. Blank rows are dropped, never sent half-filled. */
export function bodyFromDraft(draft: RoutineDraft, expectedVersion?: number) {
  return {
    title: draft.title.trim(), ...(draft.titleEn.trim() ? { titleEn: draft.titleEn.trim() } : {}),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    careArea: draft.careArea, concernSlug: draft.concernSlug.trim(),
    references: draft.references.filter((r) => r.title.trim() && r.url.trim()).map((r) => ({ title: r.title.trim(), url: r.url.trim() })),
    steps: draft.steps.map((step) => ({
      title: step.title.trim(), timing: step.timing, ...(step.instructions.trim() ? { instructions: step.instructions.trim() } : {}), isOptional: step.isOptional,
      product: productRef(step.product),
      ...(step.alternatives.filter((a) => a.trim()).length ? { alternatives: step.alternatives.filter((a) => a.trim()).map(productRef) } : {}),
    })),
    ...(expectedVersion ? { expectedVersion } : {}),
  }
}

/** Moves a row one place; out-of-range moves leave the list unchanged. */
export function moveStep<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items
  const next = items.slice()
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** What blocks saving in the browser before the server says so (identifiers and titles are required). */
export function draftProblems(draft: RoutineDraft): string[] {
  const problems: string[] = []
  if (draft.title.trim().length < 3) problems.push('الاسم مطلوب')
  if (!draft.concernSlug.trim()) problems.push('اختر الاهتمام (concern)')
  if (!draft.steps.length) problems.push('أضف خطوة واحدة على الأقل')
  draft.steps.forEach((step, index) => {
    if (!step.title.trim()) problems.push(`الخطوة ${index + 1}: العنوان مطلوب`)
    if (!step.product.trim()) problems.push(`الخطوة ${index + 1}: المنتج الأساسي مطلوب`)
  })
  return problems
}

/** Issue paths like `$.steps[2].product` → the step index they belong to. */
export function issueStep(issue: Issue): number | null {
  const match = issue.path.match(/^\$\.steps\[(\d+)\]/)
  return match ? Number(match[1]) : null
}
