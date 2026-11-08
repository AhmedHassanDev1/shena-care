'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Page, Select, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useAuthedImage } from '@/lib/authed-image'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { ExceptionsQueue } from './exceptions-queue'
import { ProfilePanel } from './profile-panel'

interface SkuRow { skuId: string; productId: string; productName: string; brandName: string; code: string; variantName: string; size: number | null; sizeUnit: string | null; barcode: string | null; isPublished: boolean }
interface Evidence { sourceUrl: string; sourceTier: string; excerpt: string; observedAt: string; extractor: string }
interface Fact { id: string; field: string; value: unknown; status: string; confidence: number; evidence: Evidence[]; reviewNote: string | null; reviewedAt: string | null }
interface RunSource { url: string; tier: string; outcome: string; detail?: string; factCount?: number }
interface Run { id: string; status: string; startedAt: string; attempts: number; sources: RunSource[]; rejected: Array<{ field: string; reason: string; detail?: string; sourceUrl?: string }>; errorReason: string | null }
interface Asset {
  id: string; role: string; originType: string; parentAssetId: string | null; transformVersion: string | null; templateId: string | null; processingStatus: string; processingError: string | null
  reviewStatus: string; reviewNote: string | null; rightsStatus: string; sourceUrl: string; sourcePublisher: string; publishedMediaId: string | null; supersededAt: string | null; width: number | null; height: number | null
  qualityReport: { warnings?: string[]; coverage?: number; placementScale?: number; backgroundMode?: string } | null; createdAt: string
}
interface Template { id: string; templateKey: string; version: number; name: string; isActive: boolean }
interface Readiness {
  skuId: string; isPublished: boolean; ready: boolean; blockers: string[]; warnings: string[]; media: Record<string, string>
  facts: { total: number; applied: string[]; pending: string[]; conflicts: string[] }; commerce: { isListed: boolean; price: { amount: number; currency: string } | null }
}
interface Workbench {
  sku: { id: string; code: string; variantName: string; size: string | number | null; sizeUnit: string | null; barcode: string | null; hasOuterCarton: boolean | null
    product: { id: string; name: string; isPublished: boolean; description: string | null; usage: string | null; brand: { name: string; websiteUrl: string | null }; category: { name: string } | null
      productIngredients: Array<{ ingredient: { name: string } }>; safetyWarnings: Array<{ id: string; descriptionEn: string }> } }
  readiness: Readiness; assets: Asset[]; facts: Fact[]; runs: Run[]
}

const BLOCKERS: Record<string, string> = {
  IDENTITY_INCOMPLETE: 'الحجم أو الوحدة أو النوع ناقص', IDENTITY_NOT_VERIFIED: 'هوية المنتج لسه ماتأكدتش (لا صفحة رسمية ولا باركود مؤكد)', CATEGORY_MISSING: 'المنتج من غير قسم', NO_REVIEWED_FACTS: 'مفيش معلومة اتأكدت ووصلت الكتالوج',
  CRITICAL_EXCEPTION_OPEN: 'فيه استثناء حرج مفتوح على المنتج ده',
  FACT_CONFLICT_UNRESOLVED: 'فيه مصادر مختلفة على نفس المعلومة ولازم تختار', CRITICAL_FACT_NOT_REVIEWED: 'معلومة أساسية (هوية أو تركيبة أو أمان) لسه مستنية مراجعة',
  PRIMARY_PACKSHOT_NOT_APPROVED: 'مفيش صورة أصلية معتمدة للمنتج', CARTON_DECISION_MISSING: 'لسه ماتحددش المنتج بيتباع بعلبة خارجية ولا لأ', CARTON_PROOF_NOT_APPROVED: 'صورة العلبة الخارجية الحقيقية لسه مش معتمدة',
  LISTING_NOT_ACTIVE: 'لسه مش معروض للبيع', SELLING_PRICE_MISSING: 'مفيش سعر بيع معتمد',
}
const WARNINGS: Record<string, string> = { BARCODE_MISSING: 'مفيش باركود مؤكد (مش بيمنع النشر لو الهوية متأكدة من صفحة رسمية)', EDITORIAL_IMAGE_NOT_APPROVED: 'صورة صفحة المنتج لسه مش معتمدة', INGREDIENTS_NOT_REVIEWED: 'المكونات لسه مش متأكدة', USAGE_NOT_REVIEWED: 'طريقة الاستخدام لسه مش متأكدة' }
const FIELDS: Record<string, string> = {
  'identity.name': 'اسم المنتج', 'identity.brand': 'الماركة', 'identity.gtin': 'الباركود', 'identity.size': 'الحجم', 'composition.inci': 'المكونات (INCI)', 'composition.activeConcentrations': 'تركيز المواد الفعالة',
  'composition.fragrance': 'العطر', 'attributes.texture': 'القوام', 'usage.instructions': 'طريقة الاستخدام', 'usage.routinePeriod': 'صباحًا أو مساءً', 'usage.targetArea': 'منطقة الاستخدام',
  'suitability.skinTypes': 'أنواع البشرة', 'suitability.hairTypes': 'أنواع الشعر', 'safety.warnings': 'التحذيرات', 'marketing.description': 'وصف الشركة (تسويقي)', 'claims.manufacturerStated': 'ادعاءات الشركة (غير مؤكدة)', 'media.sourceImages': 'صور من المصدر',
}
const OUTCOMES: Record<string, string> = {
  OK: 'اتقرأت', ACCESS_DENIED: 'الموقع رفض الوصول', ROBOTS_DISALLOWED: 'الموقع مانع القراءة الآلية', HOST_NOT_APPROVED: 'الموقع مش في القائمة المعتمدة', NOT_FOUND: 'الصفحة مش موجودة', UNSAFE_URL: 'رابط غير آمن',
  TIMEOUT: 'انتهى الوقت', UPSTREAM_ERROR: 'الموقع فيه مشكلة', RATE_LIMITED: 'الموقع طلب تهدئة', CIRCUIT_OPEN: 'الموقع متوقف مؤقتًا بعد أعطال', WRONG_CONTENT_TYPE: 'مش صفحة', TOO_LARGE: 'الصفحة كبيرة جدًا', PENDING: 'لسه',
}
const REJECT_REASONS: Record<string, string> = {
  IDENTITY_MISMATCH: 'الصفحة عن منتج تاني', SIZE_MISMATCH: 'الصفحة عن حجم تاني', MULTIPLE_FORMULAS_ON_PAGE: 'أكتر من تركيبة في الصفحة', SIZE_NOT_CONFIRMED_BY_PAGE: 'الصفحة ماأكدتش الحجم', AMBIGUOUS_SIZE: 'أحجام متعددة', NOT_IN_THIS_FORMULA: 'تركيز لمادة مش في التركيبة دي',
}
const ROLES: Record<string, string> = { PRIMARY_PACKSHOT: 'صورة المنتج الأصلية', CATEGORY_EDITORIAL: 'صورة صفحة المنتج (SAHEL)', PACKAGING_PROOF: 'العلبة الخارجية', INGREDIENT_STORY: 'قصة المكونات', TEXTURE_SENSORY: 'القوام' }
const RIGHTS: Array<[string, string]> = [['UNKNOWN', 'غير معروف'], ['MANUFACTURER_PUBLISHED', 'منشورة من الشركة المصنعة'], ['AUTHORIZED_DISTRIBUTOR', 'موزع معتمد'], ['LICENSED', 'مرخصة'], ['OWN_CAPTURE', 'تصويرنا']]
const QUALITY: Record<string, string> = { TOUCHES_IMAGE_EDGE: 'المنتج لامس حافة الصورة وممكن يكون مقصوص', LOW_EDGE_CONTRAST: 'حواف المنتج قريبة من لون الخلفية', ENCLOSED_BACKGROUND: 'فيه مساحات فاتحة جوه المنتج، راجعها', UPSCALED: 'الصورة اتكبرت عن حجمها الأصلي', SOURCE_SHADOW_REMOVED: 'اتشال ظل قديم من الصورة الأصلية', SMALL_SOURCE: 'الصورة الأصلية صغيرة', DETACHED_PART: 'جزء من العبوة اتفصل', UPSCALED_SMALL_SOURCE: 'صورة صغيرة اتكبرت أكتر من اللازم' }
const PROCESSING_ERRORS: Record<string, string> = { BACKGROUND_NOT_PLAIN: 'خلفية الصورة مش سادة، استخدم صورة على خلفية بيضاء أو شفافة', NO_PRODUCT_FOUND: 'مالقيناش منتج في الصورة', BACKGROUND_NOT_REMOVED: 'تعذر فصل الخلفية', PRODUCT_RESOLUTION_TOO_LOW: 'دقة الصورة قليلة جدًا' }

const display = (value: unknown): string => {
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join('، ')
  if (value && typeof value === 'object') { const size = value as { value?: number; unit?: string }; return size.value !== undefined ? `${size.value} ${size.unit}` : JSON.stringify(value) }
  return String(value)
}

/** One canonical SKU from intake to live: identity, evidence, images, what is missing, and the sign-off. Independent of supplier files. */
export default function CatalogWorkbenchPage() {
  const [query, setQuery] = React.useState('')
  const [submitted, setSubmitted] = React.useState('')
  const [selected, setSelected] = React.useState<string | null>(null)
  const list = useApi<SkuRow[]>(`/catalog/workbench/skus${submitted ? `?q=${encodeURIComponent(submitted)}` : ''}`)
  return (
    <RoleShell role="admin" active="workbench" mode="desktop">
      <Page>
        <PageHeader title="تجهيز المنتج للنشر" meta="هوية المنتج، معلوماته من مصادرها، صوره، واللي ناقص قبل النشر." actions={<Link className="text-bw-action-ink underline underline-offset-4" href="/admin/catalog/media-templates">قوالب الصور المعتمدة</Link>} />
        <ExceptionsQueue onOpenSku={(id) => setSelected(id)} />
        <Intake onCreated={(id) => { setSelected(id); list.reload() }} />
        <Section title="المنتجات">
          <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim()) }}>
            <Field className="min-w-64 flex-1" label="بحث باسم المنتج أو الماركة أو الكود أو الباركود" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button type="submit" variant="secondary">بحث</Button>
          </form>
          {list.error ? <LoadError message={list.error.message} onRetry={list.reload} /> : null}
          {!list.data && list.loading ? <Skeleton className="h-24 w-full" /> : null}
          {list.data && list.data.length === 0 ? <StateBlock kind="empty" title="مفيش منتجات" body="سجّل منتج جديد من النموذج اللي فوق." /> : null}
          <ul className="divide-y divide-bw-line">
            {(list.data ?? []).map((row) => (
              <li key={row.skuId}>
                <button type="button" className={`flex w-full flex-wrap items-center gap-2 py-2 text-start hover:bg-bw-sunken ${selected === row.skuId ? 'bg-bw-sunken font-semibold' : ''}`} onClick={() => setSelected(row.skuId)}>
                  <bdi>{row.brandName} — {row.productName}</bdi> <Code>{row.code}</Code>
                  <span className="text-bw-small text-bw-ink-soft"><bdi>{row.variantName} {row.size ?? ''} {row.sizeUnit ?? ''}</bdi></span>
                  {row.isPublished ? <StatusLabel tone="ok">منشور</StatusLabel> : <StatusLabel tone="pending">مش منشور</StatusLabel>}
                </button>
              </li>
            ))}
          </ul>
        </Section>
        {selected ? <SkuWorkspace key={selected} skuId={selected} /> : null}
      </Page>
    </RoleShell>
  )
}

function Intake({ onCreated }: { onCreated: (skuId: string) => void }) {
  const brands = useApi<Array<{ id: string; name: string }> | { items: Array<{ id: string; name: string }> }>('/brands')
  const categories = useApi<Array<{ id: string; name: string; children: Array<{ id: string; name: string }> }>>('/categories')
  const brandList = Array.isArray(brands.data) ? brands.data : brands.data?.items ?? []
  const [form, setForm] = React.useState({ brandId: '', categoryId: '', name: '', variantName: '', skuCode: '', size: '', sizeUnit: 'ml', barcode: '' })
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })
  const [notice, setNotice] = React.useState<string | null>(null)
  const valid = form.brandId && form.name.trim().length >= 2 && form.variantName.trim() && /^[A-Za-z0-9._-]+$/.test(form.skuCode) && Number(form.size) > 0 && (!form.barcode || /^\d{8,14}$/.test(form.barcode))
  const create = useCommand(() => api<{ skuId: string; createdProduct: boolean }>('/catalog/workbench/intake', { body: {
    brandId: form.brandId, ...(form.categoryId ? { categoryId: form.categoryId } : {}), name: form.name.trim(), variantName: form.variantName.trim(), skuCode: form.skuCode, size: Number(form.size), sizeUnit: form.sizeUnit,
    ...(form.barcode ? { barcode: form.barcode } : {}),
  } }))
  return (
    <details className="rounded-bw-card border border-bw-line p-4">
      <summary className="cursor-pointer font-semibold">تسجيل منتج جديد</summary>
      {notice ? <Notice tone="ok" title={notice} /> : null}
      <form className="mt-3 grid gap-3 md:grid-cols-4 md:items-end" onSubmit={async (e) => {
        e.preventDefault()
        const result = await create.execute()
        if (result) { setNotice(result.createdProduct ? 'اتسجل منتج جديد' : 'اتضاف حجم جديد لمنتج موجود'); onCreated(result.skuId) }
      }}>
        <Select label="الماركة" value={form.brandId} onChange={(brandId) => setForm({ ...form, brandId })} options={[['', 'اختر'], ...brandList.map((b) => [b.id, b.name] as [string, string])]} />
        <Select label="القسم" value={form.categoryId} onChange={(categoryId) => setForm({ ...form, categoryId })} options={[['', 'اختر'], ...(categories.data ?? []).flatMap((c) => c.children.map((child) => [child.id, `${c.name} / ${child.name}`] as [string, string]))]} />
        <Field className="md:col-span-2" label="اسم المنتج كما هو على العبوة" value={form.name} onChange={set('name')} />
        <Field label="النوع" value={form.variantName} onChange={set('variantName')} />
        <Field label="كود SKU" ltr value={form.skuCode} onChange={set('skuCode')} />
        <Field label="الحجم" ltr inputMode="decimal" value={form.size} onChange={set('size')} />
        <Select label="الوحدة" value={form.sizeUnit} onChange={(sizeUnit) => setForm({ ...form, sizeUnit })} options={[['ml', 'مل'], ['g', 'جم'], ['l', 'لتر'], ['kg', 'كجم'], ['oz', 'أونصة'], ['piece', 'قطعة']]} />
        <Field label="الباركود" ltr inputMode="numeric" value={form.barcode} onChange={set('barcode')} />
        <Button type="submit" loading={create.pending} disabled={!valid}>تسجيل</Button>
      </form>
      <CommandError error={create.error} />
    </details>
  )
}

function SkuWorkspace({ skuId }: { skuId: string }) {
  const { data, error, loading, reload } = useApi<Workbench>(`/catalog/workbench/skus/${skuId}`)
  if (error) return <LoadError message={error.message} onRetry={reload} />
  if (!data) return loading ? <Skeleton className="h-64 w-full" /> : null
  return (
    <>
      <ReadinessPanel data={data} onChange={reload} />
      <ProfilePanel skuId={skuId} />
      <ResearchPanel data={data} onChange={reload} />
      <MediaPanel data={data} onChange={reload} />
    </>
  )
}

function ReadinessPanel({ data, onChange }: { data: Workbench; onChange: () => void }) {
  const { sku, readiness } = data
  const [price, setPrice] = React.useState('')
  const publish = useCommand(() => api(`/catalog/workbench/skus/${sku.id}/publish`, { body: price ? { priceEgp: Number(price) } : {} }))
  const unpublish = useCommand(() => api(`/catalog/workbench/skus/${sku.id}/unpublish`, { body: {} }))
  const carton = useCommand((hasOuterCarton: boolean) => api(`/catalog/workbench/skus/${sku.id}/carton`, { method: 'PATCH', body: { hasOuterCarton } }))
  const commerceOnly = readiness.blockers.every((b) => b === 'LISTING_NOT_ACTIVE' || b === 'SELLING_PRICE_MISSING')
  const canPublish = readiness.ready || (commerceOnly && Number(price) > 0)
  return (
    <Section title={<span className="flex flex-wrap items-center gap-2"><bdi>{sku.product.brand.name} — {sku.product.name}</bdi> {readiness.isPublished ? <StatusLabel tone="ok">منشور</StatusLabel> : <StatusLabel tone="pending">مش منشور</StatusLabel>}</span>}
      aside={<span className="text-bw-small text-bw-ink-soft"><Code>{sku.code}</Code> · <bdi>{sku.variantName} {String(sku.size ?? '')} {sku.sizeUnit ?? ''}</bdi> · باركود <Code>{sku.barcode ?? '—'}</Code></span>}>
      <div className="space-y-3">
        {readiness.blockers.length ? (
          <Notice tone="warn" title="اللي ناقص قبل النشر"><ul className="list-disc ps-5">{readiness.blockers.map((b) => <li key={b}>{BLOCKERS[b] ?? b}</li>)}</ul></Notice>
        ) : <Notice tone="ok" title="جاهز للنشر" />}
        {readiness.warnings.length ? <ul className="list-disc ps-5 text-bw-small text-bw-ink-soft">{readiness.warnings.map((w) => <li key={w}>{WARNINGS[w] ?? w}</li>)}</ul> : null}
        <p className="text-bw-small">الصور: {Object.entries(readiness.media).map(([role, state]) => `${ROLES[role] ?? role}: ${state}`).join(' · ')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <fieldset className="text-bw-small">
            <legend className="mb-1 font-semibold">بيتباع بعلبة خارجية؟</legend>
            <label className="me-3"><input type="radio" name={`carton-${sku.id}`} checked={sku.hasOuterCarton === true} onChange={async () => { if (await carton.execute(true)) onChange() }} /> آه</label>
            <label><input type="radio" name={`carton-${sku.id}`} checked={sku.hasOuterCarton === false} onChange={async () => { if (await carton.execute(false)) onChange() }} /> لأ</label>
          </fieldset>
          {!readiness.commerce.price ? <Field label="سعر البيع المعتمد (جنيه)" ltr inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /> : <p className="text-bw-small">السعر الحالي: <Code>{readiness.commerce.price.amount}</Code> {readiness.commerce.price.currency}</p>}
          {!readiness.isPublished ? <Button type="button" loading={publish.pending} disabled={!canPublish} onClick={async () => { if (await publish.execute()) onChange() }}>مراجعة ونشر</Button>
            : <Button type="button" variant="secondary" loading={unpublish.pending} onClick={async () => { if (await unpublish.execute()) onChange() }}>إيقاف النشر</Button>}
        </div>
        <CommandError error={publish.error ?? unpublish.error ?? carton.error} />
      </div>
    </Section>
  )
}

function ResearchPanel({ data, onChange }: { data: Workbench; onChange: () => void }) {
  const { sku, facts, runs } = data
  const [urls, setUrls] = React.useState('')
  const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean)
  const valid = list.length > 0 && list.length <= 6 && list.every((u) => u.startsWith('https://'))
  const start = useCommand(() => api(`/catalog/workbench/skus/${sku.id}/research`, { body: { sourceUrls: list } }))
  const groups = React.useMemo(() => {
    const rank = (fact: Fact) => (fact.status === 'CONFLICT' ? 0 : fact.status === 'PROPOSED' ? 1 : fact.status === 'APPLIED' ? 2 : 3)
    return [...facts].filter((fact) => fact.field !== 'media.sourceImages').sort((a, b) => rank(a) - rank(b) || a.field.localeCompare(b.field))
  }, [facts])
  const latest = runs[0]
  const resume = useCommand(() => api(`/catalog/workbench/research/runs/${latest?.id}/resume`, { body: {} }))
  return (
    <Section title="معلومات المنتج من مصادرها" aside={<span className="text-bw-small text-bw-ink-soft">المعلومات المتسقة من الشركة أو موزع معتمد بتتأكد تلقائيًا. التعارض المهم بيظهر في الاستثناءات. اللي مش مذكور بيفضل غير معروف.</span>}>
      <div className="space-y-4">
        <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (valid && await start.execute()) { setUrls(''); onChange() } }}>
          <TextArea label="روابط صفحات المنتج الرسمية (رابط في كل سطر)" value={urls} onChange={setUrls} rows={2} />
          <Button type="submit" loading={start.pending} disabled={!valid}>قراءة المصادر</Button>
        </form>
        <CommandError error={start.error} />
        {latest ? (
          <div className="rounded-bw-field border border-bw-line p-3 text-bw-small">
            <p className="font-semibold">آخر بحث · {formatDateTime(latest.startedAt)} · {latest.status} {latest.errorReason ? `· ${latest.errorReason}` : ''}</p>
            <ul className="mt-1 space-y-1">
              {latest.sources.map((source) => <li key={source.url}><bdi dir="ltr">{source.url}</bdi> — {OUTCOMES[source.outcome] ?? source.outcome}{source.factCount !== undefined ? ` · ${source.factCount} معلومة` : ''}</li>)}
              {latest.rejected.map((item, i) => <li key={i} className="text-bw-warn">مرفوض: {REJECT_REASONS[item.reason] ?? item.reason}{item.detail ? <> — <bdi>{item.detail}</bdi></> : null}</li>)}
            </ul>
            {latest.status === 'PROVIDER_UNAVAILABLE' ? <Button className="mt-2" type="button" variant="secondary" loading={resume.pending} onClick={async () => { if (await resume.execute()) onChange() }}>إعادة المحاولة</Button> : null}
            <CommandError error={resume.error} />
          </div>
        ) : null}
        {groups.length === 0 ? <StateBlock kind="empty" title="لسه مفيش معلومات" body="ابدأ من صفحة المنتج على موقع الشركة." /> : null}
        <ul className="space-y-3">{groups.map((fact) => <FactRow key={fact.id} fact={fact} onChange={onChange} />)}</ul>
      </div>
    </Section>
  )
}

function FactRow({ fact, onChange }: { fact: Fact; onChange: () => void }) {
  const [note, setNote] = React.useState('')
  const [overwrite, setOverwrite] = React.useState(false)
  const review = useCommand((decision: 'APPROVED' | 'REJECTED') => api(`/catalog/workbench/research/facts/${fact.id}/review`, { body: { decision, note: note.trim(), overwrite } }))
  const open = fact.status === 'PROPOSED' || fact.status === 'CONFLICT'
  const exists = review.error?.code === 'CATALOG_VALUE_EXISTS'
  return (
    <li className="rounded-bw-field border border-bw-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{FIELDS[fact.field] ?? fact.field}</strong>
        {fact.status === 'CONFLICT' ? <StatusLabel tone="danger">مصادر مختلفة</StatusLabel> : fact.status === 'APPLIED' ? <StatusLabel tone="ok">في الكتالوج</StatusLabel> : fact.status === 'REJECTED' ? <StatusLabel tone="pending">مرفوضة</StatusLabel> : <StatusLabel tone="warn">مستنية مراجعة</StatusLabel>}
      </div>
      <p className="mt-1 text-bw-small" dir="auto"><bdi>{display(fact.value)}</bdi></p>
      <details className="mt-1 text-bw-small">
        <summary className="cursor-pointer text-bw-ink-soft">المصدر ({fact.evidence.length})</summary>
        <ul className="mt-1 space-y-1">
          {fact.evidence.map((item, i) => <li key={i}><a className="underline" href={item.sourceUrl} target="_blank" rel="noreferrer" dir="ltr">{item.sourceUrl}</a> · {item.sourceTier} · {formatDateTime(item.observedAt)}<blockquote className="border-s-2 border-bw-line ps-2" dir="auto">{item.excerpt}</blockquote></li>)}
        </ul>
      </details>
      {fact.reviewNote ? <p className="mt-1 text-bw-small text-bw-ink-soft">{fact.reviewNote}</p> : null}
      {open ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field className="min-w-64 flex-1" label="ملاحظة المراجعة" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="button" loading={review.pending} disabled={note.trim().length < 5} onClick={async () => { if (await review.execute('APPROVED')) onChange() }}>اعتماد</Button>
          <Button type="button" variant="secondary" loading={review.pending} disabled={note.trim().length < 5} onClick={async () => { if (await review.execute('REJECTED')) onChange() }}>رفض</Button>
          {exists ? <label className="text-bw-small"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> استبدال القيمة الموجودة</label> : null}
        </div>
      ) : null}
      <CommandError error={review.error} />
    </li>
  )
}

function MediaPanel({ data, onChange }: { data: Workbench; onChange: () => void }) {
  const { sku, assets, facts } = data
  const templates = useApi<Template[]>('/catalog/media-templates')
  const active = (templates.data ?? []).filter((t) => t.isActive)
  const originals = assets.filter((a) => !a.parentAssetId)
  const imageFact = facts.find((f) => f.field === 'media.sourceImages')
  const images = (imageFact?.value as string[] | undefined) ?? []
  const [imageUrl, setImageUrl] = React.useState('')
  const [rights, setRights] = React.useState('MANUFACTURER_PUBLISHED')
  const [publisher, setPublisher] = React.useState(sku.product.brand.name)
  const [role, setRole] = React.useState('PRIMARY_PACKSHOT')
  const importImage = useCommand(() => api(`/catalog/workbench/research/facts/${imageFact?.id}/import-image`, { body: { imageUrl, role, rightsStatus: rights, sourcePublisher: publisher } }))
  return (
    <Section title="صور المنتج" aside={<span className="text-bw-small text-bw-ink-soft">الأصل ماييتغيرش أبدًا. الصور المعالجة بتستنى موافقتك.</span>}>
      <div className="space-y-4">
        {images.length ? (
          <form className="grid gap-3 md:grid-cols-5 md:items-end" onSubmit={async (e) => { e.preventDefault(); if (await importImage.execute()) { setImageUrl(''); onChange() } }}>
            <Select className="md:col-span-2" label="صورة من المصدر" value={imageUrl} onChange={setImageUrl} options={[['', 'اختر'], ...images.map((url) => [url, url.slice(0, 80)] as [string, string])]} />
            <Select label="دورها" value={role} onChange={setRole} options={[['PRIMARY_PACKSHOT', ROLES.PRIMARY_PACKSHOT], ['PACKAGING_PROOF', ROLES.PACKAGING_PROOF]]} />
            <Select label="حق الاستخدام" value={rights} onChange={setRights} options={RIGHTS} />
            <Field label="الناشر" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
            <Button type="submit" variant="secondary" loading={importImage.pending} disabled={!imageUrl}>إضافة</Button>
          </form>
        ) : null}
        <CommandError error={importImage.error} />
        {originals.length === 0 ? <StateBlock kind="empty" title="مفيش صور" body="اقرأ صفحة المنتج الرسمية الأول أو ارفع صورة أصلية." /> : null}
        {originals.map((original) => <OriginalCard key={original.id} original={original} copies={assets.filter((a) => a.parentAssetId === original.id)} templates={active} onChange={onChange} />)}
      </div>
    </Section>
  )
}

function OriginalCard({ original, copies, templates, onChange }: { original: Asset; copies: Asset[]; templates: Template[]; onChange: () => void }) {
  const [templateId, setTemplateId] = React.useState('')
  const [clear, setClear] = React.useState(false)
  const derive = useCommand(() => api(`/catalog/media-assets/${original.id}/derive`, { body: { transform: 'SAHEL_EDITORIAL', ...(templateId ? { templateId } : {}), ...(clear ? { transparentPackaging: true } : {}) } }))
  const optimize = useCommand(() => api(`/catalog/media-assets/${original.id}/derive`, { body: { transform: 'OPTIMIZED' } }))
  return (
    <div className="space-y-3 rounded-bw-card border border-bw-line p-3">
      <AssetCard asset={original} label="الأصل" onChange={onChange} />
      {original.role === 'PRIMARY_PACKSHOT' ? (
        <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => { e.preventDefault(); if (await derive.execute()) onChange() }}>
          <Select label="قالب SAHEL" value={templateId} onChange={setTemplateId} options={[['', 'القالب النشط لقسم المنتج'], ...templates.map((t) => [t.id, `${t.name} v${t.version}`] as [string, string])]} />
          <label className="text-bw-small"><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> العبوة شفافة</label>
          <Button type="submit" loading={derive.pending}>تجهيز صورة صفحة المنتج</Button>
        </form>
      ) : <Button type="button" variant="secondary" loading={optimize.pending} onClick={async () => { if (await optimize.execute()) onChange() }}>نسخة محسّنة بدون تعديل</Button>}
      <CommandError error={derive.error ?? optimize.error} />
      {copies.map((copy) => <AssetCard key={copy.id} asset={copy} label={`نسخة · ${copy.transformVersion ?? ''}`} onChange={onChange} />)}
    </div>
  )
}

function AssetCard({ asset, label, onChange }: { asset: Asset; label: string; onChange: () => void }) {
  const src = useAuthedImage(asset.processingStatus === 'SUCCEEDED' ? `/catalog/media-assets/${asset.id}/file` : null)
  const [reason, setReason] = React.useState('')
  const warnings = asset.qualityReport?.warnings ?? []
  const review = useCommand((decision: 'APPROVED' | 'REJECTED') => api(`/catalog/media-assets/${asset.id}/review`, { body: { decision, reason: reason.trim(), ...(warnings.length ? { acceptQualityWarnings: true } : {}) } }))
  const publish = useCommand(() => api(`/catalog/media-assets/${asset.id}/publish`, { body: {} }))
  return (
    <div className="flex flex-wrap gap-3 border-t border-bw-line pt-3 first:border-t-0 first:pt-0">
      {src ? <img src={src} alt={`${ROLES[asset.role] ?? asset.role} ${asset.id.slice(0, 8)}`} className="size-40 rounded-bw-field border border-bw-line object-contain" /> : <div className="grid size-40 place-items-center rounded-bw-field border border-bw-line text-bw-small text-bw-ink-soft">{asset.processingStatus === 'FAILED' ? 'فشلت المعالجة' : 'جاري التحميل'}</div>}
      <div className="min-w-64 flex-1 space-y-2 text-bw-small">
        <p className="flex flex-wrap items-center gap-2"><strong>{ROLES[asset.role] ?? asset.role}</strong> · {label} · <Code>{shortId(asset.id)}</Code>
          {asset.publishedMediaId ? <StatusLabel tone="ok">منشورة</StatusLabel> : asset.supersededAt ? <StatusLabel tone="pending">اتبدلت</StatusLabel> : asset.reviewStatus === 'APPROVED' ? <StatusLabel tone="ok">موافق عليها</StatusLabel> : asset.reviewStatus === 'REJECTED' ? <StatusLabel tone="danger">مرفوضة</StatusLabel> : <StatusLabel tone="warn">مستنية مراجعة</StatusLabel>}</p>
        <p>المصدر: <a className="underline" href={asset.sourceUrl} target="_blank" rel="noreferrer" dir="ltr">{asset.sourcePublisher}</a> · الحقوق: {RIGHTS.find(([value]) => value === asset.rightsStatus)?.[1] ?? asset.rightsStatus}{asset.width ? <> · <Code>{asset.width}×{asset.height}</Code></> : null}</p>
        {asset.processingError ? <Notice tone="danger" title={PROCESSING_ERRORS[asset.processingError] ?? asset.processingError} /> : null}
        {warnings.length ? <ul className="list-disc ps-5 text-bw-warn">{warnings.map((w) => <li key={w}>{QUALITY[w] ?? w}</li>)}</ul> : null}
        {asset.reviewNote ? <p className="text-bw-ink-soft">ملاحظة: {asset.reviewNote}</p> : null}
        {asset.processingStatus === 'SUCCEEDED' && !asset.publishedMediaId && !asset.supersededAt ? (
          <div className="flex flex-wrap items-end gap-2">
            {asset.reviewStatus !== 'APPROVED' ? <>
              <Field className="min-w-56 flex-1" label="سبب القرار" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button type="button" loading={review.pending} disabled={reason.trim().length < 5} onClick={async () => { if (await review.execute('APPROVED')) onChange() }}>{warnings.length ? 'راجعت التحذيرات، موافق' : 'موافقة'}</Button>
              <Button type="button" variant="secondary" loading={review.pending} disabled={reason.trim().length < 5} onClick={async () => { if (await review.execute('REJECTED')) onChange() }}>رفض</Button>
            </> : <Button type="button" loading={publish.pending} onClick={async () => { if (await publish.execute()) onChange() }}>نشر</Button>}
          </div>
        ) : null}
        <CommandError error={review.error ?? publish.error} />
      </div>
    </div>
  )
}
