'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowRight, Plus, Trash2 } from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Section, Select, Skeleton, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Page, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/labels'
import {
  PRODUCT_STATE, ROUTINE_STATUS, TIMINGS, bodyFromDraft, draftFromView, draftProblems, issueStep, moveStep, newStep, timingLabel,
  type Issue, type ProductView, type RoutineDraft, type RoutineView, type StepDraft,
} from '@/lib/routines'
import { useApi, useCommand } from '@/lib/use-api'

const EMPTY: RoutineDraft = { title: '', titleEn: '', description: '', careArea: 'skin', concernSlug: '', references: [{ title: '', url: '' }], steps: [newStep()] }

/** Routine Studio editor. A draft is edited freely; a published routine is read-only until it is unpublished. */
export default function RoutineEditorPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const isNew = id === 'new'
  return (
    <RoleShell role="admin" active="routines" mode="desktop">
      <Page>{isNew ? <Editor routine={null} reload={() => undefined} /> : <Loader id={id} />}</Page>
    </RoleShell>
  )
}

function Loader({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<RoutineView>(`/care/admin/studio/routines/${id}`)
  if (error) return <LoadError message={error.message} onRetry={reload} />
  if (!data && loading) return <Skeleton className="h-64 w-full" />
  return data ? <Editor key={`${data.id}-${data.version}`} routine={data} reload={reload} /> : null
}

function Editor({ routine, reload }: { routine: RoutineView | null; reload: () => void }) {
  const router = useRouter()
  const [draft, setDraft] = React.useState<RoutineDraft>(routine ? draftFromView(routine) : EMPTY)
  const [issues, setIssues] = React.useState<Issue[]>([])
  const [notice, setNotice] = React.useState<string | null>(null)
  const concerns = useApi<Array<{ slug: string; name: string; careArea: string }>>('/care/concerns')
  const locked = routine?.status === 'PUBLISHED'
  const problems = draftProblems(draft)

  const keep = (error: ApiError | null) => {
    const found = (error?.details as { issues?: Issue[] } | undefined)?.issues
    setIssues(Array.isArray(found) ? found : [])
  }
  const save = useCommand(() => routine
    ? api<RoutineView>(`/care/admin/studio/routines/${routine.id}`, { method: 'PUT', body: bodyFromDraft(draft, routine.version) })
    : api<RoutineView>('/care/admin/studio/routines', { body: bodyFromDraft(draft) }))
  const publish = useCommand(() => api<RoutineView>(`/care/admin/studio/routines/${routine!.id}/publish`, { body: {} }))
  const unpublish = useCommand(() => api<RoutineView>(`/care/admin/studio/routines/${routine!.id}/unpublish`, { body: {} }))

  const onSave = async () => {
    setNotice(null); setIssues([])
    const saved = await save.execute()
    if (!saved) return
    setNotice('اتحفظت المسودة')
    if (!routine) router.replace(`/admin/routines/${saved.id}`)
    else reload()
  }
  const onPublish = async () => {
    setNotice(null); setIssues([])
    if (await publish.execute()) { setNotice('الروتين اتنشر'); reload() }
  }
  React.useEffect(() => { keep(save.error ?? publish.error) }, [save.error, publish.error])

  const patchStep = (index: number, patch: Partial<StepDraft>) => setDraft((d) => ({ ...d, steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }))
  const issuesOf = (index: number) => issues.filter((issue) => issueStep(issue) === index)
  const general = issues.filter((issue) => issueStep(issue) === null)

  return (
    <>
      <PageHeader eyebrow="استوديو الروتين" title={routine ? routine.title : 'روتين جديد'}
        meta={routine ? <span className="flex flex-wrap items-center gap-2"><Status map={ROUTINE_STATUS} value={routine.status} /> إصدار <Code>{routine.version}</Code> · آخر تعديل {formatDateTime(routine.updatedAt)}</span> : 'مسودة جديدة — مش هتظهر للعملاء قبل النشر'}
        actions={<Link href="/admin/routines" className="inline-flex"><Button variant="secondary" type="button"><ArrowRight className="size-4" aria-hidden />كل الروتينات</Button></Link>} />
      {locked ? <Notice tone="info" title="الروتين منشور">لتعديله ألغِ النشر أولًا؛ التعديل بيتسجّل في السجل.</Notice> : null}
      {notice ? <Notice tone="ok" title={notice} /> : null}
      {general.length ? <IssueList issues={general} /> : null}

      <Section title="البيانات الأساسية">
        <fieldset disabled={locked} className="grid gap-4 md:grid-cols-2">
          <Field label="الاسم (عربي)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Field label="الاسم (إنجليزي — اختياري)" ltr value={draft.titleEn} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} />
          <Field className="md:col-span-2" label="وصف قصير مبني على مصدر" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            hint="بدون وعود علاج أو شفاء أو أمان مضمون — الخادم بيرفضها." />
          <Select label="المجال" value={draft.careArea} onChange={(e) => setDraft({ ...draft, careArea: e.target.value as 'skin' | 'hair' })}
            options={[{ value: 'skin', label: 'بشرة' }, { value: 'hair', label: 'شعر' }]} />
          <div className="space-y-1.5">
            <Field label="الاهتمام (concern)" ltr list="concern-options" value={draft.concernSlug} onChange={(e) => setDraft({ ...draft, concernSlug: e.target.value })} />
            <datalist id="concern-options">{(concerns.data ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</datalist>
          </div>
        </fieldset>
      </Section>

      <Section title="المراجع" aside={!locked ? <Button variant="ghost" onClick={() => setDraft({ ...draft, references: [...draft.references, { title: '', url: '' }] })}><Plus className="size-4" aria-hidden />مرجع</Button> : null}>
        <p className="mb-3 text-bw-small text-bw-ink-soft">النشر محتاج مرجع واحد على الأقل بيستند عليه المحتوى. الرابط بيتحفظ كنص فقط ولا بيتفتح تلقائيًا.</p>
        <fieldset disabled={locked} className="space-y-3">
          {draft.references.map((ref, index) => (
            <div key={index} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <Field label="العنوان" value={ref.title} onChange={(e) => setDraft({ ...draft, references: draft.references.map((r, i) => i === index ? { ...r, title: e.target.value } : r) })} />
              <Field label="الرابط" ltr value={ref.url} onChange={(e) => setDraft({ ...draft, references: draft.references.map((r, i) => i === index ? { ...r, url: e.target.value } : r) })} />
              <Button variant="ghost" aria-label="حذف المرجع" onClick={() => setDraft({ ...draft, references: draft.references.filter((_, i) => i !== index) })}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          ))}
        </fieldset>
      </Section>

      <Section title="الخطوات" aside={!locked ? <Button variant="secondary" onClick={() => setDraft({ ...draft, steps: [...draft.steps, newStep()] })}><Plus className="size-4" aria-hidden />خطوة</Button> : null}>
        <p className="mb-3 text-bw-small text-bw-ink-soft">اكتب كود المنتج (SKU) أو الباركود أو المعرّف. الخادم بيربطه بنسخة واحدة بالظبط من الكتالوج ويرفض الغامض أو الناقص.</p>
        <ol className="space-y-4">
          {draft.steps.map((step, index) => {
            const live = routine?.steps[index]
            return (
              <li key={step.key} className="space-y-3 rounded-bw-field border border-bw-line p-3">
                <fieldset disabled={locked} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">الخطوة <Code>{index + 1}</Code></span>
                    <span className="text-bw-small text-bw-ink-soft">{timingLabel(step.timing)}</span>
                    <span className="ms-auto flex gap-1">
                      <Button variant="ghost" aria-label="تحريك لأعلى" disabled={index === 0} onClick={() => setDraft({ ...draft, steps: moveStep(draft.steps, index, -1) })}><ArrowUp className="size-4" aria-hidden /></Button>
                      <Button variant="ghost" aria-label="تحريك لأسفل" disabled={index === draft.steps.length - 1} onClick={() => setDraft({ ...draft, steps: moveStep(draft.steps, index, 1) })}><ArrowDown className="size-4" aria-hidden /></Button>
                      <Button variant="ghost" aria-label="حذف الخطوة" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}><Trash2 className="size-4" aria-hidden /></Button>
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="عنوان الخطوة" value={step.title} onChange={(e) => patchStep(index, { title: e.target.value })} />
                    <Select label="الوقت" value={step.timing} onChange={(e) => patchStep(index, { timing: e.target.value as StepDraft['timing'] })} options={TIMINGS.map((t) => ({ value: t.value, label: t.label }))} />
                    <Field label="المنتج الأساسي (SKU / باركود)" ltr value={step.product} onChange={(e) => patchStep(index, { product: e.target.value })} />
                  </div>
                  <Field label="طريقة الاستخدام (اختياري)" value={step.instructions} onChange={(e) => patchStep(index, { instructions: e.target.value })} />
                  <Field label="بدائل معتمدة (افصل بينها بفاصلة)" ltr value={step.alternatives.join(', ')}
                    onChange={(e) => patchStep(index, { alternatives: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} />
                  <label className="inline-flex items-center gap-2 text-bw-small"><input type="checkbox" checked={step.isOptional} onChange={(e) => patchStep(index, { isOptional: e.target.checked })} />خطوة اختيارية</label>
                </fieldset>
                {live?.product ? <ProductLine product={live.product} /> : routine && !live?.product ? <StatusLabel tone="danger">مفيش منتج على الخطوة دي</StatusLabel> : null}
                {live?.alternatives.map((alt, altIndex) => <ProductLine key={altIndex} product={alt} alternative />)}
                {issuesOf(index).length ? <IssueList issues={issuesOf(index)} /> : null}
              </li>
            )
          })}
        </ol>
      </Section>

      {problems.length && !locked ? <Notice tone="warn" title="قبل الحفظ">{problems.join(' · ')}</Notice> : null}
      <CommandError error={save.error ?? publish.error ?? unpublish.error} />
      <div className="flex flex-wrap items-center gap-2">
        {!locked ? <Button onClick={onSave} loading={save.pending} disabled={problems.length > 0}>{routine ? 'حفظ التعديلات' : 'حفظ كمسودة'}</Button> : null}
        {routine && routine.status !== 'PUBLISHED' ? <Button variant="secondary" onClick={onPublish} loading={publish.pending}>نشر</Button> : null}
        {routine?.status === 'PUBLISHED' ? <Button variant="danger" loading={unpublish.pending} onClick={async () => { if (await unpublish.execute()) { setNotice('اتلغى النشر'); reload() } }}>إلغاء النشر</Button> : null}
      </div>
      {routine ? <History id={routine.id} version={routine.version} /> : null}
    </>
  )
}

function ProductLine({ product, alternative = false }: { product: ProductView; alternative?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-bw-small">
      <span className="text-bw-ink-soft">{alternative ? 'بديل' : 'المنتج'}</span>
      <bdi className="font-semibold">{product.productName ?? '—'}</bdi>
      <span>{product.variantName}{product.size ? ` · ${product.size} ${product.sizeUnit ?? ''}` : ''}</span>
      {product.skuCode ? <Code>{product.skuCode}</Code> : null}
      <Status map={PRODUCT_STATE} value={product.state} />
      {product.price ? <span><Code>{product.price.amount}</Code> {product.price.currency}</span> : null}
    </div>
  )
}

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="space-y-1" role="alert">
      {issues.map((issue, index) => (
        <li key={index} className={`text-bw-small ${issue.severity === 'error' ? 'text-bw-danger' : 'text-bw-warn'}`}>
          {issue.severity === 'error' ? '✕' : '!'} {issue.message} <Code>{issue.code}</Code>
        </li>
      ))}
    </ul>
  )
}

function History({ id, version }: { id: string; version: number }) {
  const { data } = useApi<Array<{ id: string; version: number; action: string; actorId: string; createdAt: string }>>(`/care/admin/studio/routines/${id}/revisions?v=${version}`)
  const labels: Record<string, string> = { created: 'إنشاء', imported: 'استيراد JSON', edited: 'تعديل', published: 'نشر', unpublished: 'إلغاء نشر' }
  if (!data?.length) return null
  return (
    <Section title="السجل">
      <ul className="divide-y divide-bw-line text-bw-small">
        {data.map((entry) => <li key={entry.id} className="flex flex-wrap gap-3 py-2"><span className="font-semibold">{labels[entry.action] ?? entry.action}</span><span>إصدار <Code>{entry.version}</Code></span><span className="text-bw-ink-soft">{formatDateTime(entry.createdAt)}</span></li>)}
      </ul>
    </Section>
  )
}
