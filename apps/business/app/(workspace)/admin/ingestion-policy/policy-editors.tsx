'use client'

import * as React from 'react'
import { Plus, Search } from 'lucide-react'
import { Button, Code, Dialog, Field, Notice, Skeleton, StateBlock, StatusLabel, useDialog } from '@/components/bw/primitives'
import { Select, TextArea } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import { cleanAliases, effectLabel, searchLabel } from '@/lib/ingestion-policy'
import type { HoldGroup, Mapping, Options, Policy, PolicyDocument } from '@/lib/ingestion-policy'

export type MappingTask = { kind: 'brand' | 'category' | 'mapping'; id?: string; supplierId?: string; label?: string; group?: HoldGroup }
export const supplierName = (options: Options, id: string) => options.suppliers.find(s => s.id === id)?.name ?? 'مورد غير متاح'
const reasonLabel = (reason: string) => ({ BRAND_UNKNOWN: 'اسم البراند غير معروف', BRAND_AMBIGUOUS: 'الاسم يشير لأكثر من براند', CATEGORY_UNKNOWN: 'التصنيف ناقص أو غير معروف', CATEGORY_AMBIGUOUS: 'التصنيف له أكثر من معنى', POLICY_NOT_CONFIGURED: 'لم تكن هناك قائمة معتمدة وقت الاستيراد' }[reason] ?? 'يحتاج مراجعة ربط الأسماء')

export function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div className="relative max-w-xl"><Field label={label} value={value} onChange={e => onChange(e.target.value)} placeholder="اكتب الاسم بالعربي أو الإنجليزي…" className="[&_input]:pe-10" /><Search className="pointer-events-none absolute bottom-3 end-3 size-4 text-bw-ink-soft" aria-hidden /></div>
}

export function AddBrand({ options, draft, onAdd, onClose }: { options: Options; draft: PolicyDocument; onAdd: (id: string) => void; onClose: () => void }) {
  const dialog = useDialog()
  const [query, setQuery] = React.useState('')
  React.useEffect(() => { dialog.ref.current?.showModal() }, [dialog.ref])
  const matches = options.brands.filter(b => b.isActive && draft.brands.find(x => x.id === b.id)?.effect !== 'ALLOW' && searchLabel(`${b.name} ${draft.brands.find(x => x.id === b.id)?.aliases.join(' ') ?? ''}`).includes(searchLabel(query)))
  return <Dialog dialogRef={dialog.ref} title="إضافة براند للقائمة" onClose={onClose}>
    <p className="mb-5 text-bw-small text-bw-ink-soft">اختار براند موجود في الكتالوج. الإضافة هتفضل مسودة لحد مراجعة وحفظ التعديلات.</p>
    <SearchField label="ابحث عن براند موجود" value={query} onChange={setQuery} />
    <ul className="mt-4 max-h-80 divide-y divide-bw-line overflow-y-auto">{matches.slice(0, 50).map(b => <li key={b.id} className="flex items-center justify-between gap-4 py-3"><bdi className="font-semibold">{b.name}</bdi><Button variant="secondary" aria-label={`إضافة ${b.name}`} onClick={() => { onAdd(b.id); dialog.close() }}><Plus className="size-4" aria-hidden />إضافة</Button></li>)}</ul>
    {!matches.length && <StateBlock kind="empty" title="مفيش براند مطابق" body="جرّب اسمًا تاني. إنشاء براند جديد بيتم من الكتالوج، مش من قائمة السماح." />}
    {matches.length > 50 && <p className="mt-3 text-bw-small text-bw-ink-soft">أول 50 نتيجة. ضيّق البحث للوصول للاسم المطلوب.</p>}
  </Dialog>
}

/** Reusable names are edited separately from central ALLOW/DENY choices. */
export function NameEditor({ task, draft, options, onApply, onClose }: { task: MappingTask; draft: PolicyDocument; options: Options; onApply: (doc: PolicyDocument) => void; onClose: () => void }) {
  const dialog = useDialog()
  const [kind, setKind] = React.useState(task.kind)
  const [id, setId] = React.useState(task.id ?? '')
  const [query, setQuery] = React.useState('')
  const [supplier, setSupplier] = React.useState(task.supplierId ?? options.suppliers[0]?.id ?? '')
  const [label, setLabel] = React.useState(task.label ?? '')
  const existingMapping = draft.mappings.find(m => m.supplierId === task.supplierId && m.label === task.label)
  const [targets, setTargets] = React.useState(existingMapping?.categoryIds ?? [])
  const parents = new Set(draft.categories.map(c => c.parentId))
  const items = kind === 'brand' ? draft.brands : draft.categories.filter(c => !parents.has(c.id))
  const chosen = items.find(i => i.id === id)
  const [aliases, setAliases] = React.useState((chosen?.aliases ?? []).join('\n'))
  React.useEffect(() => { dialog.ref.current?.showModal() }, [dialog.ref])
  const choose = (value: string) => {
    setId(value)
    const item = items.find(i => i.id === value)
    const extra = kind === 'brand' ? task.group?.examples[0]?.brand : task.group?.examples[0]?.category
    setAliases([...new Set([...(item?.aliases ?? []), ...(extra?.trim() ? [extra] : [])])].join('\n'))
  }
  const apply = () => {
    if (kind === 'mapping') {
      const mapping: Mapping = { supplierId: supplier, label: label.trim(), categoryIds: targets }
      onApply({ ...draft, mappings: [...draft.mappings.filter(m => !(m.supplierId === supplier && m.label === label.trim()) && !(task.supplierId && task.label && m.supplierId === task.supplierId && m.label === task.label)), mapping] })
    } else if (kind === 'brand') onApply({ ...draft, brands: draft.brands.map(b => b.id === id ? { ...b, aliases: cleanAliases(aliases.split('\n')) } : b) })
    else onApply({ ...draft, categories: draft.categories.map(c => c.id === id ? { ...c, aliases: cleanAliases(aliases.split('\n')) } : c) })
    dialog.close()
  }
  const canApply = kind === 'mapping' ? supplier && label.trim() && targets.length : Boolean(chosen)
  return <Dialog dialogRef={dialog.ref} title={task.group ? 'حسم اسم متكرر' : 'إدارة الأسماء والربط'} onClose={onClose} footer={<><Button variant="secondary" onClick={dialog.close}>إلغاء</Button><Button disabled={!canApply} onClick={apply}>إضافة التعديل للمسودة</Button></>}>
    <div className="max-h-[60dvh] space-y-5 overflow-y-auto px-1">
      <p className="text-bw-small text-bw-ink-soft">الربط بيتكرر تلقائيًا في الاستيرادات القادمة. مش موافقة على منتج، ومش إضافة لقائمة السماح.</p>
      {task.group && <div className="space-y-2 rounded-bw-field bg-bw-sunken p-3"><p className="font-semibold">{supplierName(options, task.group.supplierId)} · <Code>{task.group.count}</Code> صف</p><p>{task.group.examples[0]?.brand || 'براند ناقص'} · {task.group.examples[0]?.category || 'تصنيف ناقص'}</p></div>}
      <Select label="نوع الاسم" value={kind} onChange={v => { setKind(v as MappingTask['kind']); setId(''); setQuery(''); setAliases('') }} options={[[ 'brand', 'اسم براند — لكل الموردين' ], ['category', 'اسم تصنيف — لكل الموردين'], ['mapping', 'اسم تصنيف — لمورد محدد']]} />
      {kind === 'mapping' ? <>
        <Select label="المورد" value={supplier} onChange={setSupplier} options={options.suppliers.map(s => [s.id, s.name])} />
        <Field label="اسم التصنيف في ملف المورد" value={label} maxLength={200} onChange={e => setLabel(e.target.value)} />
        <SearchField label="ابحث عن التصنيف الصحيح" value={query} onChange={setQuery} />
        <fieldset className="space-y-2"><legend className="mb-2 text-bw-small font-semibold">اختار التصنيف المقصود بعد التحقق</legend><div className="max-h-48 space-y-2 overflow-y-auto">{draft.categories.filter(c => !parents.has(c.id) && (targets.includes(c.id) || searchLabel(c.name).includes(searchLabel(query)))).map(c => <label key={c.id} className="flex min-h-10 items-center gap-3"><input type="checkbox" checked={targets.includes(c.id)} onChange={e => setTargets(e.target.checked ? [...targets, c.id] : targets.filter(id => id !== c.id))} className="size-4 accent-bw-action" /><span>{c.name}</span></label>)}</div></fieldset>
        {targets.length > 1 && <Notice tone="warn" title="الربط لسه ملتبس">اختيار أكثر من تصنيف بيُبقي الصفوف معلّقة. اختار تصنيفًا واحدًا فقط لما يكون المعنى مؤكد.</Notice>}
      </> : <>
        <SearchField label={kind === 'brand' ? 'ابحث عن البراند الصحيح' : 'ابحث عن تصنيف موجود'} value={query} onChange={setQuery} />
        <Select label={kind === 'brand' ? 'البراند المعتمد للاسم' : 'التصنيف المعتمد للاسم'} value={id} onChange={choose} options={[[ '', 'اختار بعد التحقق' ], ...items.filter(i => i.id === id || searchLabel(i.name).includes(searchLabel(query))).map(i => [i.id, `${i.name} — ${effectLabel(i.effect)}`] as [string, string])]} />
        {chosen && <TextArea label="الأسماء البديلة — اسم في كل سطر" value={aliases} onChange={setAliases} rows={5} />}
        {task.group?.suggestions.length && kind === 'brand' ? <p className="text-bw-small text-bw-ink-soft">اقتراحات للمراجعة فقط: {task.group.suggestions.map(s => s.name).join('، ')}. تشابه الاسم لا يكفي لاعتماد الربط.</p> : null}
      </>}
    </div>
  </Dialog>
}

export function HoldList({ groups, options, onResolve, onRecheck, canRecheck }: { groups: HoldGroup[]; options: Options; onResolve: (g: HoldGroup) => void; onRecheck: (g: HoldGroup) => void; canRecheck: boolean }) {
  return <ul className="divide-y divide-bw-line">{groups.map(g => {
    const example = g.examples[0]
    return <li key={`${g.supplierId}:${g.brandKey}:${g.categoryKey}`} className="space-y-3 py-5 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 space-y-1"><p className="break-words font-semibold">{example.brand || 'اسم البراند ناقص'} <span className="font-normal text-bw-ink-soft">/ {example.category || 'التصنيف ناقص'}</span></p><p className="text-bw-small text-bw-ink-soft">{supplierName(options, g.supplierId)} · <Code>{g.count}</Code> صف · <Code>{g.jobCount}</Code> ملف</p></div><StatusLabel tone="warn">معلّق</StatusLabel></div>
      <p className="text-bw-small text-bw-ink-soft">{g.reasons.map(reasonLabel).join(' · ')}</p>
      <details className="text-bw-small"><summary className="cursor-pointer text-bw-ink-soft">عرض أمثلة الأسماء</summary><ul className="mt-2 space-y-1">{g.examples.map(e => <li key={`${e.jobId}:${e.sourceRow}`} className="break-words">{e.name || 'اسم المنتج غير متاح في السجل'}</li>)}</ul></details>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => onResolve(g)}>حسم الربط المتكرر</Button><Button variant="ghost" disabled={!canRecheck} onClick={() => onRecheck(g)}>إعادة فحص المجموعة</Button></div>
    </li>
  })}</ul>
}

export function HistoryView({ onClose }: { onClose: () => void }) {
  const history = useApi<Policy[]>('/ingestion/eligibility/history')
  const dialog = useDialog()
  React.useEffect(() => { dialog.ref.current?.showModal() }, [dialog.ref])
  return <Dialog dialogRef={dialog.ref} title="سجل التعديلات" onClose={onClose}><div className="max-h-[60dvh] overflow-y-auto">
    {history.loading && <Skeleton className="h-40" />}{history.error && <LoadError message={history.error.message} onRetry={history.reload} />}
    <ol className="divide-y divide-bw-line">{history.data?.map(p => <li key={p.id} className="space-y-2 py-4"><div className="flex flex-wrap justify-between gap-2"><strong>إصدار <Code>{p.version}</Code></strong><time className="text-bw-small text-bw-ink-soft">{p.approvedAt ? new Date(p.approvedAt).toLocaleString('ar-EG', { numberingSystem: 'latn' }) : ''}</time></div><p className="break-words">{p.reason}</p><details className="text-bw-small text-bw-ink-soft"><summary className="cursor-pointer">بيانات المسؤول</summary><Code>{p.actorId}</Code></details></li>)}</ol>
    {history.data?.length === 0 && <StateBlock kind="empty" title="لسه مفيش إصدار معتمد" />}
  </div></Dialog>
}
