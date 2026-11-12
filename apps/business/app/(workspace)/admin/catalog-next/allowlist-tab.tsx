'use client'

import * as React from 'react'
import { CheckCircle2, FlaskConical, History, Pencil, Plus, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import { Button, Code, Dialog, Field, Select, Skeleton, StateBlock, Switch, useDialog } from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import {
  BrandSummary,
  CategoryNode,
  FlatRule,
  PolicyDocument,
  PolicyEvaluationResult,
  PolicyRuleEffect,
  PolicyStateResponse,
  RULE_KIND_LABELS,
  RuleKind,
  catalogErrorMessage,
  flattenCategories,
  flattenPolicy,
  policyReasonLabel,
  ruleEffectText,
  withRuleRemoved,
} from './catalog-model'
import { Banner, Dot, RowMenu, SearchBox } from './ui'

const EMPTY: PolicyDocument = { mode: 'OPEN', brands: [], categories: [], brandCategoryRules: [], excludedTerms: [], disabledExcludedClasses: [] }
const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')

type Pending = { title: string; body: string; next: PolicyDocument; done: string }

export function AllowlistTab({ brands, categories }: { brands: BrandSummary[]; categories: CategoryNode[] }) {
  const policy = useApi<PolicyStateResponse>('/catalog/policy')
  const [query, setQuery] = React.useState('')
  const [notice, setNotice] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<FlatRule | null>(null)
  const [pending, setPending] = React.useState<Pending | null>(null)
  const ruleDialog = useDialog()
  const reasonDialog = useDialog()
  const testDialog = useDialog()
  const historyDialog = useDialog()
  const later = (fn: () => void) => window.setTimeout(fn, 0)

  const doc = policy.data?.current.document ?? EMPTY
  const system = policy.data?.systemExcludedClasses ?? []
  const rules = React.useMemo(() => flattenPolicy(doc, system), [doc, system])
  const q = fold(query.trim())
  const shown = rules.filter((r) => !q || fold(`${r.title} ${r.detail ?? ''} ${RULE_KIND_LABELS[r.kind]}`).includes(q))
  const custom = shown.filter((r) => r.kind !== 'system')
  const builtIn = shown.filter((r) => r.kind === 'system')

  const stage = (p: Pending) => { setPending(p); later(() => reasonDialog.open()) }

  if (policy.loading && !policy.data) return <Skeleton className="h-64 w-full" />
  if (policy.error) return <LoadError message={policy.error.message} onRetry={policy.reload} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} label="بحث في القواعد" placeholder="ماركة أو تصنيف أو عبارة" />
        <div role="radiogroup" aria-label="وضع السياسة" className="inline-flex rounded-bw-field border border-bw-line p-0.5">
          {([['OPEN', 'مفتوح'], ['ALLOWLIST_ONLY', 'حصري']] as const).map(([value, text]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={doc.mode === value}
              onClick={() => {
                if (doc.mode === value) return
                stage({
                  title: value === 'OPEN' ? 'التحويل إلى الوضع المفتوح' : 'التحويل إلى الوضع الحصري',
                  body: value === 'OPEN' ? 'تمرّ الماركات المعروفة، ويُستبعد الممنوع فقط.' : 'تمرّ الماركات والتصنيفات المسموح بها صراحةً، والمعرّفات الموثقة (باركود). وتُستبعد البقية مبكرًا.',
                  next: { ...doc, mode: value },
                  done: value === 'OPEN' ? 'أصبح الوضع مفتوحًا' : 'أصبح الوضع حصريًا',
                })
              }}
              className={cn('min-h-8 rounded-bw-field px-3 text-bw-small transition-colors', doc.mode === value ? 'bg-bw-sunken font-semibold text-bw-ink' : 'text-bw-ink-soft hover:text-bw-ink')}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-1">
          <Button onClick={() => { setEditing(null); later(() => ruleDialog.open()) }}><Plus className="size-4" aria-hidden />إضافة قاعدة</Button>
          <RowMenu label="المزيد" actions={[
            { label: 'اختبار منتج', icon: FlaskConical, onSelect: () => later(() => testDialog.open()) },
            { label: 'سجل الإصدارات', icon: History, onSelect: () => later(() => historyDialog.open()) },
          ]} />
        </div>
      </div>

      <p className="text-bw-small text-bw-ink-soft">
        الإصدار <Code>{`v${policy.data?.current.version ?? 0}`}</Code> · تنطبق القواعد على فحص ملفات الموردين الجديدة فقط، ولا تحذف أو توقف أي منتج موجود.
      </p>

      {notice ? <Banner tone="ok" onClose={() => setNotice(null)}>{notice}</Banner> : null}

      {custom.length === 0 && !q ? (
        <StateBlock kind="empty" title="لا توجد قواعد مخصصة" body={doc.mode === 'OPEN' ? 'الوضع مفتوح: تمرّ الماركات المعروفة ويُستبعد الممنوع تلقائيًا. أضف قاعدة لمنع ماركة أو تصنيف.' : 'الوضع حصري ولا توجد قواعد سماح، فيُستبعد كل شيء عدا المعرّفات الموثقة.'} />
      ) : null}
      {shown.length === 0 && q ? <StateBlock kind="empty" title="لا توجد قاعدة مطابقة" /> : null}

      {custom.length > 0 ? (
        <ul className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-surface">
          {custom.map((rule) => <RuleRow key={rule.key} rule={rule} actions={[
            ...(rule.kind === 'term' ? [] : [{ label: 'تعديل', icon: Pencil, onSelect: () => { setEditing(rule); later(() => ruleDialog.open()) } }]),
            { label: 'حذف القاعدة', icon: Trash2, tone: 'danger' as const, onSelect: () => stage({ title: 'حذف القاعدة', body: `ستُزال القاعدة «${rule.title}» من السياسة.`, next: withRuleRemoved(doc, rule), done: 'تم حذف القاعدة' }) },
          ]} />)}
        </ul>
      ) : null}

      {builtIn.length > 0 ? (
        <details className="group rounded-bw-card border border-bw-line bg-bw-surface">
          <summary className="flex min-h-bw-control cursor-pointer list-none items-center justify-between px-4 text-bw-small font-semibold text-bw-ink-soft">
            قواعد النظام المدمجة <Code>{builtIn.length}</Code>
          </summary>
          <ul className="divide-y divide-bw-line border-t border-bw-line">
            {builtIn.map((rule) => {
              const off = rule.effect === 'SYSTEM_OFF'
              return <RuleRow key={rule.key} rule={rule} actions={[{
                label: off ? 'تفعيل الاستبعاد' : 'تعطيل الاستبعاد',
                icon: off ? CheckCircle2 : XCircle,
                onSelect: () => stage({
                  title: off ? 'تفعيل الاستبعاد التلقائي' : 'تعطيل الاستبعاد التلقائي',
                  body: off ? `سيُستبعد كل ما يخص «${rule.title}» من جديد.` : `لن يُستبعد ما يخص «${rule.title}» تلقائيًا. يبقى للمراجعة.`,
                  next: { ...doc, disabledExcludedClasses: off ? doc.disabledExcludedClasses.filter((k) => k !== rule.detail) : [...doc.disabledExcludedClasses, rule.detail ?? ''] },
                  done: off ? 'تم تفعيل الاستبعاد' : 'تم تعطيل الاستبعاد',
                }),
              }]} />
            })}
          </ul>
        </details>
      ) : null}

      <RuleModal
        key={editing?.key ?? 'new'}
        dialogRef={ruleDialog.ref}
        rule={editing}
        doc={doc}
        brands={brands}
        categories={categories}
        onClose={() => ruleDialog.close()}
        onSaved={(message) => { ruleDialog.close(); setNotice(message); policy.reload() }}
      />
      <ReasonDialog dialogRef={reasonDialog.ref} pending={pending} onClose={() => reasonDialog.close()} onSaved={(message) => { reasonDialog.close(); setNotice(message); policy.reload() }} />
      <TestDialog dialogRef={testDialog.ref} brands={brands} categories={categories} onClose={() => testDialog.close()} />
      <HistoryDialog dialogRef={historyDialog.ref} history={policy.data?.history ?? []} onClose={() => historyDialog.close()} />
    </div>
  )
}

function RuleRow({ rule, actions }: { rule: FlatRule; actions: Array<{ label: string; icon?: React.ElementType; onSelect: () => void; tone?: 'default' | 'danger' }> }) {
  const effect = ruleEffectText(rule.effect)
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 md:px-4">
      <span className="hidden w-24 shrink-0 text-[12px] text-bw-ink-subtle sm:block">{RULE_KIND_LABELS[rule.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="break-words font-semibold text-bw-ink"><bdi>{rule.title}</bdi></p>
        {rule.detail && rule.kind !== 'system' ? <p className="truncate text-[12px] text-bw-ink-soft">{rule.detail}</p> : null}
        <p className="text-[12px] text-bw-ink-subtle sm:hidden">{RULE_KIND_LABELS[rule.kind]}</p>
      </div>
      <Dot tone={effect.tone === 'ok' ? 'ok' : effect.tone === 'danger' ? 'danger' : 'muted'}>{effect.text}</Dot>
      <RowMenu label={`إجراءات ${rule.title}`} actions={actions} />
    </li>
  )
}

/* ── One modal for adding and editing a rule. Saving writes a new policy version immediately. ── */

function RuleModal({ dialogRef, rule, doc, brands, categories, onClose, onSaved }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  rule: FlatRule | null
  doc: PolicyDocument
  brands: BrandSummary[]
  categories: CategoryNode[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const flat = React.useMemo(() => flattenCategories(categories), [categories])
  const current = rule
  const brandRule = current?.kind === 'brand' ? doc.brands[current.index] : null
  const catRule = current?.kind === 'category' ? doc.categories[current.index] : null
  const pairRule = current?.kind === 'pair' ? doc.brandCategoryRules[current.index] : null

  const [kind, setKind] = React.useState<RuleKind>(current?.kind ?? 'brand')
  const [effect, setEffect] = React.useState<PolicyRuleEffect>(
    (brandRule?.effect ?? catRule?.effect ?? pairRule?.effect ?? 'ALLOW') as PolicyRuleEffect,
  )
  const [brandId, setBrandId] = React.useState(brandRule?.id ?? pairRule?.brandId ?? '')
  const [externalBrand, setExternalBrand] = React.useState(brandRule && !brandRule.id ? brandRule.name : '')
  const [aliases, setAliases] = React.useState((brandRule?.aliases ?? []).join('، '))
  const [categoryId, setCategoryId] = React.useState(catRule?.id ?? pairRule?.categoryId ?? '')
  const [term, setTerm] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const isEdit = current !== null

  const build = (): PolicyDocument | string => {
    const aliasList = aliases.split(/[,،]+/).map((s) => s.trim()).filter(Boolean)
    if (kind === 'term') {
      const t = term.trim()
      if (t.length < 2) return 'اكتب عبارة من حرفين على الأقل'
      if (doc.excludedTerms.some((x) => fold(x) === fold(t))) return 'هذه العبارة موجودة بالفعل'
      return { ...doc, excludedTerms: [...doc.excludedTerms, t] }
    }
    if (kind === 'brand') {
      const chosen = brands.find((b) => b.id === brandId)
      const label = chosen?.name ?? externalBrand.trim()
      if (!chosen && !(effect === 'DENY' && label)) return 'اختر ماركة من الكتالوج، أو اكتب اسم ماركة خارجية لمنعها'
      const next = { ...(chosen ? { id: chosen.id } : {}), name: label, effect, aliases: aliasList.length ? aliasList : chosen?.aliases ?? [] }
      const dupe = doc.brands.findIndex((b) => (chosen ? b.id === chosen.id : !b.id && fold(b.name) === fold(label)))
      if (dupe !== -1 && dupe !== current?.index) return `قاعدة «${label}» موجودة بالفعل. عدّلها بدل إضافة أخرى`
      return { ...doc, brands: isEdit ? doc.brands.map((b, i) => (i === current.index ? next : b)) : [...doc.brands, next] }
    }
    if (kind === 'category') {
      const chosen = flat.find((c) => c.id === categoryId)
      if (!chosen) return 'اختر تصنيفًا'
      const next = { id: chosen.id, name: chosen.name, effect }
      const dupe = doc.categories.findIndex((c) => c.id === chosen.id)
      if (dupe !== -1 && dupe !== current?.index) return `قاعدة «${chosen.name}» موجودة بالفعل. عدّلها بدل إضافة أخرى`
      return { ...doc, categories: isEdit ? doc.categories.map((c, i) => (i === current.index ? next : c)) : [...doc.categories, next] }
    }
    const brand = brands.find((b) => b.id === brandId)
    const cat = flat.find((c) => c.id === categoryId)
    if (!brand || !cat) return 'اختر الماركة والتصنيف'
    const next = { brandId: brand.id, brandName: brand.name, categoryId: cat.id, categoryName: cat.name, effect }
    const dupe = doc.brandCategoryRules.findIndex((r) => r.brandId === brand.id && r.categoryId === cat.id)
    if (dupe !== -1 && dupe !== current?.index) return 'هذا الاستثناء موجود بالفعل. عدّله بدل إضافة آخر'
    return { ...doc, brandCategoryRules: isEdit ? doc.brandCategoryRules.map((r, i) => (i === current.index ? next : r)) : [...doc.brandCategoryRules, next] }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const next = build()
    if (typeof next === 'string') { setError(next); return }
    if (reason.trim().length < 3) { setError('اكتب سببًا من 3 أحرف على الأقل. يُسجَّل في سجل الإصدارات'); return }
    setBusy(true)
    setError(null)
    try {
      await api('/catalog/policy', { method: 'PUT', body: { ...next, reason: reason.trim() } })
      onSaved(isEdit ? 'تم تحديث القاعدة وحفظ إصدار جديد' : 'تمت إضافة القاعدة وحفظ إصدار جديد')
    } catch (err) {
      setError(catalogErrorMessage(err as ApiError, 'تعذر حفظ القاعدة'))
    } finally {
      setBusy(false)
    }
  }

  const effectOptions = (
    <fieldset>
      <legend className="mb-1.5 text-bw-small font-semibold text-bw-ink">الحكم</legend>
      <div className="inline-flex rounded-bw-field border border-bw-line p-0.5">
        {([['ALLOW', 'مسموح'], ['DENY', 'مستبعد']] as const).map(([value, text]) => (
          <button key={value} type="button" aria-pressed={effect === value} onClick={() => setEffect(value)}
            className={cn('min-h-9 rounded-bw-field px-4 text-bw-small transition-colors', effect === value ? (value === 'ALLOW' ? 'bg-bw-emerald-soft font-semibold text-bw-emerald' : 'bg-bw-rose-soft font-semibold text-bw-rose') : 'text-bw-ink-soft hover:text-bw-ink')}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  )

  return (
    <Dialog
      dialogRef={dialogRef}
      title={isEdit ? 'تعديل قاعدة' : 'إضافة قاعدة'}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" form="rule-form" loading={busy}>حفظ</Button></>}
    >
      <form id="rule-form" dir="rtl" onSubmit={submit} className="space-y-4">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Select label="نوع القاعدة" value={kind} disabled={isEdit} onChange={(e) => { setKind(e.target.value as RuleKind); if (e.target.value === 'term') setEffect('DENY') }}
          options={[{ value: 'brand', label: 'ماركة' }, { value: 'category', label: 'تصنيف' }, { value: 'pair', label: 'ماركة + تصنيف' }, { value: 'term', label: 'عبارة مستبعدة' }]} />

        {kind === 'brand' ? (
          <>
            <Select label="الماركة" value={brandId} disabled={isEdit && Boolean(brandRule?.id)} onChange={(e) => { setBrandId(e.target.value); if (e.target.value) setExternalBrand('') }}
              options={[{ value: '', label: effect === 'DENY' ? 'ماركة خارج الكتالوج…' : 'اختر ماركة' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} />
            {!brandId && effect === 'DENY' ? <Field label="اسم الماركة الخارجية" value={externalBrand} onChange={(e) => setExternalBrand(e.target.value)} hint="تُمنع بالاسم دون إضافتها للكتالوج" /> : null}
            <Field label="أسماء بديلة" value={aliases} onChange={(e) => setAliases(e.target.value)} hint="اختياري، افصل بفاصلة" />
          </>
        ) : null}
        {kind === 'category' ? (
          <Select label="التصنيف" value={categoryId} disabled={isEdit} onChange={(e) => setCategoryId(e.target.value)} options={[{ value: '', label: 'اختر تصنيفًا' }, ...flat.map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} ← ${c.name}` : c.name }))]} />
        ) : null}
        {kind === 'pair' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="الماركة" value={brandId} disabled={isEdit} onChange={(e) => setBrandId(e.target.value)} options={[{ value: '', label: 'اختر ماركة' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} />
            <Select label="التصنيف" value={categoryId} disabled={isEdit} onChange={(e) => setCategoryId(e.target.value)} options={[{ value: '', label: 'اختر تصنيفًا' }, ...flat.map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} ← ${c.name}` : c.name }))]} />
          </div>
        ) : null}
        {kind === 'term' ? <Field label="العبارة" value={term} onChange={(e) => setTerm(e.target.value)} hint="أي سطر مورد يحتويها يُستبعد، بالعربية أو الإنجليزية" autoFocus /> : effectOptions}

        <Field label="سبب التعديل (يُسجَّل)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: منع ماركة خارج نطاق المتجر" />
      </form>
    </Dialog>
  )
}

/* ── Mode / delete / built-in toggles: only the audited reason is asked ─────────────────────── */

function ReasonDialog({ dialogRef, pending, onClose, onSaved }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  pending: Pending | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { setReason(''); setError(null) }, [pending])
  return (
    <Dialog
      dialogRef={dialogRef}
      title={pending?.title ?? ''}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" form="policy-reason" loading={busy} disabled={reason.trim().length < 3}>تأكيد</Button></>}
    >
      <form id="policy-reason" dir="rtl" className="space-y-4" onSubmit={async (e) => {
        e.preventDefault()
        if (!pending) return
        setBusy(true)
        setError(null)
        try {
          await api('/catalog/policy', { method: 'PUT', body: { ...pending.next, reason: reason.trim() } })
          onSaved(pending.done)
        } catch (err) {
          setError(catalogErrorMessage(err as ApiError, 'تعذر حفظ السياسة'))
        } finally {
          setBusy(false)
        }
      }}>
        <p className="text-bw-small text-bw-ink-soft">{pending?.body}</p>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="السبب (يُسجَّل)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </form>
    </Dialog>
  )
}

/* ── Test a candidate against the real engine; nothing is saved ───────────────────────────────── */

function TestDialog({ dialogRef, brands, categories, onClose }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  brands: BrandSummary[]
  categories: CategoryNode[]
  onClose: () => void
}) {
  const flat = React.useMemo(() => flattenCategories(categories), [categories])
  const [title, setTitle] = React.useState('')
  const [brandId, setBrandId] = React.useState('')
  const [categoryId, setCategoryId] = React.useState('')
  const [hardId, setHardId] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<PolicyEvaluationResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const run = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) { setError('اكتب عنوان المنتج'); return }
    setBusy(true)
    setError(null)
    try {
      const brand = brands.find((b) => b.id === brandId)
      setResult(await api<PolicyEvaluationResult>('/catalog/policy/evaluate', { method: 'POST', body: { title: title.trim(), ...(brand ? { brandId: brand.id, brandName: brand.name } : {}), ...(categoryId ? { categoryId } : {}), hasHardIdentifier: hardId } }))
    } catch (err) {
      setError(catalogErrorMessage(err as ApiError, 'تعذر تشغيل الاختبار'))
    } finally {
      setBusy(false)
    }
  }

  const outcome = result?.outcome
  return (
    <Dialog dialogRef={dialogRef} title="اختبار منتج مقابل السياسة" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>إغلاق</Button><Button type="submit" form="policy-test" loading={busy}>اختبار</Button></>}>
      <form id="policy-test" dir="rtl" onSubmit={run} className="space-y-4">
        <p className="text-bw-small text-bw-ink-soft">يستخدم آخر إصدار محفوظ ولا يغيّر أي بيانات.</p>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="عنوان المنتج كما يظهر في ملف المورد" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: غسول سيرافي للبشرة الدهنية 236 مل" autoFocus />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="الماركة" value={brandId} onChange={(e) => setBrandId(e.target.value)} options={[{ value: '', label: 'اكتشاف تلقائي' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} />
          <Select label="التصنيف" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={[{ value: '', label: 'غير محدد' }, ...flat.map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} ← ${c.name}` : c.name }))]} />
        </div>
        <Switch label="السطر يحمل باركودًا أو كودًا معروفًا" checked={hardId} onChange={(e) => setHardId(e.target.checked)} />
        {result ? (
          <div className={cn('space-y-1 rounded-bw-field border p-3 text-bw-small', outcome === 'ALLOW' ? 'border-bw-emerald/30 bg-bw-emerald-soft' : outcome === 'SKIP' ? 'border-bw-rose/30 bg-bw-rose-soft' : 'border-bw-amber/30 bg-bw-amber-soft')}>
            <p className="flex items-center gap-2 font-semibold text-bw-ink">
              {outcome === 'ALLOW' ? <><CheckCircle2 className="size-4 text-bw-emerald" aria-hidden />يمرّ إلى المطابقة</> : outcome === 'SKIP' ? <><XCircle className="size-4 text-bw-rose" aria-hidden />يُستبعد تلقائيًا</> : <><ShieldAlert className="size-4 text-bw-amber" aria-hidden />يُحوَّل للمراجعة</>}
            </p>
            <p className="text-bw-ink">{policyReasonLabel(result.reasonCode)}</p>
            {result.detail ? <p className="text-[12px] text-bw-ink-soft">{result.detail}</p> : null}
            {result.matchedBrands.length ? <p className="text-[12px] text-bw-ink-soft">الماركات المكتشفة: {result.matchedBrands.map((b) => b.label).join('، ')}</p> : null}
            <p className="text-[12px] text-bw-ink-subtle">مسموح بالإدخال لا يعني منشورًا، والمطابقة مع منتج موجود لا تنشئ منتجًا جديدًا.</p>
          </div>
        ) : null}
      </form>
    </Dialog>
  )
}

function HistoryDialog({ dialogRef, history, onClose }: { dialogRef: React.RefObject<HTMLDialogElement | null>; history: PolicyStateResponse['history']; onClose: () => void }) {
  return (
    <Dialog dialogRef={dialogRef} title="سجل الإصدارات" onClose={onClose}>
      <ul dir="rtl" className="divide-y divide-bw-line text-bw-small">
        {history.length === 0 ? <li className="py-2 text-bw-ink-soft">لا توجد إصدارات بعد.</li> : history.map((h) => (
          <li key={h.id} className="flex items-baseline gap-3 py-2">
            <Code className="font-semibold">{`v${h.version ?? 0}`}</Code>
            <span className="min-w-0 flex-1 text-bw-ink">{h.reason}</span>
            <span className="shrink-0 text-[12px] text-bw-ink-subtle">{h.approvedAt ? new Date(h.approvedAt).toLocaleDateString('ar-EG') : '—'}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
