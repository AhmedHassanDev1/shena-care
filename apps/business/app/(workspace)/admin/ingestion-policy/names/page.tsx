'use client'

import * as React from 'react'
import Link from 'next/link'
import { Plus, History } from 'lucide-react'
import { Button, Code, Dialog, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel, useDialog } from '@/components/bw/primitives'
import { CommandError, Page, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useApi, useCommand } from '@/lib/use-api'
import { createDraft, policyChanges, previewRequest, searchLabel } from '@/lib/ingestion-policy'
import type { GroupResponse, HoldGroup, Options, Policy, PolicyDocument } from '@/lib/ingestion-policy'
import { HistoryView, HoldList, NameEditor, SearchField, supplierName } from '../policy-editors'
import type { MappingTask } from '../policy-editors'

/*
 * Advanced: supplier wording (aliases, per-supplier category names) and held supplier rows.
 * Brands, their allowed categories and product exclusions are managed on the Catalog Policy page, nowhere else.
 */
type Tab = 'names' | 'exceptions'
const tabs: Array<[Tab, string]> = [['names', 'أسماء الموردين'], ['exceptions', 'الصفوف المعلّقة']]
type BulkResult = { recheckedJobs: number; hasMore: boolean; results: Array<{ counts: { ALLOW: number; SKIP: number; HOLD: number } }> }
function DraftState({ changed }: { changed: boolean }) { return changed ? <StatusLabel tone="warn">تعديل غير محفوظ</StatusLabel> : null }

function Editor({ current, options, onSaved, onDraft, tab, setTab }: { current: Policy | null; options: Options; onSaved: (message: string) => void; onDraft: () => void; tab: Tab; setTab: (tab: Tab) => void }) {
  const [draft, setDraft] = React.useState(() => createDraft(current, options))
  const [query, setQuery] = React.useState('')
  const [holdLimit, setHoldLimit] = React.useState(10)
  const [refreshOnDiscard, setRefreshOnDiscard] = React.useState(false)
  const [nameTask, setNameTask] = React.useState<MappingTask | null>(null)
  const [history, setHistory] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [preview, setPreview] = React.useState<Policy | null>(null)
  const [feedback, setFeedback] = React.useState('')
  const [recheckGroup, setRecheckGroup] = React.useState<HoldGroup | null>(null)
  const review = useDialog()
  const discard = useDialog()
  const recheckDialog = useDialog()
  const holds = useApi<GroupResponse>('/ingestion/eligibility/holds')
  const changes = React.useMemo(() => policyChanges(current, draft), [current, draft])
  const dirty = changes.length > 0
  const changedIds = new Set(changes.map(c => c.key))
  React.useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const previewCommand = useCommand(async () => {
    const request = previewRequest(current, draft, reason)
    return api<Policy>(request.path, { method: 'POST', body: request.body })
  })
  const approve = useCommand(async () => {
    const result = await api<Policy>(`/ingestion/eligibility/${preview!.id}/approve`, { method: 'POST' })
    review.close()
    onSaved(`تم حفظ التعديلات وتفعيل الإصدار ${result.version}.`)
    return result
  })
  const recheck = useCommand(async () => {
    let jobs = 0
    const counts = { ALLOW: 0, SKIP: 0, HOLD: 0 }
    let result: BulkResult
    do {
      result = await api<BulkResult>('/ingestion/eligibility/holds/recheck', { method: 'POST', body: {
        supplierId: recheckGroup!.supplierId, brand: recheckGroup!.examples[0].brand, category: recheckGroup!.examples[0].category,
        expectedVersion: current!.version, reason: reason.trim(),
      } })
      jobs += result.recheckedJobs
      for (const item of result.results) { counts.ALLOW += item.counts.ALLOW; counts.SKIP += item.counts.SKIP; counts.HOLD += item.counts.HOLD }
      setFeedback(`تم فحص ${jobs} ملف: مسموح ${counts.ALLOW} · مستبعد ${counts.SKIP} · معلّق ${counts.HOLD}`)
      if (result.hasMore && !result.recheckedJobs) throw new Error('الفحص لم يتقدم. حمّل أحدث إصدار قبل المحاولة تاني.')
    } while (result.hasMore)
    if (!jobs) setFeedback('المجموعة اتفحصت بالفعل بالإصدار الحالي. اعتمد الربط الصحيح قبل إعادة الفحص.')
    holds.reload()
    recheckDialog.close()
  })
  const busy = previewCommand.pending || approve.pending || recheck.pending
  const edit = (doc: PolicyDocument) => { setDraft(doc); setPreview(null); setFeedback(''); onDraft() }
  const matches = (text: string) => searchLabel(text).includes(searchLabel(query))
  const visibleHolds = (holds.data?.groups ?? []).filter(g => matches(`${supplierName(options, g.supplierId)} ${g.examples[0]?.brand} ${g.examples[0]?.category}`))
  const openResolve = (g: HoldGroup) => {
    const example = g.examples[0]
    const brand = g.reasons.some(r => r.startsWith('BRAND_'))
    if (!brand && !example.category.trim()) { setFeedback('التصنيف ناقص في المصدر. راجع عمود التصنيف في ملف المورد؛ لا يمكن تخمينه من اسم المنتج.'); return }
    setNameTask({ kind: brand ? 'brand' : 'mapping', supplierId: g.supplierId, label: example.category, group: g })
  }
  const changeTab = (next: Tab) => { setTab(next); setQuery(''); setHoldLimit(10) }
  return <>
    <fieldset disabled={busy} className="min-w-0 space-y-6 pb-24">
      <PageHeader eyebrow="قائمة السماح / متقدم" title="أسماء الموردين والصفوف المعلّقة" meta={<Link href="/admin/ingestion-policy" className="underline-offset-4 hover:underline">رجوع لقائمة السماح</Link>} actions={<><Button variant="ghost" onClick={() => { if (dirty) { setRefreshOnDiscard(true); discard.open() } else onSaved('') }}>تحديث القائمة</Button><Button variant="ghost" onClick={() => setHistory(true)}><History className="size-4" aria-hidden />سجل التعديلات</Button></>} />
      <div className="flex flex-wrap items-center gap-3 text-bw-small"><StatusLabel tone={current ? 'ok' : 'warn'}>{current ? `قائمة فعّالة · إصدار ${current.version}` : 'لا توجد قائمة معتمدة'}</StatusLabel>{dirty ? <StatusLabel tone="warn">مسودة غير محفوظة · {changes.length} تعديل</StatusLabel> : <span className="text-bw-ink-soft">كل التعديلات محفوظة</span>}</div>
      <p className="max-w-2xl text-bw-small leading-relaxed text-bw-ink-soft">الأسماء اللي بيكتبها كل مورد للبراندات والتصنيفات، والصفوف اللي اتعلّقت لأن اسمها مش محسوم. البراندات وتصنيفاتها بتتدار من صفحة قائمة السماح.</p>
      {feedback && <Notice tone="info" title="نتيجة المراجعة">{feedback}</Notice>}
      <div role="tablist" aria-label="إدارة قائمة السماح" className="grid grid-cols-2 gap-1 border-b border-bw-line pb-2 sm:flex sm:gap-2">
        {tabs.map(([id, title]) => <button key={id} id={`policy-tab-${id}`} role="tab" aria-label={title} aria-selected={tab === id} aria-controls={`policy-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => changeTab(id)} onKeyDown={e => {
          const index = tabs.findIndex(t => t[0] === id)
          const next = e.key === 'ArrowLeft' ? (index + 1) % tabs.length : e.key === 'ArrowRight' ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
          if (next < 0) return
          e.preventDefault(); changeTab(tabs[next][0]); document.getElementById(`policy-tab-${tabs[next][0]}`)?.focus()
        }} className={`min-h-11 rounded-bw-field px-4 py-2 text-bw-small font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bw-action ${tab === id ? 'bg-bw-sunken text-bw-ink ring-1 ring-bw-line-field' : 'text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink'}`}>{title}{id === 'exceptions' && Boolean(holds.data?.totalGroups) && <span className="ms-2 text-bw-ink-soft"><Code>{holds.data!.totalGroups}</Code></span>}</button>)}
      </div>
      <div role="tabpanel" tabIndex={0} id={`policy-panel-${tab}`} aria-labelledby={`policy-tab-${tab}`} className="min-w-0 space-y-5">
        {(tab === 'names' || tab === 'exceptions') && <>
          <div className="flex flex-wrap items-end justify-between gap-4"><div className="min-w-0 flex-1"><SearchField label="ابحث باسم المورد أو الاسم المتكرر" value={query} onChange={setQuery} /></div>{tab === 'names' && <Button variant="secondary" onClick={() => setNameTask({ kind: 'mapping' })}><Plus className="size-4" aria-hidden />إضافة ربط اسم</Button>}</div>
          {holds.error && <LoadError message={holds.error.message} onRetry={holds.reload} />}
          {holds.loading ? <Skeleton className="h-40" /> : holds.data && <Section title={tab === 'names' ? 'أسماء محتاجة ربط' : 'مجموعات معلّقة'} aside={holds.data.totalGroups ? <span className="text-bw-small text-bw-ink-soft"><Code>{holds.data.totalGroups}</Code> مجموعة</span> : undefined}>
            {visibleHolds.length ? <><p className="mb-5 text-bw-small text-bw-ink-soft">راجع الاسم مرة واحدة عشان يتطبق على كل مرات ظهوره. المنتجات نفسها مش محتاجة موافقة أهلية فردية.{dirty && ' احفظ التعديلات قبل إعادة فحص المجموعات.'}</p><HoldList groups={visibleHolds.slice(0, holdLimit)} options={options} onResolve={openResolve} onRecheck={g => { setReason(''); setRecheckGroup(g); recheck.clearError(); recheckDialog.open() }} canRecheck={Boolean(current) && !dirty} />{visibleHolds.length > holdLimit && <Button className="mt-5" variant="secondary" onClick={() => setHoldLimit(n => n + 10)}>عرض مجموعات أكثر</Button>}</> : <StateBlock kind="empty" title={query ? 'مفيش نتائج مطابقة' : 'مفيش أسماء معلّقة'} body={query ? 'جرّب اسم المورد أو البراند أو التصنيف.' : 'الأسماء المعروفة بتتطبق تلقائيًا. لو ظهر اسم غير محسوم هتلاقيه هنا.'} />}
            {holds.data.totalGroups > holds.data.limit && <p className="mt-4 text-bw-small text-bw-ink-soft">المعروض أحدث {holds.data.limit} مجموعة من {holds.data.totalGroups}. حل المجموعات وحدّث القائمة لإظهار الأقدم. البحث داخل المجموعات المحمّلة.</p>}
          </Section>}
          {tab === 'names' && <Section title="الروابط المحفوظة والمسودة"><p className="mb-4 text-bw-small text-bw-ink-soft">أسماء البراندات المشتركة متاحة من زر الأسماء في تبويب البراندات. أسماء التصنيفات المشتركة متاحة من تبويب التصنيفات.</p><ul className="divide-y divide-bw-line">{draft.mappings.filter(m => matches(`${m.label} ${supplierName(options, m.supplierId)}`)).map(m => <li key={`${m.supplierId}:${m.label}`} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0 flex-1 space-y-1"><p className="break-words font-semibold">{m.label}</p><p className="text-bw-small text-bw-ink-soft">{supplierName(options, m.supplierId)} · {m.categoryIds.map(id => draft.categories.find(c => c.id === id)?.name ?? 'تصنيف غير متاح').join(' / ')}</p>{m.categoryIds.length > 1 && <StatusLabel tone="warn">ربط ملتبس</StatusLabel>}<DraftState changed={changedIds.has(`${m.supplierId}:${m.label}`)} /></div><div className="flex gap-1"><Button variant="ghost" aria-label={`تعديل ربط ${m.label}`} onClick={() => setNameTask({ kind: 'mapping', supplierId: m.supplierId, label: m.label })}>تعديل</Button><Button variant="ghost" aria-label={`إزالة ربط ${m.label}`} onClick={() => edit({ ...draft, mappings: draft.mappings.filter(x => x !== m) })}>إزالة</Button></div></li>)}</ul>{!draft.mappings.length && <p className="text-bw-small text-bw-ink-soft">لسه مفيش روابط تصنيفات خاصة بالموردين.</p>}</Section>}
        </>}
      </div>
    </fieldset>
    {dirty && <div className="sticky bottom-24 z-10 lg:bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-bw-card border border-bw-line-field bg-bw-surface p-4 shadow-bw-overlay"><div><p className="font-semibold">{changes.length} تعديل غير محفوظ</p><p className="text-bw-small text-bw-ink-soft">القائمة الفعّالة لسه زي ما هي.</p></div><div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={() => { setRefreshOnDiscard(false); discard.open() }}>تجاهل التعديلات</Button><Button disabled={busy} onClick={() => { setReason(''); setPreview(null); previewCommand.clearError(); approve.clearError(); review.open() }}>مراجعة وحفظ التعديلات</Button></div></div>}
    <Dialog dialogRef={review.ref} title="مراجعة وحفظ التعديلات" footer={<><Button variant="secondary" disabled={busy} onClick={review.close}>رجوع للتعديل</Button>{preview ? <Button loading={approve.pending} disabled={busy} onClick={() => { void approve.execute() }}>تأكيد وتفعيل الإصدار {preview.baseVersion + 1}</Button> : <Button loading={previewCommand.pending} disabled={busy || reason.trim().length < 5} onClick={async () => { const result = await previewCommand.execute(); if (result) setPreview(result) }}>معاينة التأثير</Button>}</>}>
      <div className="max-h-[60dvh] space-y-5 overflow-y-auto px-1"><CommandError error={previewCommand.error ?? approve.error} /><p className="text-bw-small text-bw-ink-soft">التعديلات هتسري على الاستيرادات الجديدة بعد التفعيل. الاستيرادات السابقة بتحتفظ بإصدارها.</p><ul className="divide-y divide-bw-line">{changes.map(c => <li key={c.key} className="space-y-1 py-3"><p className="break-words font-semibold">{c.name}</p>{c.supplierId && <p className="text-bw-small text-bw-ink-soft">{supplierName(options, c.supplierId)}</p>}<p className="break-words text-bw-small text-bw-ink-soft">{c.before} ← {c.after}</p></li>)}</ul>
        <fieldset disabled={busy}><TextArea label="سبب التعديل" rows={3} value={reason} onChange={v => { setReason(v); setPreview(null) }} /></fieldset><p className="text-bw-small text-bw-ink-soft">5 أحرف على الأقل. السبب واسم المسؤول ووقت التفعيل بيتحفظوا في سجل التعديلات.</p>
        {preview && <Notice tone="warn" title="تأثير القائمة المقترحة"><p>عروض حالية خارج القائمة المقترحة: <Code>{preview.impact.existingOffersAffected}</Code></p><p>عروض هتتغير: <Code>{preview.impact.existingOffersChanged}</Code> · طلبات مقبولة هتتغير: <Code>{preview.impact.acceptedOrdersChanged}</Code></p><p className="mt-2">المعاينة صالحة 30 دقيقة. لو القائمة أو الكتالوج اتغيروا، لازم معاينة جديدة قبل التفعيل.</p></Notice>}
      </div>
    </Dialog>
    <Dialog dialogRef={discard.ref} title="تجاهل التعديلات غير المحفوظة؟" footer={<><Button variant="secondary" onClick={discard.close}>الاحتفاظ بالمسودة</Button><Button variant="danger" onClick={() => { edit(createDraft(current, options)); discard.close(); if (refreshOnDiscard) onSaved('') }}>تجاهل المسودة</Button></>}><p>القائمة الفعّالة مش هتتغير. هيتشال بس اللي عدّلته في الزيارة دي.</p></Dialog>
    <Dialog dialogRef={recheckDialog.ref} title="إعادة فحص الأسماء المرتبطة" footer={<><Button variant="secondary" disabled={busy} onClick={recheckDialog.close}>إلغاء</Button><Button loading={recheck.pending} disabled={busy || reason.trim().length < 5 || !recheckGroup} onClick={() => { void recheck.execute() }}>فحص المجموعة بالإصدار الفعّال</Button></>}>
      <div className="space-y-4"><CommandError error={recheck.error} /><p>هيتطبق الإصدار المعتمد {current?.version} على الصفوف المعلّقة في الملفات المتأثرة. الصفوف المقبولة قبل كده مش هتتراجع.</p><fieldset disabled={busy}><TextArea label="سبب إعادة الفحص" value={reason} onChange={setReason} /></fieldset>{recheck.pending && <p role="status">{feedback || 'جاري فحص المجموعة…'}</p>}</div>
    </Dialog>
    {nameTask && <NameEditor task={nameTask} draft={draft} options={options} onApply={edit} onClose={() => setNameTask(null)} />}
    {history && <HistoryView onClose={() => setHistory(false)} />}
  </>
}

function PolicyPage() {
  const current = useApi<Policy | null>('/ingestion/eligibility')
  const options = useApi<Options>('/ingestion/eligibility/options')
  const [tab, setTab] = React.useState<Tab>('names')
  const [message, setMessage] = React.useState('')
  if (current.error || options.error) return <Page><LoadError message={(current.error ?? options.error)!.message} onRetry={() => { current.reload(); options.reload() }} /></Page>
  if (current.loading || options.loading || !options.data) return <Page><p role="status" className="text-bw-small text-bw-ink-soft">تحميل قائمة السماح…</p><Skeleton className="h-16" /><Skeleton className="h-80" /></Page>
  const currentPolicy = current.data ?? null
  return <Page><div dir="rtl" className="space-y-5">{message && <Notice tone="ok" title="التعديلات محفوظة">{message}</Notice>}<Editor key={currentPolicy?.id ?? 'initial'} current={currentPolicy} options={options.data} tab={tab} setTab={setTab} onDraft={() => setMessage('')} onSaved={feedback => { setMessage(feedback); current.reload(); options.reload() }} /></div></Page>
}
export default function SupplierNamesPage() { return <RoleShell role="admin" active="ingestion-policy"><PolicyPage /></RoleShell> }
