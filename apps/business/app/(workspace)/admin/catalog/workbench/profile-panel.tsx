'use client'

import * as React from 'react'
import { Button, Code, Field, Notice, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

type State = 'VERIFIED' | 'RULE_DERIVED' | 'UNKNOWN' | 'CONFLICT' | 'UNVERIFIED' | 'RECORDED'
interface FieldCoverage { field: string; status: State; reason: string | null; value: unknown; required: boolean; evidence: Array<{ url: string; tier: string; observedAt: string; excerpt: string }>; decisionRule: string | null }
interface Routine {
  primaryRole: string | null; primaryRoleStatus: State; secondaryRoles: Array<{ role: string; basis: string }>; routineDomain: string | null; stepOrder: number | null
  routinePeriod: string; routinePeriodStatus: State; periodEligibility: string | null; cadenceUnit: string; cadenceMin: number | null; cadenceMax: number | null; cadenceStatus: State
  rinseMode: string; rinseModeStatus: State; expectedRinseMode: string | null; contactMinutes: number | null; targetArea: string | null; targetAreaStatus: State
  activeIngredients: Array<{ inci: string; family: string; featured: boolean; concentration: { value: number; unit: string } | null; concentrationStatus: State }>
  featuredIngredients: Array<{ concept: string; inci: string | null; status: State; basis: string; function?: string | null; kind?: string }>
  prerequisites: Array<{ relation: 'AFTER' | 'BEFORE' | 'REPLACES' | 'UNDETERMINED'; role: string; status: State; basis: string; excerpt?: string }>; sequencingRules: Array<{ rule: string; detail: string; requiresReview: boolean }>
  suitability: { concerns?: Array<{ concern: string; medicalClaim: boolean; excerpt: string; source: string | null }>; benefits?: Array<{ text: string; medicalClaim: boolean }> }
  fieldStatus: { inciCompleteness?: string } & Record<string, unknown>
  cautions: Array<{ kind: string; text: string; status: State; source: string | null }>; conflicts: Array<{ field: string; reason: string; severity: string }>; ruleVersion: string; computedAt: string
}
interface SkuProfile {
  identity: { brand: { id: string; name: string }; product: string; productLine: string | null; variant: string; code: string; size: number | null; sizeUnit: string | null; packCount: number
    barcode: { value: string | null; status: string }; identityStatus: string; identitySources: string[]; hasOuterCarton: boolean | null }
  classification: { category: { name: string } | null; productType: string | null; productSubtype: string | null; detail: { status?: string; categoryResolution?: { basis?: string; stated?: string | null } | null } | null }
  composition: { inci: Array<{ inci: string; function: string | null; family: string | null; concentration: string | null; concentrationStatus: string }>; fragranceFree: { value: boolean | null; status: State }; texture: { value: string | null; status: State } }
  usage: { instructions: string | null; targetArea: string | null }
  suitability: { skinTypes: string[]; hairTypes: string[]; concerns: string[] }
  safety: { warnings: Array<{ kind: string; text: string | null; sourceUrl: string | null; sourceType: string | null }> }
  routine: Routine | null
  media: Array<{ id: string; role: string; parent: string | null; review: string; processing: string; note: string | null; error: string | null; width: number | null; height: number | null; source: string; publisher: string; warnings: string[] }>
  sources: Array<{ url: string; tier: string; outcome: string; fetchedAt?: string }>
  coverage: Record<string, FieldCoverage[]>
  summary: { verified: string[]; unknown: string[]; unverified: string[]; conflict: string[]; requiredMissing: string[] }
  openExceptions: Array<{ id: string; reasonCode: string; severity: string; field: string | null; summary: string }>
  publication: { ready: boolean; blockers: string[]; warnings: string[] }
}
type Researched = { value: unknown; status: State; basis: string; source?: string | null; excerpt?: string | null; note?: string }
interface BrandRange { basis: string; note: string; sources: Array<{ url: string; tier: string; outcome: string; products: number }>; domains: string[]
  productTypes: Array<{ value: string; products: number }>; lines: Array<{ value: string; products: number }>; products: Array<{ name: string; productType: string | null; tier: string }> }
interface BrandProfile2 {
  name: string; updatedAt: string
  profile: { identity: Record<string, Researched>; range: BrandRange; inShinaCare: { note: string; categories: Array<{ value: string; products: number }>; productTypes: Array<{ value: string; products: number }> }
    sources: string[]; coverage: { verifiedProducts: number; researched: boolean; rangeProductsListed: number; unknown: string[] } }
}

const STATE: Record<State, { tone: 'ok' | 'warn' | 'danger' | 'info' | 'pending' | 'neutral'; label: string }> = {
  VERIFIED: { tone: 'ok', label: 'مؤكدة من مصدر' }, RECORDED: { tone: 'neutral', label: 'مسجلة' }, RULE_DERIVED: { tone: 'info', label: 'قاعدة النظام' },
  UNKNOWN: { tone: 'pending', label: 'غير معروفة' }, UNVERIFIED: { tone: 'warn', label: 'مش مؤكدة' }, CONFLICT: { tone: 'danger', label: 'تعارض' },
}
const FIELDS: Record<string, string> = {
  'identity.name': 'اسم المنتج', 'identity.brand': 'الماركة', 'identity.gtin': 'الباركود', 'identity.size': 'الحجم', 'composition.inci': 'المكونات (INCI)', 'composition.activeConcentrations': 'تركيز المواد الفعالة',
  'composition.fragrance': 'العطر', 'attributes.texture': 'القوام', 'usage.instructions': 'طريقة الاستخدام', 'usage.routinePeriod': 'صباحًا أو مساءً', 'usage.targetArea': 'منطقة الاستخدام',
  'suitability.skinTypes': 'أنواع البشرة', 'suitability.hairTypes': 'أنواع الشعر', 'safety.warnings': 'التحذيرات', 'marketing.description': 'وصف الشركة', 'claims.manufacturerStated': 'ادعاءات الشركة',
}
const GROUPS: Record<string, string> = { identity: 'الهوية', composition: 'التركيبة', usage: 'الاستخدام', suitability: 'الملاءمة', safety: 'الأمان', marketing: 'الوصف' }
const REASONS: Record<string, string> = {
  NOT_STATED_ON_SOURCES_READ: 'المصادر اللي اتقرت ماذكرتهاش', NOT_RESEARCHED: 'لسه ماتبحثش', RETAILER_ONLY_OR_NOT_APPLIED: 'مذكورة عند بائع بس أو ماتطبقتش',
  APPLIED_TEXT_IS_A_DESCRIPTION_NOT_AN_INSTRUCTION: 'النص المحفوظ وصف تسويقي مش تعليمات استخدام',
}
const ROLES: Record<string, string> = {
  MAKEUP_REMOVER: 'مزيل مكياج', CLEANSER: 'غسول', EXFOLIANT: 'مقشر', TONER: 'تونر', FACE_MASK: 'ماسك وجه', SERUM: 'سيروم', TREATMENT: 'علاج موضعي', EYE_CARE: 'عناية بالعين',
  MOISTURIZER: 'مرطب', SUNSCREEN: 'واقي شمس', LIP_CARE: 'عناية بالشفايف', HAIR_WASH: 'شامبو', CONDITIONER: 'بلسم', HAIR_MASK: 'ماسك شعر', LEAVE_IN: 'ليف إن',
  HAIR_TREATMENT: 'علاج شعر', HAIR_STYLING: 'تصفيف', BODY_WASH: 'غسول جسم', BODY_MOISTURIZER: 'مرطب جسم',
}
const TYPES: Record<string, string> = {
  shampoo: 'شامبو', conditioner: 'بلسم', 'leave-in': 'ليف إن', 'hair-mask': 'ماسك شعر', 'hair-oil': 'زيت شعر', 'hair-serum': 'سيروم شعر', 'hair-styling': 'تصفيف شعر', 'makeup-remover': 'مزيل مكياج',
  cleanser: 'غسول', 'body-wash': 'غسول جسم', toner: 'تونر', serum: 'سيروم', sunscreen: 'واقي شمس', 'eye-care': 'عناية بالعين', exfoliant: 'مقشر', 'face-mask': 'ماسك وجه', moisturizer: 'مرطب',
  'body-moisturizer': 'مرطب جسم', 'lip-care': 'عناية بالشفايف',
}
const BLOCKERS: Record<string, string> = {
  IDENTITY_INCOMPLETE: 'الحجم أو الوحدة أو النوع ناقص', IDENTITY_NOT_VERIFIED: 'الهوية لسه ماتأكدتش', CATEGORY_MISSING: 'من غير قسم', NO_REVIEWED_FACTS: 'مفيش معلومة مؤكدة',
  CRITICAL_EXCEPTION_OPEN: 'استثناء حرج مفتوح', FACT_CONFLICT_UNRESOLVED: 'تعارض بين المصادر', CRITICAL_FACT_NOT_REVIEWED: 'معلومة أساسية مستنية', PRIMARY_PACKSHOT_NOT_APPROVED: 'مفيش صورة أصلية معتمدة',
  CARTON_DECISION_MISSING: 'قرار العلبة الخارجية ناقص', CARTON_PROOF_NOT_APPROVED: 'صورة العلبة مش معتمدة', LISTING_NOT_ACTIVE: 'مش معروض للبيع', SELLING_PRICE_MISSING: 'مفيش سعر بيع',
}
const BASIS: Record<string, string> = { STATED_LABEL: 'من خانة القسم في الملف', STATED_PARENT_AND_TYPE: 'القسم الرئيسي من الملف + نوع المنتج من الاسم', PRODUCT_TYPE: 'من نوع المنتج في الاسم', NONE: 'غير محدد' }
const PLACEMENT: Record<string, string> = { AFTER: 'بعد', BEFORE: 'قبل', REPLACES: 'بدل', UNDETERMINED: 'مع (الترتيب غير محدد)' }
const CONCERNS: Record<string, string> = {
  dryness: 'الجفاف', barrier: 'حاجز البشرة', sensitivity: 'الحساسية', acne_blemishes: 'الحبوب', rough_texture: 'الملمس الخشن', oiliness: 'الدهون', hyperpigmentation: 'التصبغات',
  aging: 'علامات التقدم في السن', hair_loss_thinning: 'تساقط وضعف الشعر', breakage_strength: 'تقصف الشعر', dandruff_scalp: 'القشرة وفروة الرأس', frizz: 'الهيشان', damage_repair: 'الشعر التالف',
}
const PERIOD: Record<string, string> = { AM: 'صباحًا', PM: 'مساءً', BOTH: 'صباحًا ومساءً', UNKNOWN: 'غير معروف' }
const RINSE: Record<string, string> = { RINSE_OFF: 'بيتشطف', LEAVE_ON: 'بيتساب على البشرة/الشعر', UNKNOWN: 'غير معروف' }
const CADENCE: Record<string, string> = { DAY: 'في اليوم', WEEK: 'في الأسبوع', AS_NEEDED: 'عند الحاجة', UNKNOWN: 'غير معروف' }

function Badge({ state }: { state: State }) {
  const s = STATE[state] ?? STATE.UNKNOWN
  return <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
}
function Row({ label, value, state, note }: { label: string; value: React.ReactNode; state?: State; note?: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-bw-line py-2 last:border-b-0 md:grid-cols-[12rem_1fr_auto] md:items-start">
      <dt className="font-semibold">{label}</dt>
      <dd className="text-bw-small" dir="auto">{value}{note ? <p className="text-bw-ink-soft">{note}</p> : null}</dd>
      {state ? <dd><Badge state={state} /></dd> : null}
    </div>
  )
}
function Group({ title, count, open, children }: { title: string; count?: React.ReactNode; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="rounded-bw-field border border-bw-line p-3" open={open}>
      <summary className="cursor-pointer font-semibold">{title}{count !== undefined ? <span className="ms-2 text-bw-small font-normal text-bw-ink-soft">{count}</span> : null}</summary>
      <dl className="mt-2">{children}</dl>
    </details>
  )
}
const Link = ({ url }: { url: string }) => <a className="underline" href={url} target="_blank" rel="noreferrer" dir="ltr"><bdi>{url}</bdi></a>
const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join('، ')
  if (typeof value === 'object') { const size = value as { value?: number; unit?: string }; return size.value !== undefined ? `${size.value} ${size.unit}` : JSON.stringify(value) }
  return String(value)
}

/** What the catalog actually knows about one SKU and its brand, with the status of every field: verified, rule-derived, unknown or in conflict. */
export function ProfilePanel({ skuId }: { skuId: string }) {
  const { data, error, loading, reload } = useApi<SkuProfile>(`/catalog/workbench/skus/${skuId}/profile`)
  const rebuild = useCommand(() => api(`/catalog/workbench/skus/${skuId}/profile/rebuild`, { body: {} }))
  if (error) return <LoadError message={error.message} onRetry={reload} />
  if (!data) return loading ? <Skeleton className="h-40 w-full" /> : null
  const { identity, classification, composition, routine, summary } = data
  const total = summary.verified.length + summary.unknown.length + summary.unverified.length + summary.conflict.length
  return (
    <Section title="ملف المنتج الكامل" aside={<span className="text-bw-small text-bw-ink-soft">كل خانة عليها حالتها: مؤكدة من مصدر، قاعدة النظام، غير معروفة، أو تعارض. اللي مش مذكور بيفضل غير معروف ومش بيفتح مراجعة.</span>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-bw-small">
          <StatusLabel tone="ok">{summary.verified.length} مؤكدة</StatusLabel>
          <StatusLabel tone="pending">{summary.unknown.length} غير معروفة</StatusLabel>
          {summary.unverified.length ? <StatusLabel tone="warn">{summary.unverified.length} مش مؤكدة</StatusLabel> : null}
          {summary.conflict.length ? <StatusLabel tone="danger">{summary.conflict.length} تعارض</StatusLabel> : null}
          <span className="text-bw-ink-soft">من {total} خانة</span>
          <Button type="button" variant="secondary" loading={rebuild.pending} onClick={async () => { if (await rebuild.execute()) reload() }}>إعادة حساب الملف</Button>
        </div>
        <CommandError error={rebuild.error} />
        {data.openExceptions.length ? <Notice tone="danger" title="استثناءات حرجة مفتوحة"><ul className="list-disc ps-5">{data.openExceptions.map(e => <li key={e.id}><Code>{e.reasonCode}</Code> {e.summary}</li>)}</ul></Notice> : null}
        {summary.requiredMissing.length ? <Notice tone="warn" title="ناقص ولازم للنشر"><ul className="list-disc ps-5">{summary.requiredMissing.map(f => <li key={f}>{FIELDS[f] ?? f}</li>)}</ul></Notice> : null}

        <Group title="الهوية والتحقق" open>
          <Row label="المنتج" value={<bdi>{identity.brand.name} — {identity.product}{identity.productLine ? ` · ${identity.productLine}` : ''}</bdi>} />
          <Row label="الحجم والنوع" value={<bdi dir="ltr">{identity.size ?? '—'} {identity.sizeUnit ?? ''} · {identity.variant}{identity.packCount > 1 ? ` · ×${identity.packCount}` : ''}</bdi>} />
          <Row label="الهوية" value={identity.identityStatus} state={identity.identityStatus === 'UNVERIFIED' ? 'UNKNOWN' : 'VERIFIED'}
            note={identity.identitySources.length ? <>اتأكدت من: {identity.identitySources.map(url => <span key={url} className="me-2"><Link url={url} /></span>)}</> : 'مفيش صفحة أكدت الهوية'} />
          <Row label="الباركود" value={<Code>{identity.barcode.value ?? '—'}</Code>} state={identity.barcode.status === 'VERIFIED' ? 'VERIFIED' : identity.barcode.status === 'CONFLICT' ? 'CONFLICT' : 'UNKNOWN'}
            note={identity.barcode.status === 'VERIFIED' ? 'مؤكد من الشركة المصنعة' : 'باركود الملفات ادعاء ومش بيتسجل كمؤكد'} />
          <Row label="الكود" value={<Code>{identity.code}</Code>} />
        </Group>

        <Group title="التصنيف">
          <Row label="القسم" value={classification.category?.name ?? '—'} state={classification.category ? 'VERIFIED' : 'UNKNOWN'}
            note={classification.detail?.categoryResolution?.basis ? `اتحدد ${BASIS[classification.detail.categoryResolution.basis] ?? classification.detail.categoryResolution.basis}` : null} />
          <Row label="نوع المنتج" value={classification.productType ? `${TYPES[classification.productType] ?? classification.productType}${classification.productSubtype ? ` · ${classification.productSubtype}` : ''}` : '—'}
            state={(classification.detail?.status as State | undefined) ?? 'UNKNOWN'} note="من اسم المنتج وقسمه بقاعدة ثابتة، مش ادعاء من الشركة" />
        </Group>

        <Group title="المكونات والمواد الفعالة" count={`${composition.inci.length} مكون`}>
          <Row label="قائمة INCI" value={composition.inci.length ? composition.inci.map(i => i.inci).join('، ') : '—'} state={composition.inci.length ? 'VERIFIED' : 'UNKNOWN'} />
          {routine?.activeIngredients.length ? routine.activeIngredients.map(a => (
            <Row key={a.inci} label={`مادة فعالة · ${a.family}`} value={<bdi>{a.inci}{a.concentration ? ` · ${a.concentration.value}${a.concentration.unit}` : ''}</bdi>} state={a.concentrationStatus}
              note={a.featured ? 'الشركة بتبرزها في اسم المنتج' : 'موجودة في المكونات بس من غير تركيز معلن: مش علاج'} />
          )) : <Row label="مواد فعالة" value="مفيش مادة فعالة في المكونات المؤكدة" />}
          {routine?.featuredIngredients.map(f => f.kind === 'MANUFACTURER_KEY_INGREDIENT'
            ? <Row key={`k-${f.concept}`} label={`مكون أساسي حسب الشركة · ${f.concept}`} value={f.function ?? '—'} state="VERIFIED" note="ادعاء الشركة عن المكون، مش قائمة المكونات الكاملة" />
            : <Row key={f.concept} label={`مكون مذكور في الاسم · ${f.concept}`} value={f.inci ?? '—'} state={f.status} />)}
          {routine?.fieldStatus.inciCompleteness === 'AS_STATED_POSSIBLY_PARTIAL' ? <Row label="اكتمال قائمة المكونات" value="القائمة زي ما المصدر كتبها، ممكن تكون ناقصة (مش بتبدأ بالماء)" state="UNVERIFIED" /> : null}
          <Row label="العطر" value={composition.fragranceFree.value === null ? '—' : composition.fragranceFree.value ? 'بدون عطر' : 'فيه عطر'} state={composition.fragranceFree.status} />
          <Row label="القوام" value={composition.texture.value ?? '—'} state={composition.texture.status} />
        </Group>

        <Group title="الاستخدام والروتين" open>
          {routine ? <>
            <Row label="الدور في الروتين" value={<>{routine.primaryRole ? ROLES[routine.primaryRole] ?? routine.primaryRole : '—'}{routine.stepOrder ? <> · خطوة رقم <bdi>{routine.stepOrder}</bdi></> : null}</>} state={routine.primaryRoleStatus}
              note={routine.secondaryRoles.length ? `أدوار إضافية: ${routine.secondaryRoles.map(r => `${ROLES[r.role] ?? r.role} (${r.basis})`).join('، ')}` : null} />
            <Row label="شطف أم ترك" value={RINSE[routine.rinseMode] ?? routine.rinseMode} state={routine.rinseModeStatus} note={routine.expectedRinseMode ? `المتوقع للنوع ده: ${RINSE[routine.expectedRinseMode]}` : null} />
            <Row label="صباحًا أو مساءً (الشركة)" value={PERIOD[routine.routinePeriod] ?? routine.routinePeriod} state={routine.routinePeriodStatus} />
            <Row label="توقيت حسب قاعدة النظام" value={routine.periodEligibility ? PERIOD[routine.periodEligibility] : 'مفيش قاعدة بتحدد وقت'} state="RULE_DERIVED" note="إرشاد عام، مش تعليمات الشركة" />
            <Row label="عدد المرات" value={routine.cadenceUnit === 'UNKNOWN' ? 'غير معروف' : <bdi>{routine.cadenceMin ?? ''}{routine.cadenceMax && routine.cadenceMax !== routine.cadenceMin ? `–${routine.cadenceMax}` : ''} {CADENCE[routine.cadenceUnit]}</bdi>} state={routine.cadenceStatus} />
            <Row label="مدة الترك" value={routine.contactMinutes !== null ? <bdi>{routine.contactMinutes} دقيقة</bdi> : '—'} state={routine.contactMinutes !== null ? 'VERIFIED' : 'UNKNOWN'} />
            <Row label="منطقة الاستخدام" value={routine.targetArea ?? '—'} state={routine.targetAreaStatus} />
            {routine.prerequisites.map((p, i) => <Row key={i} label={PLACEMENT[p.relation] ?? p.relation} value={ROLES[p.role] ?? p.role} state={p.status}
              note={p.excerpt ? <bdi dir="ltr">“{p.excerpt}”</bdi> : p.status === 'UNKNOWN' ? 'الترتيب ده بيختلف حسب التركيبة والتعليمات ماقالتش' : p.basis} />)}
            {routine.sequencingRules.map((r, i) => <Row key={i} label="ترتيب" value={r.detail} state="RULE_DERIVED" note={r.requiresReview ? 'إرشاد عام عن فئة المكون، يحتاج مراجعة تحريرية قبل عرضه للعميل' : null} />)}
            {routine.conflicts.map((c, i) => <Row key={i} label={`تعارض · ${c.field}`} value={c.reason} state="CONFLICT" note={c.severity === 'CRITICAL' ? 'حرج' : null} />)}
            <p className="pt-2 text-bw-small text-bw-ink-soft">قواعد <Code>{routine.ruleVersion}</Code> · اتحسب {formatDateTime(routine.computedAt)}</p>
          </> : <StateBlock kind="empty" title="لسه مفيش ملف روتين" body="اضغط إعادة حساب الملف بعد قراءة المصادر." />}
          <Row label="التعليمات المحفوظة" value={<span className="whitespace-pre-line">{data.usage.instructions ?? '—'}</span>} />
        </Group>

        <Group title="الاهتمامات والفوائد (ادعاءات الشركة)" count={routine?.suitability.concerns?.length || undefined}>
          {routine?.suitability.concerns?.length ? routine.suitability.concerns.map(c => <Row key={c.concern} label={CONCERNS[c.concern] ?? c.concern} value={<bdi dir="auto">{c.excerpt}</bdi>} state="VERIFIED"
            note={c.medicalClaim ? 'صياغة علاجية: ادعاء من الشركة، مش بيتنشر كفايدة مؤكدة' : 'ادعاء من الشركة، مش فعالية مثبتة'} />)
            : <Row label="الاهتمامات" value="الشركة ماذكرتش اهتمامات في المصادر اللي اتقرت" state="UNKNOWN" />}
        </Group>

        <Group title="التحذيرات وموانع الاستخدام" count={(routine?.cautions.length ?? data.safety.warnings.length) || undefined}>
          {(routine?.cautions ?? []).length ? routine!.cautions.map((c, i) => <Row key={i} label={c.kind} value={c.text} state={c.status} note={c.source ? <Link url={c.source} /> : c.status === 'RULE_DERIVED' ? 'إرشاد عام عن فئة المكون، مش تحذير من الشركة' : null} />)
            : <Row label="تحذيرات" value="الشركة ماذكرتش تحذيرات في المصادر اللي اتقرت" state="UNKNOWN" />}
        </Group>

        <Group title="الصور وجودتها" count={`${data.media.length} صورة`}>
          {data.media.length ? data.media.map(m => <Row key={m.id} label={m.parent ? 'صورة SAHEL' : m.role} value={<>{m.review}{m.width ? <> · <Code>{m.width}×{m.height}</Code></> : null} · <Link url={m.source} /></>}
            state={m.review === 'APPROVED' ? 'VERIFIED' : m.review === 'REJECTED' ? 'CONFLICT' : 'UNKNOWN'} note={[m.note, m.error, ...m.warnings].filter(Boolean).join(' · ') || null} />)
            : <Row label="الصور" value="مفيش صورة أصلية من مصدر موثوق بدقة كافية؛ ماتعملتش صورة بديلة" state="UNKNOWN" />}
        </Group>

        <Group title="المصادر" count={`${data.sources.length}`}>
          {data.sources.length ? data.sources.map((s, i) => <Row key={i} label={s.tier} value={<Link url={s.url} />} note={`${s.outcome}${s.fetchedAt ? ` · ${formatDateTime(s.fetchedAt)}` : ''}`} />) : <Row label="المصادر" value="لسه ماتقراش مصدر" />}
        </Group>

        <Group title="التغطية والناقص" count={`${summary.verified.length}/${total}`}>
          {Object.entries(data.coverage).map(([group, fields]) => (
            <div key={group} className="py-1">
              <p className="pt-2 font-semibold">{GROUPS[group] ?? group}</p>
              {fields.map(f => <Row key={f.field} label={FIELDS[f.field] ?? f.field} value={show(f.value)} state={f.status}
                note={<>{f.reason ? REASONS[f.reason] ?? f.reason : null}{f.evidence[0] ? <> · <Link url={f.evidence[0].url} /></> : null}{f.required ? ' · مطلوبة للنشر' : ''}</>} />)}
            </div>
          ))}
        </Group>

        <Group title="موانع النشر" count={data.publication.blockers.length}>
          {data.publication.blockers.length ? data.publication.blockers.map(b => <Row key={b} label={BLOCKERS[b] ?? b} value={<Code>{b}</Code>} />) : <Row label="جاهز" value="مفيش موانع" state="VERIFIED" />}
        </Group>

        <BrandProfilePanel brandId={identity.brand.id} />
      </div>
    </Section>
  )
}

function BrandProfilePanel({ brandId }: { brandId: string }) {
  const { data, error, reload } = useApi<BrandProfile2>(`/catalog/workbench/brands/${brandId}/profile`)
  const [form, setForm] = React.useState({ websiteUrl: '', ownerPageUrl: '', rangeUrls: '' })
  const research = useCommand(() => api(`/catalog/workbench/brands/${brandId}/research`, { body: {
    ...(form.websiteUrl.trim() ? { websiteUrl: form.websiteUrl.trim() } : {}), ...(form.ownerPageUrl.trim() ? { ownerPageUrl: form.ownerPageUrl.trim() } : {}),
    ...(form.rangeUrls.trim() ? { rangeUrls: form.rangeUrls.split(/\s+/).filter(Boolean).slice(0, 4) } : {}),
  } }))
  if (error) return <LoadError message={error.message} onRetry={reload} />
  if (!data) return <Skeleton className="h-10 w-full" />
  const { identity, range, inShinaCare, coverage } = data.profile
  const LABELS: Record<string, string> = { canonicalName: 'الاسم المعتمد', aliases: 'الأسماء البديلة', officialWebsite: 'الموقع الرسمي', countryOfOrigin: 'بلد المنشأ', parentCompany: 'الشركة المالكة / المصنعة',
    manufacturerCountry: 'بلد الشركة المصنعة', description: 'الوصف والتموضع', logo: 'الشعار' }
  const TIERS: Record<string, string> = { OFFICIAL_BRAND_SITE: 'موقع الماركة', OWNER_SITE: 'موقع الشركة المالكة', TRUSTED_DISTRIBUTOR: 'موزع معتمد', OTHER: 'مصدر آخر' }
  const valid = [form.websiteUrl, form.ownerPageUrl, ...form.rangeUrls.split(/\s+/)].some(u => u.trim().startsWith('https://'))
  return (
    <Group title={`ملف الماركة · ${data.name}`} count={coverage.researched ? `${coverage.rangeProductsListed} منتج في تشكيلة الماركة` : 'لسه ماتبحثتش'}>
      {Object.entries(identity).map(([key, item]) => <Row key={key} label={LABELS[key] ?? key} value={show(item.value)} state={item.status}
        note={<>{item.source ? <Link url={item.source} /> : null}{item.note ? ` · ${item.note}` : ''}{item.status === 'UNKNOWN' ? ` · ${item.basis}` : ''}</>} />)}
      <p className="pt-3 font-semibold">تشكيلة الماركة من مصادرها</p>
      <Row label="الأنواع" value={range.productTypes.map(t => `${TYPES[t.value] ?? t.value} (${t.products})`).join('، ') || '—'} state={range.productTypes.length ? 'VERIFIED' : 'UNKNOWN'} note={range.note} />
      <Row label="خطوط المنتجات" value={range.lines.map(l => `${l.value} (${l.products})`).join('، ') || '—'} state={range.lines.length ? 'VERIFIED' : 'UNKNOWN'} note="أسماء متكررة في قائمة الماركة" />
      {range.sources.map(s => <Row key={s.url} label={TIERS[s.tier] ?? s.tier} value={<Link url={s.url} />} note={`${s.outcome} · ${s.products} منتج`} />)}
      <details className="py-1 text-bw-small"><summary className="cursor-pointer">المنتجات المذكورة ({range.products.length})</summary>
        <ul className="list-disc ps-5">{range.products.map(product => <li key={product.name}><bdi>{product.name}</bdi> {product.productType ? `· ${TYPES[product.productType] ?? product.productType}` : ''}</li>)}</ul></details>
      <p className="pt-3 font-semibold">اللي عندنا في شينا كير</p>
      <Row label="الأقسام" value={inShinaCare.categories.map(c => `${c.value} (${c.products})`).join('، ') || '—'} note={inShinaCare.note} />
      <form className="mt-3 grid gap-2 md:grid-cols-3 md:items-end" onSubmit={async (e) => { e.preventDefault(); if (await research.execute()) reload() }}>
        <Field label="موقع الماركة الرسمي" ltr value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} />
        <Field label="صفحة الشركة المالكة (من نحن)" ltr value={form.ownerPageUrl} onChange={(e) => setForm({ ...form, ownerPageUrl: e.target.value })} />
        <Field label="صفحات تشكيلة الماركة (مسافة بين الروابط)" ltr value={form.rangeUrls} onChange={(e) => setForm({ ...form, rangeUrls: e.target.value })} />
        <Button type="submit" variant="secondary" loading={research.pending} disabled={!valid}>بحث عن الماركة من المصادر</Button>
      </form>
      <CommandError error={research.error} />
      <p className="pt-2 text-bw-small text-bw-ink-soft">آخر تحديث {formatDateTime(data.updatedAt)}</p>
    </Group>
  )
}
