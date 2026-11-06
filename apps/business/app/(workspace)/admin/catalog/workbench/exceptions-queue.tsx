import * as React from 'react'
import { Button, Code, Field, Notice, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Select } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

type Action = 'RESOLVE' | 'CORRECT' | 'REJECT' | 'RETRY'
export interface CatalogException {
  id: string; skuId: string | null; importRowId: string | null; subjectType: string; subjectId: string; field: string | null; reasonCode: string; severity: 'CRITICAL' | 'HIGH'
  summary: string; createdAt: string
  evidence: { row?: { rowNumber: number; name: string; brand: string | null; size: number | null; sizeUnit: string | null; category: string | null; sourceUrl: string | null; barcode: string | null; invalidBarcode: string | null }
    checks?: Array<{ url: string; tier: string; outcome: string; rejectedReasons: string[]; pageGtin: string | null }>; factIds?: string[]
    identity?: { candidates?: Array<{ skuId: string; productName: string; size: number | null; sizeUnit: string | null; code: string; exactName: boolean; samePackaging: boolean }> } }
  recommended: { action: Action; label: string; payload?: Record<string, unknown> } | null
}

/** Why a case reached a person, in words. Everything not listed here was decided automatically. */
export const EXCEPTION_REASONS: Record<string, string> = {
  IDENTITY_CONFLICT: 'الصف بيناقض منتج موجود (الماركة أو الحجم أو التركيبة أو الباركود)',
  COMPETING_IDENTITIES: 'أكتر من منتج في الكتالوج ممكن يكون هو ده',
  IDENTITY_UNCONFIRMED: 'نفس الماركة والاسم والحجم لمنتج موجود، بس مفيش دليل مستقل إنه هو نفسه',
  POSSIBLE_DUPLICATE_CANDIDATE: 'ممكن يكون نفس منتج تاني مكتوب بشكل مختلف',
  MISSING_BRAND: 'مفيش ماركة', MISSING_NET_CONTENT: 'مفيش حجم', SIZE_UNREADABLE: 'الحجم مش مقروء', SIZE_NOT_CONFIRMED: 'صفحة المنتج ماذكرتش الحجم ده',
  BRAND_SPELLING_UNCONFIRMED: 'الماركة مش في السياسة بس شبه ماركة معتمدة', POLICY_BRAND_AMBIGUOUS: 'اسم الماركة يحتمل أكتر من ماركة',
  POLICY_CATEGORY_AMBIGUOUS: 'القسم يحتمل أكتر من معنى', POLICY_CATEGORY_REQUIRES_LEAF: 'لازم قسم فرعي محدد', POLICY_CATEGORY_UNKNOWN: 'القسم ناقص أو مش معروف',
  POLICY_NOT_CONFIGURED: 'مفيش سياسة كتالوج مفعّلة', POLICY_NOT_ADMITTED: 'السياسة الحالية مابقتش تسمح بالصف ده',
  NO_IDENTITY_SOURCE: 'منتج جديد من غير صفحة رسمية تثبت هويته', SOURCE_CONTRADICTS_IDENTITY: 'صفحة المصدر عن منتج أو حجم تاني',
  SOURCE_NOT_TRUSTED: 'الصفحة الوحيدة من بائع مش من الشركة أو موزع معتمد', BARCODE_CONFLICT: 'باركود مؤكد مختلف عن المكتوب',
  RETRY_EXHAUSTED: 'الصفحة فشلت بعد كل المحاولات التلقائية', SIZE_CONTRADICTS_CATALOG: 'المصدر بيقول حجم غير المسجل',
  USAGE_INSTRUCTIONS_CONTRADICT: 'المصادر مختلفة: يُشطف ولا يُترك', COMPOSITION_INCI_CONFLICT: 'قائمتين مكونات مختلفتين من مصادر موثوقة',
  COMPOSITION_ACTIVECONCENTRATIONS_CONFLICT: 'تركيز مادة فعالة مختلف بين المصادر', SAFETY_WARNINGS_CONFLICT: 'تحذيرات مختلفة', IDENTITY_SIZE_CONFLICT: 'أحجام مختلفة من مصادر موثوقة',
  IDENTITY_GTIN_CONFLICT: 'باركودات مختلفة من مصادر موثوقة',
}
const ACTIONS: Record<Action, string> = { RESOLVE: 'اعتماد', CORRECT: 'تصحيح', REJECT: 'رفض', RETRY: 'إعادة المحاولة' }
/** The precomputed resolution, in the Admin's language. The API label stays as the English fallback. */
const RECOMMENDED: Record<string, string> = {
  IDENTITY_UNCONFIRMED: 'اربطه بالمنتج المقترح', COMPETING_IDENTITIES: 'اختار المنتج الصح من المرشحين', IDENTITY_CONFLICT: 'صحّح الصف أو ارفضه',
  POSSIBLE_DUPLICATE_CANDIDATE: 'حدّد هل هما نفس المنتج', MISSING_BRAND: 'ضيف الماركة', MISSING_NET_CONTENT: 'ضيف الحجم', SIZE_UNREADABLE: 'صحّح الحجم',
  SIZE_NOT_CONFIRMED: 'ضيف صفحة الحجم ده بالظبط', BRAND_SPELLING_UNCONFIRMED: 'استخدم الماركة المقترحة', NO_IDENTITY_SOURCE: 'ضيف رابط الصفحة الرسمية وأعد الفحص',
  SOURCE_CONTRADICTS_IDENTITY: 'صحّح الصف أو رابط الصفحة', SOURCE_NOT_TRUSTED: 'ضيف رابط رسمي', BARCODE_CONFLICT: 'حدّد الباركود الصح', RETRY_EXHAUSTED: 'أعد المحاولة دلوقتي',
  USAGE_INSTRUCTIONS_CONTRADICT: 'احتفظ بتعليمات الشركة', SIZE_CONTRADICTS_CATALOG: 'حدّد القيمة الصح', POLICY_NOT_ADMITTED: 'أعد الفحص بالسياسة الحالية',
}

/** The one queue of genuinely critical cases. Normal products never appear here: they were accepted, linked or skipped automatically, with an audit trail. */
export function ExceptionsQueue({ onOpenSku }: { onOpenSku: (skuId: string) => void }) {
  const list = useApi<{ total: number; items: CatalogException[] }>('/catalog/workbench/exceptions')
  const items = list.data?.items ?? []
  return (
    <Section title={<span className="flex items-center gap-2">الاستثناءات الحرجة {list.data ? <Code>{list.data.total}</Code> : null}</span>}
      aside={<span className="text-bw-small text-bw-ink-soft">المنتجات العادية بتتقبل أو تترَبط أو تتجاهَل تلقائيًا. هنا بس اللي محتاج قرار منك.</span>}>
      {list.error ? <LoadError message={list.error.message} onRetry={list.reload} /> : null}
      {!list.data && list.loading ? <Skeleton className="h-24 w-full" /> : null}
      {list.data && items.length === 0 ? <StateBlock kind="empty" title="مفيش استثناءات مفتوحة" body="كل المنتجات اتقرر فيها تلقائيًا." /> : null}
      <ul className="divide-y divide-bw-line">
        {items.map((item) => <li key={item.id} className="py-3"><ExceptionItem item={item} onDone={list.reload} onOpenSku={onOpenSku} /></li>)}
      </ul>
    </Section>
  )
}

function ExceptionItem({ item, onDone, onOpenSku }: { item: CatalogException; onDone: () => void; onOpenSku: (skuId: string) => void }) {
  const row = item.evidence.row
  const recommendedLabel = RECOMMENDED[item.reasonCode] ?? item.recommended?.label ?? ''
  const [note, setNote] = React.useState(recommendedLabel)
  const candidates = (item.evidence.identity?.candidates ?? []).slice(0, 5)
  const [correcting, setCorrecting] = React.useState(false)
  const [correction, setCorrection] = React.useState({ sourceUrl: '', brand: '', name: '', size: '', sizeUnit: 'ml', categoryHint: '' })
  const [done, setDone] = React.useState<string | null>(null)
  const send = useCommand((action: Action, extra: Record<string, unknown> = {}) => api<{ row: { decision: string } | null }>(`/catalog/workbench/exceptions/${item.id}/resolve`, {
    body: { action, note: note.trim(), ...extra },
  }))
  const run = async (action: Action, extra: Record<string, unknown> = {}) => {
    const result = await send.execute(action, extra)
    if (result) { setDone(result.row?.decision ?? action); onDone() }
  }
  const recommendedExtra = (): Record<string, unknown> => {
    const payload = item.recommended?.payload ?? {}
    if (item.recommended?.action === 'CORRECT' && payload.correction) return { correction: payload.correction }
    return { ...(typeof payload.skuId === 'string' ? { skuId: payload.skuId } : {}), ...(typeof payload.factId === 'string' ? { factId: payload.factId } : {}) }
  }
  const correctionBody = () => {
    const out: Record<string, unknown> = {}
    if (correction.sourceUrl.trim()) out.sourceUrl = correction.sourceUrl.trim()
    if (correction.brand.trim()) out.brand = correction.brand.trim()
    if (correction.name.trim()) out.name = correction.name.trim()
    if (Number(correction.size) > 0) { out.size = Number(correction.size); out.sizeUnit = correction.sizeUnit }
    if (correction.categoryHint.trim()) out.categoryHint = correction.categoryHint.trim()
    return out
  }
  const links = [row?.sourceUrl, ...(item.evidence.checks ?? []).map((check) => check.url), typeof item.recommended?.payload?.url === 'string' ? item.recommended.payload.url : null]
    .filter((url, i, all): url is string => Boolean(url) && all.indexOf(url) === i)
  const noteOk = note.trim().length >= 3
  const isRow = item.subjectType === 'IMPORT_ROW'
  if (done) return <Notice tone="ok" title={`اتسجل القرار: ${done}`} />
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusLabel tone={item.severity === 'CRITICAL' ? 'danger' : 'warn'}>{item.severity === 'CRITICAL' ? 'حرج' : 'مهم'}</StatusLabel>
        <strong>{EXCEPTION_REASONS[item.reasonCode] ?? item.summary}</strong>
        <Code>{item.reasonCode}</Code>
        {item.field ? <Code>{item.field}</Code> : null}
        <span className="text-bw-small text-bw-ink-soft">{formatDateTime(item.createdAt)}</span>
      </div>
      {row ? <p className="text-bw-small"><Code>{row.rowNumber}</Code> · <bdi>{row.brand ? `${row.brand} — ` : ''}{row.name}</bdi> · <bdi>{row.size ? `${row.size} ${row.sizeUnit ?? ''}` : 'من غير حجم'}</bdi>
        {row.category ? <> · <bdi>{row.category}</bdi></> : null}{row.barcode ? <> · باركود <Code>{row.barcode}</Code></> : null}{row.invalidBarcode ? <> · كود غير صالح كباركود <Code>{row.invalidBarcode}</Code></> : null}</p> : null}
      {!EXCEPTION_REASONS[item.reasonCode] ? <p className="text-bw-small text-bw-ink-soft" dir="auto">{item.summary}</p> : null}
      {candidates.length && isRow ? (
        <div className="space-y-1 text-bw-small">
          <p className="font-semibold">المرشحين من الكتالوج (الربط بيعدّي على نفس فحص الهوية):</p>
          <div className="flex flex-wrap gap-2">{candidates.map((candidate) => (
            <Button key={candidate.skuId} type="button" variant="secondary" loading={send.pending} disabled={!noteOk} onClick={() => run('RESOLVE', { skuId: candidate.skuId })}>
              <bdi>{candidate.productName} {candidate.size ?? ''} {candidate.sizeUnit ?? ''}</bdi>
            </Button>))}</div>
        </div>) : null}
      {(item.evidence.checks ?? []).length ? <ul className="list-disc ps-5 text-bw-small">{item.evidence.checks!.map((check) => <li key={check.url}><bdi dir="ltr">{check.url}</bdi> · {check.tier} · {check.outcome}{check.rejectedReasons.length ? ` · ${check.rejectedReasons.join(', ')}` : ''}{check.pageGtin ? <> · GTIN <Code>{check.pageGtin}</Code></> : null}</li>)}</ul> : null}
      {item.recommended?.payload && typeof item.recommended.payload.official === 'string' ? <p className="text-bw-small">الباركود في القائمة <Code>{String(item.recommended.payload.stated)}</Code> · باركود الشركة <Code>{item.recommended.payload.official}</Code></p> : null}
      <div className="flex flex-wrap items-center gap-3 text-bw-small">
        {links.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-bw-action-ink underline underline-offset-4"><bdi dir="ltr">{new URL(url).hostname}</bdi></a>)}
        {item.skuId ? <button type="button" className="text-bw-action-ink underline underline-offset-4" onClick={() => onOpenSku(item.skuId!)}>افتح المنتج</button> : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field className="min-w-56 flex-1" label="سبب القرار" value={note} onChange={(e) => setNote(e.target.value)} />
        {item.recommended && !(item.recommended.action === 'RESOLVE' && isRow && !item.recommended.payload?.skuId) ? <Button type="button" loading={send.pending} disabled={!noteOk} onClick={() => (item.recommended!.action === 'CORRECT' && !item.recommended!.payload?.correction ? setCorrecting(true) : run(item.recommended!.action, recommendedExtra()))}>{recommendedLabel}</Button> : null}
        {isRow ? <Button type="button" variant="secondary" onClick={() => setCorrecting(!correcting)}>{ACTIONS.CORRECT}</Button> : null}
        <Button type="button" variant="secondary" loading={send.pending} disabled={!noteOk} onClick={() => run('REJECT')}>{ACTIONS.REJECT}</Button>
        <Button type="button" variant="secondary" loading={send.pending} disabled={!noteOk} onClick={() => run('RETRY')}>{ACTIONS.RETRY}</Button>
      </div>
      {correcting && isRow ? (
        <form className="grid gap-2 rounded-bw-field border border-bw-line p-3 md:grid-cols-3 md:items-end" onSubmit={(e) => { e.preventDefault(); void run('CORRECT', { correction: correctionBody() }) }}>
          <Field className="md:col-span-3" label="رابط صفحة المنتج الرسمية" ltr value={correction.sourceUrl} onChange={(e) => setCorrection({ ...correction, sourceUrl: e.target.value })} />
          <Field label="الماركة" value={correction.brand} onChange={(e) => setCorrection({ ...correction, brand: e.target.value })} />
          <Field label="اسم المنتج" value={correction.name} onChange={(e) => setCorrection({ ...correction, name: e.target.value })} />
          <Field label="القسم" value={correction.categoryHint} onChange={(e) => setCorrection({ ...correction, categoryHint: e.target.value })} />
          <Field label="الحجم" ltr inputMode="decimal" value={correction.size} onChange={(e) => setCorrection({ ...correction, size: e.target.value })} />
          <Select label="الوحدة" value={correction.sizeUnit} onChange={(sizeUnit) => setCorrection({ ...correction, sizeUnit })} options={[['ml', 'مل'], ['g', 'جم'], ['l', 'لتر'], ['kg', 'كجم'], ['oz', 'أونصة'], ['piece', 'قطعة']]} />
          <Button type="submit" loading={send.pending} disabled={!noteOk || Object.keys(correctionBody()).length === 0}>حفظ التصحيح وإعادة الفحص</Button>
        </form>
      ) : null}
      <CommandError error={send.error} />
    </div>
  )
}
