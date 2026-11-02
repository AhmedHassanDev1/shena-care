'use client'

import * as React from 'react'
import { Button, Code, Field, Notice, PageHeader, Section, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Page, Select, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useApi, useCommand } from '@/lib/use-api'

type Effect = 'ALLOW' | 'DENY'
type Brand = { id: string; name: string; isActive: boolean; effect: Effect | null; aliases: string[] }
type Category = { id: string; name: string; parentId: string | null; isActive: boolean; effect: Effect | null; aliases?: string[] }
type Mapping = { supplierId: string; label: string; categoryIds: string[] }
type Document = { brands: Brand[]; categories: Category[]; mappings: Mapping[] }
type Policy = { id: string; version: number | null; baseVersion: number; document: Document; reason: string; actorId: string; approvedAt: string | null; impact: { existingOffersAffected: number; existingOffersChanged: number; acceptedOrdersChanged: number } }
type Options = { brands: Brand[]; categories: Category[]; suppliers: Array<{ id: string; name: string }> }
type HoldGroup = { supplierId: string; brandKey: string; categoryKey: string; count: number; jobCount: number; reasons: string[];
  examples: Array<{ jobId: string; sourceRow: number; brand: string; category: string; name: string }>;
  suggestions: Array<{ brandId: string; name: string; score: number; effect: Effect | null }> }
type GroupResponse = { groups: HoldGroup[]; totalGroups: number; totalRows: number; limit: number }
type BulkResult = { recheckedJobs: number; hasMore: boolean; results: Array<{ counts: { ALLOW: number; SKIP: number; HOLD: number } }> }
const cleanAliases = (aliases: string[]) => aliases.map(a => a.trim()).filter(Boolean)
const effectLabel = (effect: Effect | null) => effect === 'ALLOW' ? 'داخل السماح' : 'خارج السماح'

function HoldGroupRow({ group, options, doc, approved, onBrandAlias, onCategoryMapping, onRecheck, canRecheck }: {
  group: HoldGroup; options: Options; doc: Document; approved: Document | null; canRecheck: boolean;
  onBrandAlias: (brandId: string, alias: string) => void; onCategoryMapping: (supplierId: string, label: string, categoryIds: string[]) => void;
  onRecheck: (group: HoldGroup) => void;
}) {
  const [brandId, setBrandId] = React.useState('')
  const [categoryId, setCategoryId] = React.useState('')
  const example = group.examples[0]
  const parents = new Set(doc.categories.map(c => c.parentId))
  return <li className="space-y-4 border-b border-bw-line pb-6">
    <p className="font-semibold">{options.suppliers.find(s => s.id === group.supplierId)?.name ?? group.supplierId} · {group.count} صف في {group.jobCount} ملف</p>
    <p>{example.brand || 'علامة غير محددة'} · {example.category || 'تصنيف غير محدد'}</p>
    <p className="text-bw-small"><Code>{group.reasons.join(' / ')}</Code></p>
    <details className="text-bw-small text-bw-ink-soft"><summary className="cursor-pointer">أمثلة للتأكد من معنى الاسم — مش موافقة على المنتج</summary>
      <ul className="mt-2 space-y-2">{group.examples.map(e => <li key={`${e.jobId}:${e.sourceRow}`}>{e.name || 'اسم غير متاح في السجل القديم'} · صف {e.sourceRow} · <Code>{e.jobId}</Code></li>)}</ul>
    </details>
    {group.reasons.some(r => r.startsWith('BRAND_')) && <div className="space-y-3">
      <p className="text-bw-small">اقتراحات بحث فقط، مش إثبات للعلامة: {group.suggestions.length ? group.suggestions.map(s => `${s.name} (${effectLabel(s.effect)})`).join(' / ') : 'مفيش اقتراح موثوق. سيب الاسم HOLD لحد التحقق.'}</p>
      <Select label="اربط الاسم بعلامة canonical موجودة بعد التحقق" value={brandId} onChange={setBrandId}
        options={[[ '', 'اختار بعد التحقق — مفيش اختيار تلقائي' ], ...(approved?.brands ?? []).map(b => [b.id, `${b.name} — ${effectLabel(b.effect)}`] as [string, string])]} />
      <Button variant="secondary" disabled={!brandId || !example.brand.trim()} onClick={() => onBrandAlias(brandId, example.brand)}>إضافة اسم العلامة لمسودة الأسماء المشتركة</Button>
    </div>}
    {group.reasons.some(r => r.startsWith('CATEGORY_')) && <div className="space-y-3">
      {example.category.trim() ? <>
        <Select label="اربط تصنيف المورد بـ leaf موجود بعد التحقق" value={categoryId} onChange={setCategoryId}
          options={[[ '', 'اختار التصنيف الصحيح بعد التحقق' ], ...doc.categories.filter(c => !parents.has(c.id)).map(c => [c.id, `${c.name} — ${effectLabel(approved?.categories.find(x => x.id === c.id)?.effect ?? null)}`] as [string, string])]} />
        <Button variant="secondary" disabled={!categoryId} onClick={() => onCategoryMapping(group.supplierId, example.category, [categoryId])}>إضافة / حسم ربط التصنيف في المسودة</Button>
      </> : <p className="text-bw-small text-bw-ink-soft">التصنيف ناقص: راجع عمود التصنيف في الملف. لا نخمّن من اسم المنتج أو العلامة، ولا نربط تصنيفًا افتراضيًا لكل منتجات المورد.</p>}
    </div>}
    <Button variant="secondary" disabled={!canRecheck} onClick={() => onRecheck(group)}>إعادة فحص المجموعة بالإصدار المعتمد</Button>
  </li>
}

function Editor({ current, options, onSaved }: { current: Policy | null; options: Options; onSaved: () => void }) {
  const [doc, setDoc] = React.useState<Document>(() => ({
    brands: options.brands.map(b => ({ ...b, effect: current?.document.brands.find(x => x.id === b.id)?.effect ?? null, aliases: current?.document.brands.find(x => x.id === b.id)?.aliases ?? [] })),
    categories: options.categories.map(c => ({ ...c, effect: current?.document.categories.find(x => x.id === c.id)?.effect ?? null, aliases: current?.document.categories.find(x => x.id === c.id)?.aliases ?? [] })),
    mappings: current?.document.mappings ?? [],
  }))
  const [query, setQuery] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [preview, setPreview] = React.useState<{ policy: Policy; kind: 'CENTRAL' | 'MAPPINGS' } | null>(null)
  const [aliasBrandId, setAliasBrandId] = React.useState('')
  const [aliasCategoryId, setAliasCategoryId] = React.useState('')
  const [supplier, setSupplier] = React.useState(options.suppliers[0]?.id ?? '')
  const [mappingLabel, setMappingLabel] = React.useState('')
  const [targets, setTargets] = React.useState<string[]>([])
  const [feedback, setFeedback] = React.useState('')
  const edit = (next: Document) => { setDoc(next); setPreview(null); setFeedback('الأسماء والتصنيفات المعدلة مسودة؛ لازم معاينة واعتماد قبل استخدامها.') }
  const previewCommand = useCommand((kind: 'CENTRAL' | 'MAPPINGS') => kind === 'CENTRAL'
    ? api<Policy>('/ingestion/eligibility/preview', { method: 'POST', body: {
      expectedVersion: current?.version ?? 0, reason,
      brands: doc.brands.filter(b => b.effect || current?.document.brands.find(x => x.id === b.id)?.aliases.length).map(b => ({ id: b.id, effect: b.effect, aliases: current?.document.brands.find(x => x.id === b.id)?.aliases ?? [] })),
      categories: doc.categories.filter(c => c.effect || current?.document.categories.find(x => x.id === c.id)?.aliases?.length).map(c => ({ id: c.id, effect: c.effect, aliases: current?.document.categories.find(x => x.id === c.id)?.aliases ?? [] })),
      mappings: current?.document.mappings ?? [],
    } })
    : api<Policy>('/ingestion/eligibility/mappings/preview', { method: 'POST', body: {
      expectedVersion: current?.version ?? 0, reason,
      brands: doc.brands.filter(b => current?.document.brands.some(x => x.id === b.id)).map(b => ({ id: b.id, aliases: cleanAliases(b.aliases) })),
      categories: doc.categories.filter(c => current?.document.categories.some(x => x.id === c.id)).map(c => ({ id: c.id, aliases: cleanAliases(c.aliases ?? []) })), mappings: doc.mappings,
    } }))
  const approveCommand = useCommand(() => api<Policy>(`/ingestion/eligibility/${preview!.policy.id}/approve`, { method: 'POST' }))
  const holds = useApi<GroupResponse>('/ingestion/eligibility/holds')
  const recheck = useCommand(async (group: HoldGroup) => {
    let jobs = 0; const counts = { ALLOW: 0, SKIP: 0, HOLD: 0 }
    let result: BulkResult
    do {
      result = await api<BulkResult>('/ingestion/eligibility/holds/recheck', { method: 'POST', body: {
        supplierId: group.supplierId, brand: group.examples[0].brand, category: group.examples[0].category,
        expectedVersion: current!.version, reason,
      } })
      jobs += result.recheckedJobs
      for (const item of result.results) { counts.ALLOW += item.counts.ALLOW; counts.SKIP += item.counts.SKIP; counts.HOLD += item.counts.HOLD }
      setFeedback(`تم فحص ${jobs} ملف: ALLOW ${counts.ALLOW} · SKIP ${counts.SKIP} · HOLD ${counts.HOLD}`)
      if (result.hasMore && result.recheckedJobs === 0) throw new Error('إعادة الفحص لم تتقدم؛ حمّل أحدث إصدار قبل المحاولة.')
    } while (result.hasMore)
    if (!jobs) setFeedback('الصفوف دي اتفحصت بالفعل بالإصدار الحالي. راجع الأسماء أو ربط التصنيف واعتمد تعديلًا قبل إعادة الفحص.')
    holds.reload()
  })
  const parents = new Set(doc.categories.map(c => c.parentId))
  const busy = previewCommand.pending || approveCommand.pending || recheck.pending
  const matches = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const chosenBrand = doc.brands.find(b => b.id === aliasBrandId)
  const chosenCategory = doc.categories.find(c => c.id === aliasCategoryId)
  const addMapping = (supplierId: string, label: string, categoryIds: string[]) => edit({ ...doc, mappings: [...doc.mappings.filter(m => !(m.supplierId === supplierId && m.label === label.trim())), { supplierId, label: label.trim(), categoryIds }] })
  const previewPolicy = async (kind: 'CENTRAL' | 'MAPPINGS') => { const policy = await previewCommand.execute(kind); if (policy) setPreview({ policy, kind }) }
  return <fieldset disabled={busy} className="min-w-0 space-y-6" aria-label="تعديل سياسة قبول الموردين">
    <PageHeader title="سياسة قبول منتجات الموردين" meta={`الإصدار الحالي: ${current?.version ?? 'لسه مفيش سياسة معتمدة'}`} />
    <Notice tone="info" title="قائمة سماح واحدة تملكها شيناكير">
      المورد يرفع ملفه بالكامل. القبول محتاج علامة وتصنيف نهائي معتمدين مع بعض. ربط اسم مورد بعلامة أو تصنيف موجود مش بيضيفه لقائمة السماح، ومش موافقة على SKU.
      الأسماء غير المحسومة تفضل HOLD؛ تشابه الاسم اقتراح للمراجعة فقط. العروض والطلبات المقبولة والملفات المثبتة على إصدار سابق بتفضل محفوظة.
    </Notice>
    <TextArea label="سبب التغيير / إعادة الفحص — مطلوب للسجل" value={reason} onChange={value => { setReason(value); setPreview(null) }} />
    <CommandError error={previewCommand.error ?? approveCommand.error ?? recheck.error} />
    <Button variant="secondary" onClick={onSaved}>تحميل أحدث إصدار وإلغاء المسودة</Button>
    <Section title="أ. قائمة السماح المركزية — اختيار شيناكير">
      <p className="mb-4 text-bw-small text-bw-ink-soft">السماح لـ leaf بالـ ID فقط؛ سماح الأب مش بيورّث للفروع، ومنع الأب بيمنع فروعه. المورد لا يختار أو يعتمد هذه القائمة.</p>
      <Field label="ابحث عن علامة أو تصنيف في القائمة المركزية" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="mt-4 grid gap-4 md:grid-cols-2">{doc.brands.filter(b => matches(b.name)).map(b => <Select key={b.id} label={`${b.name}${b.isActive ? '' : ' — غير نشطة'}`} value={b.effect ?? ''}
        options={[[ '', 'غير معتمدة — SKIP لو الاسم معروف' ], ['ALLOW', 'سماح'], ['DENY', 'منع صريح']]}
        onChange={value => edit({ ...doc, brands: doc.brands.map(x => x.id === b.id ? { ...x, effect: value ? value as Effect : null } : x) })} />)}</div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">{doc.categories.filter(c => matches(c.name)).map(c => <Select key={c.id}
        label={`${c.name}${parents.has(c.id) ? ' — تصنيف أب' : ' — leaf'}${c.parentId ? ` / ${doc.categories.find(p => p.id === c.parentId)?.name ?? c.parentId}` : ''}`}
        value={c.effect ?? ''} options={[[ '', 'غير معتمد' ], ...(!parents.has(c.id) && c.isActive ? [['ALLOW', 'سماح']] as Array<[string, string]> : []), ['DENY', 'منع صريح يشمل الفروع']]}
        onChange={value => edit({ ...doc, categories: doc.categories.map(x => x.id === c.id ? { ...x, effect: value ? value as Effect : null } : x) })} />)}</div>
      <Button className="mt-5" disabled={reason.trim().length < 5} onClick={() => previewPolicy('CENTRAL')}>معاينة تغيير قائمة السماح فقط</Button>
    </Section>
    <Section title="ب. أسماء الموردين — ربط قابل لإعادة الاستخدام">
      <p className="mb-4 text-bw-small text-bw-ink-soft">أسماء العلامات مشتركة لكل الموردين. أسماء التصنيفات المشتركة أو ربط تصنيف مورد بتشير لـ IDs موجودة فقط. اعتمادها بيحافظ على اختيارات السماح والمنع الحالية.</p>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3"><Select label="علامة موجودة لمراجعة أسمائها" value={aliasBrandId} onChange={setAliasBrandId} options={[[ '', 'اختار علامة موجودة' ], ...(current?.document.brands ?? []).map(b => [b.id, `${b.name} — ${effectLabel(b.effect)}`] as [string, string])]} />
          {chosenBrand && <TextArea label={`أسماء ${chosenBrand.name} المُراجعة — اسم في كل سطر`} value={chosenBrand.aliases.join('\n')} onChange={value => edit({ ...doc, brands: doc.brands.map(b => b.id === chosenBrand.id ? { ...b, aliases: value.split('\n') } : b) })} />}</div>
        <div className="space-y-3"><Select label="تصنيف leaf موجود لمراجعة أسمائه المشتركة" value={aliasCategoryId} onChange={setAliasCategoryId} options={[[ '', 'اختار تصنيفًا موجودًا' ], ...(current?.document.categories ?? []).filter(c => !parents.has(c.id)).map(c => [c.id, c.name] as [string, string])]} />
          {chosenCategory && <TextArea label={`أسماء ${chosenCategory.name} بالعربي والإنجليزي — اسم في كل سطر`} value={(chosenCategory.aliases ?? []).join('\n')} onChange={value => edit({ ...doc, categories: doc.categories.map(c => c.id === chosenCategory.id ? { ...c, aliases: value.split('\n') } : c) })} />}</div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Select label="المورد لربط أسماء التصنيفات" value={supplier} onChange={setSupplier} options={options.suppliers.map(s => [s.id, s.name])} />
        <Field label="اسم التصنيف في ملف المورد" value={mappingLabel} onChange={e => setMappingLabel(e.target.value)} />
        <label className="space-y-2">التصنيفات المقصودة — هدف واحد بعد التحقق؛ أكتر من هدف يفضل HOLD
          <select multiple aria-label="التصنيفات المقصودة" className="block min-h-32 w-full rounded-bw-field border border-bw-line-field bg-bw-surface p-3" value={targets} onChange={e => setTargets(Array.from(e.target.selectedOptions, o => o.value))}>
            {doc.categories.filter(c => !parents.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <Button className="mt-3" variant="secondary" disabled={!supplier || !mappingLabel.trim() || !targets.length} onClick={() => { addMapping(supplier, mappingLabel, targets); setMappingLabel(''); setTargets([]) }}>إضافة / تعديل ربط التصنيف في المسودة</Button>
      <ul className="mt-4 space-y-3">{doc.mappings.map((m, index) => <li key={`${m.supplierId}:${m.label}`} className="flex flex-wrap items-center gap-3">
        <span>{options.suppliers.find(s => s.id === m.supplierId)?.name}: {m.label} ← {m.categoryIds.map(id => doc.categories.find(c => c.id === id)?.name ?? id).join(' / ')}</span>
        <StatusLabel tone={m.categoryIds.length === 1 ? 'info' : 'warn'}>{m.categoryIds.length === 1 ? 'ربط محدد' : 'ملتبس — HOLD'}</StatusLabel>
        <Button variant="secondary" onClick={() => edit({ ...doc, mappings: doc.mappings.filter((_, i) => i !== index) })}>إزالة الربط</Button>
      </li>)}</ul>
      <Button className="mt-5" disabled={!current || reason.trim().length < 5} onClick={() => previewPolicy('MAPPINGS')}>معاينة الأسماء والربط فقط — بدون تغيير قائمة السماح</Button>
    </Section>
    {preview && <Section title={preview.kind === 'CENTRAL' ? 'معاينة قائمة السماح المركزية' : 'معاينة الأسماء فقط — قائمة السماح محفوظة'}>
      <div className="space-y-3" role="status">
        <details open><summary className="cursor-pointer font-semibold">راجع الأسماء والاختيارات قبل الاعتماد</summary>
          <ul className="mt-3 space-y-2 text-bw-small">
            {preview.policy.document.brands.filter(b => JSON.stringify(b.aliases) !== JSON.stringify(current?.document.brands.find(x => x.id === b.id)?.aliases ?? []) || b.effect !== (current?.document.brands.find(x => x.id === b.id)?.effect ?? null)).map(b => <li key={b.id}>{b.name} · {effectLabel(b.effect)} · الأسماء: {b.aliases.join(' / ') || 'لا يوجد'}</li>)}
            {preview.policy.document.categories.filter(c => JSON.stringify(c.aliases ?? []) !== JSON.stringify(current?.document.categories.find(x => x.id === c.id)?.aliases ?? []) || c.effect !== (current?.document.categories.find(x => x.id === c.id)?.effect ?? null)).map(c => <li key={c.id}>{c.name} · {effectLabel(c.effect)} · الأسماء: {(c.aliases ?? []).join(' / ') || 'لا يوجد'}</li>)}
            {preview.kind === 'MAPPINGS' && <li>ربط أسماء التصنيفات بعد الاعتماد: {preview.policy.document.mappings.length}
              <ul className="mt-2 space-y-1">{preview.policy.document.mappings.map(m => <li key={`${m.supplierId}:${m.label}`}>{options.suppliers.find(s => s.id === m.supplierId)?.name}: {m.label} ← {m.categoryIds.map(id => preview.policy.document.categories.find(c => c.id === id)?.name ?? id).join(' / ')}</li>)}</ul>
            </li>}
          </ul>
        </details>
        <p>عروض حالية خارج السماح المقترح: {preview.policy.impact.existingOffersAffected}. عروض هتتغير: {preview.policy.impact.existingOffersChanged}. طلبات مقبولة هتتغير: {preview.policy.impact.acceptedOrdersChanged}.</p>
        <p>الإصدار المقترح {preview.policy.baseVersion + 1}. المعاينة صالحة 30 دقيقة وتترفض لو السياسة أو taxonomy اتغيرت. كل معاينة تحفظ تغييرات قسمها فقط.</p>
        <Button variant="danger" onClick={async () => { const result = await approveCommand.execute(); if (result) { setPreview(null); onSaved() } }}>اعتماد الإصدار {preview.policy.baseVersion + 1}</Button>
      </div>
    </Section>}
    {feedback && <Notice tone="info" title="حالة المراجعة"><span role="status">{feedback}</span></Notice>}
    <Section title="ج. الأسماء غير المحسومة — مجموعات HOLD">
      <p className="mb-4 text-bw-small text-bw-ink-soft">{holds.data?.totalRows ?? 0} صف غير محسوم في {holds.data?.totalGroups ?? 0} مجموعة. أحدث {holds.data?.limit ?? 200} مجموعة مع أمثلة؛ الأعداد محسوبة قبل حد العرض. راجع الاسم مرة واحدة، اعتمد الربط من قسم ب، ثم أعد فحص الملفات المتأثرة دفعة واحدة. مفيش موافقة أهلية لكل منتج.</p>
      {holds.error && <LoadError message={holds.error.message} onRetry={holds.reload} />}
      {holds.loading && <p>تحميل مجموعات الأسماء…</p>}
      {holds.data?.groups.length === 0 && <p>مفيش أسماء محتاجة حسم. الاستيرادات المعروفة بتتفلتر تلقائيًا بالقائمة الحالية.</p>}
      <ul className="space-y-6">{holds.data?.groups.map(group => <HoldGroupRow key={`${group.supplierId}:${group.brandKey}:${group.categoryKey}`} group={group} options={options} doc={doc} approved={current?.document ?? null}
        canRecheck={Boolean(current) && reason.trim().length >= 5} onRecheck={group => { void recheck.execute(group) }} onCategoryMapping={addMapping}
        onBrandAlias={(id, alias) => { setAliasBrandId(id); edit({ ...doc, brands: doc.brands.map(b => b.id === id ? { ...b, aliases: [...new Set([...b.aliases, alias])] } : b) }) }} />)}</ul>
    </Section>
  </fieldset>
}

function PolicyPage() {
  const current = useApi<Policy | null>('/ingestion/eligibility')
  const options = useApi<Options>('/ingestion/eligibility/options')
  const history = useApi<Policy[]>('/ingestion/eligibility/history')
  if (current.error || options.error) return <LoadError message={(current.error ?? options.error)!.message} onRetry={() => { current.reload(); options.reload() }} />
  if (current.loading || options.loading || current.data === undefined || !options.data) return <p>تحميل السياسة والتصنيفات…</p>
  return <Page>
    <Editor key={current.data?.id ?? 'initial'} current={current.data} options={options.data} onSaved={() => { current.reload(); options.reload(); history.reload() }} />
    <Section title="سجل الإصدارات المعتمدة">
      {history.error && <LoadError message={history.error.message} onRetry={history.reload} />}
      <ul className="space-y-3">{history.data?.map(p => <li key={p.id}>إصدار {p.version} · {p.approvedAt ? new Date(p.approvedAt).toLocaleString('ar-EG') : ''} · {p.reason} · المسؤول <Code>{p.actorId}</Code></li>)}</ul>
    </Section>
  </Page>
}
export default function IngestionPolicyPage() { return <RoleShell role="admin" active="ingestion-policy"><PolicyPage /></RoleShell> }
