import * as React from 'react'
import { ArrowRight, ExternalLink, Globe, Loader2, Plus, Search, Sparkles, X } from 'lucide-react'
import { Button, Dialog, Field, Notice, StatusLabel, useDialog } from '@/components/bw/primitives'
import { CommandError } from '@/components/workspace/kit'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { brandMatches, fold, researchNote, sortBrands } from '@/lib/catalog-policy'
import type { BrandResearch, CatalogPolicy, PolicyBrand, ResearchedField, ResearchResponse, SavedBrand } from '@/lib/catalog-policy'
import type { Commit } from './page'
import { Monogram } from './brand-detail'

/*
 * Smart Add Brand: find the canonical Brand first → research the web only when it is truly new → the Admin reviews every
 * sourced field (accept, edit or drop) → one canonical Brand is saved and enabled with no categories. The API labels what is
 * verified; this drawer only displays that and sends back what the Admin kept.
 */
type Step = 'find' | 'researching' | 'review' | 'manual'
type Draft = { name: string; website: string; description: string; country: string; parent: string; aliases: Array<{ value: string; on: boolean; verified: boolean }>; useLogo: boolean; useWebsite: boolean; useDescription: boolean; useCountry: boolean; useParent: boolean }

const text = (field: ResearchedField | null | undefined) => field?.value ?? ''

function toDraft(query: string, r: BrandResearch): Draft {
  const verifiedName = r.name?.status === 'VERIFIED'
  return {
    name: verifiedName ? r.name!.value : query, website: text(r.website), description: text(r.description), country: text(r.country), parent: text(r.parentCompany),
    aliases: r.aliases.map(alias => ({ value: alias.value, on: alias.status === 'VERIFIED' || alias.origin === 'ADMIN', verified: alias.status === 'VERIFIED' })),
    useLogo: r.logo?.status === 'VERIFIED', useWebsite: r.website?.status === 'VERIFIED', useDescription: r.description?.status === 'VERIFIED',
    useCountry: r.country?.status === 'VERIFIED', useParent: r.parentCompany?.status === 'VERIFIED',
  }
}

function Verdict({ field, value }: { field: ResearchedField | null | undefined; value: string }) {
  if (!field) return <StatusLabel tone="neutral">إدخال منك</StatusLabel>
  if (value.trim() && fold(value) !== fold(field.value)) return <StatusLabel tone="neutral">معدّل منك</StatusLabel>
  return field.status === 'VERIFIED' ? <StatusLabel tone="ok">موثّق من الموقع الرسمي</StatusLabel> : <StatusLabel tone="warn">غير مؤكد</StatusLabel>
}

function ReviewRow({ label, field, value, on, onToggle, children, note }: {
  label: string; field: ResearchedField | null | undefined; value: string; on: boolean; onToggle: (on: boolean) => void; children: React.ReactNode; note?: string
}) {
  return <div className={cn('space-y-2 rounded-bw-field border p-3.5 transition-colors', on ? 'border-bw-line-field bg-bw-sunken/50' : 'border-bw-line border-dashed opacity-80')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="inline-flex min-h-8 items-center gap-2 text-bw-small font-semibold">
        <input type="checkbox" className="size-4 accent-bw-action" checked={on} onChange={e => onToggle(e.target.checked)} aria-label={`استخدم ${label}`} />{label}
      </label>
      <span className="flex items-center gap-2"><Verdict field={field} value={value} />
        {field?.sourceUrl && <a href={field.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-bw-small text-bw-ink-soft hover:text-bw-ink"><ExternalLink className="size-3.5" aria-hidden />المصدر</a>}
      </span>
    </div>
    {children}
    {note && <p className="text-bw-small text-bw-ink-soft">{note}</p>}
  </div>
}

const inputClass = 'w-full rounded-bw-field border border-bw-line-field bg-bw-surface px-3.5 text-bw-body text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-action focus:outline-none'

export function AddBrandDrawer({ policy, busy, commit, onPick, onCreated, onClose }: {
  policy: CatalogPolicy; busy: boolean; commit: Commit
  onPick: (brandId: string) => void; onCreated: (brandId: string, version: number, name: string) => void; onClose: () => void
}) {
  const dialog = useDialog()
  const [step, setStep] = React.useState<Step>('find')
  const [query, setQuery] = React.useState('')
  const [website, setWebsite] = React.useState('')
  const [askSite, setAskSite] = React.useState(false)
  const [research, setResearch] = React.useState<{ draftId: string; data: BrandResearch } | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [english, setEnglish] = React.useState('')
  const abort = React.useRef<AbortController | null>(null)
  const queryInput = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { dialog.ref.current?.showModal(); queryInput.current?.focus(); return () => abort.current?.abort() }, [dialog.ref])

  const name = query.normalize('NFKC').replace(/\s+/g, ' ').trim()
  const matches = query.trim() ? sortBrands(policy.brands.filter(b => brandMatches(b, query))).slice(0, 8) : []
  const exact = policy.brands.some(b => [b.name, ...b.aliases].some(label => fold(label) === fold(name)))
  const existingFromError = error?.code === 'BRAND_EXISTS' ? policy.brands.find(b => error.message.startsWith(b.name)) : undefined

  const runResearch = async (searchName = name, alias?: string) => {
    setError(null)
    setStep('researching')
    const controller = new AbortController()
    abort.current = controller
    try {
      const result = await api<ResearchResponse>('/ingestion/eligibility/brands/research', { method: 'POST', body: { name: searchName, ...(alias ? { alias } : {}), ...(askSite && website.trim() ? { websiteUrl: website.trim() } : {}) }, signal: controller.signal })
      setResearch({ draftId: result.draftId, data: result.research })
      setDraft(toDraft(searchName, result.research))
      setStep(result.research.outcome === 'FOUND' || result.research.outcome === 'PARTIAL' ? 'review' : 'manual')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0))
      setStep('find')
    }
  }

  const goManual = () => {
    setError(null)
    setResearch(null)
    setDraft({ name, website: website.trim(), description: '', country: '', parent: '', aliases: [], useLogo: false, useWebsite: Boolean(website.trim()), useDescription: false, useCountry: false, useParent: false })
    setStep('manual')
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const keep = (on: boolean, value: string) => (on && value.trim() ? value.trim() : undefined)
      const result = await api<SavedBrand>('/ingestion/eligibility/brands/from-research', { method: 'POST', body: {
        expectedVersion: policy.version, draftId: research?.draftId, name: draft.name.trim(),
        websiteUrl: keep(draft.useWebsite, draft.website), description: keep(draft.useDescription, draft.description), countryOfOrigin: keep(draft.useCountry, draft.country),
        parentCompany: keep(draft.useParent, draft.parent), aliases: draft.aliases.filter(alias => alias.on).map(alias => alias.value), useLogo: draft.useLogo,
      } })
      onCreated(result.brandId, result.version, draft.name.trim())
      dialog.close()
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0))
    } finally {
      setSaving(false)
    }
  }

  const title = step === 'review' ? 'راجع معلومات البراند' : step === 'manual' ? 'إضافة البراند يدويًا' : step === 'researching' ? 'بنبحث عن البراند' : 'إضافة براند'
  const r = research?.data
  const update = (patch: Partial<Draft>) => setDraft(current => (current ? { ...current, ...patch } : current))

  return <Dialog dialogRef={dialog.ref} variant="drawer" title={title} onClose={() => { abort.current?.abort(); onClose() }}
    footer={step === 'review' || step === 'manual' ? <>
      <Button variant="secondary" disabled={saving} onClick={() => { setStep('find'); setError(null) }}><ArrowRight className="size-4" aria-hidden />رجوع</Button>
      <Button loading={saving} disabled={busy || !draft || draft.name.trim().length < 2} onClick={() => void save()}>حفظ وتفعيل البراند</Button></> : undefined}>
    {step === 'find' && <div className="space-y-5">
      <label className="relative block">
        <span className="mb-1.5 block text-bw-small font-semibold">اسم البراند</span>
        <Search className="pointer-events-none absolute bottom-3.5 start-3 size-4 text-bw-ink-subtle" aria-hidden />
        <input ref={queryInput} type="search" value={query} maxLength={120} onChange={e => { setQuery(e.target.value); setError(null) }} placeholder="بالعربي أو الإنجليزي، مثلًا: CeraVe أو سيرافي"
          className={cn(inputClass, 'h-bw-control ps-9 pe-3')} />
      </label>
      {!query.trim() && <p className="text-bw-small text-bw-ink-soft">ابدأ بكتابة الاسم. لو البراند موجود هنفعّله، ولو جديد هندور عليه ونعرض لك المعلومات تراجعها.</p>}

      {matches.length > 0 && <ul aria-label="براندات موجودة" className="space-y-1">
        {matches.map(brand => <ExistingBrand key={brand.id} brand={brand} busy={busy} onView={() => { onPick(brand.id); dialog.close() }}
          onEnable={async () => { if (await commit(brand, { enabled: true }, `enable:${brand.id}`, `${brand.name} مفعّل`)) { onPick(brand.id); dialog.close() } }} />)}
      </ul>}

      {error && (existingFromError
        ? <Notice tone="info" title={`${existingFromError.name} موجود بالفعل`} action={<Button variant="secondary" onClick={() => { onPick(existingFromError.id); dialog.close() }}>عرض</Button>}>الاسم ده بيشير لنفس البراند، فمش هنعمل نسخة تانية.</Notice>
        : <CommandError error={error} />)}

      {name.length >= 2 && !exact && !existingFromError && <div className="space-y-4 rounded-bw-field border border-dashed border-bw-line-field p-4">
        <p className="text-bw-small text-bw-ink-soft">{matches.length ? 'مش لاقي البراند اللي تقصده في النتايج؟' : 'مفيش براند بالاسم ده في الكتالوج.'}</p>
        {askSite && <Field label="الموقع الرسمي (اختياري)" ltr value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://www.brand.com" hint="لو عارفه، هنقرا منه بدل البحث." />}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => void runResearch()}><Sparkles className="size-4" aria-hidden />ابحث عن معلومات «<bdi>{name}</bdi>»</Button>
          {!askSite && <Button variant="ghost" onClick={() => setAskSite(true)}><Globe className="size-4" aria-hidden />عندي الموقع الرسمي</Button>}
        </div>
        <button type="button" onClick={goManual} className="text-bw-small text-bw-ink-soft underline-offset-4 hover:text-bw-ink hover:underline">إضافة يدويًا من غير بحث</button>
      </div>}
    </div>}

    {step === 'researching' && <div className="space-y-5 py-6 text-center" role="status" aria-live="polite">
      <Loader2 className="mx-auto size-8 animate-spin text-bw-ink-subtle" aria-hidden />
      <div className="space-y-1">
        <p className="text-bw-heading font-semibold">بندور على الموقع الرسمي لـ <bdi>{name}</bdi></p>
        <p className="text-bw-small text-bw-ink-soft">بنقرا صفحة البراند نفسها بس، وممكن ياخد لحد نص دقيقة. مفيش حاجة هتتحفظ قبل ما تراجعها.</p>
      </div>
      <Button variant="secondary" onClick={() => { abort.current?.abort(); setStep('find') }}>إلغاء</Button>
    </div>}

    {(step === 'review' || step === 'manual') && draft && <div className="space-y-4">
      {step === 'manual' && <Notice tone={r ? 'warn' : 'info'} title={r ? 'ملقيناش معلومات كفاية' : 'إدخال يدوي'}>
        {r ? r.notes.map(researchNote).join(' ') || 'البحث ماطلعش بنتيجة.' : 'اللي هتكتبه بيتسجل إنه إدخال منك، مش معلومة موثّقة.'} كمّل بالبيانات اللي تعرفها، وكلها اختيارية ما عدا الاسم.
      </Notice>}
      {step === 'manual' && r?.notes.includes('NEEDS_LATIN_NAME') && <form className="space-y-3 rounded-bw-field border border-dashed border-bw-line-field p-3.5" onSubmit={e => { e.preventDefault(); if (/[a-z]/i.test(english)) void runResearch(english.trim(), draft.name.trim()) }}>
        <Field label="الاسم بالإنجليزي" ltr value={english} onChange={e => setEnglish(e.target.value)} placeholder="CeraVe" hint="بنستخدمه بس عشان نلاقي ونأكد الموقع الرسمي. الاسم العربي بيتحفظ كاسم بديل." />
        <Button type="submit" variant="secondary" disabled={!/[a-z]/i.test(english)}><Sparkles className="size-4" aria-hidden />ابحث بالاسم الإنجليزي</Button>
      </form>}
      {step === 'review' && r && <>
        {r.site && <p className="flex flex-wrap items-center gap-2 text-bw-small text-bw-ink-soft"><Globe className="size-4" aria-hidden />قرينا <a href={r.site.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-bw-ink underline-offset-4 hover:underline"><bdi dir="ltr">{r.site.host}</bdi></a>
          {r.site.verifiedOfficial ? <StatusLabel tone="ok">دومين البراند</StatusLabel> : <StatusLabel tone="warn">مش دومين البراند</StatusLabel>}</p>}
        {r.notes.filter(n => n !== 'LOGO_NOT_FOUND' || !r.logo).map(n => <p key={n} className="text-bw-small text-bw-warn">{researchNote(n)}</p>)}
      </>}

      <div className="space-y-2 rounded-bw-field border border-bw-line-field bg-bw-sunken/50 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="brand-name" className="text-bw-small font-semibold">اسم البراند</label><Verdict field={r?.name} value={draft.name} /></div>
        <input id="brand-name" className={cn(inputClass, 'h-bw-control')} value={draft.name} maxLength={120} onChange={e => update({ name: e.target.value })} />
        {r?.name && r.name.status === 'UNVERIFIED' && fold(r.name.value) !== fold(draft.name) && <button type="button" className="text-bw-small text-bw-ink-soft underline-offset-4 hover:text-bw-ink hover:underline" onClick={() => update({ name: r.name!.value })}>الاسم على الموقع: <bdi>{r.name.value}</bdi> — استخدمه</button>}
      </div>

      {r?.logo && <ReviewRow label="اللوجو" field={r.logo} value={r.logo.value} on={draft.useLogo} onToggle={on => update({ useLogo: on })} note="بيتحفظ نفس الملف اللي على الموقع الرسمي، من غير أي تعديل.">
        <img src={r.logo.value} alt={`لوجو ${draft.name}`} referrerPolicy="no-referrer" className="h-16 max-w-48 rounded-bw-field bg-white object-contain p-2" />
      </ReviewRow>}

      <ReviewRow label="الموقع الرسمي" field={r?.website} value={draft.website} on={draft.useWebsite} onToggle={on => update({ useWebsite: on })}>
        <input dir="ltr" className={cn(inputClass, 'h-bw-control bw-code text-start')} value={draft.website} placeholder="https://" onChange={e => update({ website: e.target.value, useWebsite: true })} />
      </ReviewRow>

      <ReviewRow label="نبذة قصيرة" field={r?.description} value={draft.description} on={draft.useDescription} onToggle={on => update({ useDescription: on })}>
        <textarea className={cn(inputClass, 'min-h-20 py-2.5')} rows={3} maxLength={600} value={draft.description} onChange={e => update({ description: e.target.value, useDescription: true })} />
      </ReviewRow>

      <ReviewRow label="بلد المنشأ" field={r?.country} value={draft.country} on={draft.useCountry} onToggle={on => update({ useCountry: on })}
        note={r?.country?.note === 'ADDRESS_NOT_ORIGIN' ? 'ده بلد عنوان الشركة على الموقع، مش بالضرورة بلد المنشأ.' : undefined}>
        <input className={cn(inputClass, 'h-bw-control')} value={draft.country} maxLength={80} onChange={e => update({ country: e.target.value, useCountry: true })} />
      </ReviewRow>

      {(r?.parentCompany || draft.parent) && <ReviewRow label="الشركة الأم" field={r?.parentCompany} value={draft.parent} on={draft.useParent} onToggle={on => update({ useParent: on })} note="بتتسجل كمرجع في أدلة البراند، مش كبراند تاني.">
        <input className={cn(inputClass, 'h-bw-control')} value={draft.parent} maxLength={160} onChange={e => update({ parent: e.target.value, useParent: true })} />
      </ReviewRow>}

      {draft.aliases.length > 0 && <div className="space-y-2">
        <p className="text-bw-small font-semibold">أسماء بديلة <span className="font-normal text-bw-ink-soft">— بيتعرف بيها البراند في ملفات الموردين</span></p>
        <ul className="flex flex-wrap gap-2">{draft.aliases.map((alias, index) => <li key={alias.value}>
          <button type="button" aria-pressed={alias.on} onClick={() => update({ aliases: draft.aliases.map((a, i) => (i === index ? { ...a, on: !a.on } : a)) })}
            className={cn('inline-flex min-h-bw-control items-center gap-2 rounded-bw-pill border px-3.5 text-bw-small', alias.on ? 'border-bw-ink-subtle bg-bw-action-soft text-bw-ink' : 'border-dashed border-bw-line text-bw-ink-soft line-through')}>
            <bdi>{alias.value}</bdi>{alias.on ? <X className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
          </button></li>)}</ul>
      </div>}

      {r && r.references.length > 0 && <details className="text-bw-small"><summary className="cursor-pointer text-bw-ink-soft">صفحات تانية ظهرت في البحث (للمراجعة بس)</summary>
        <ul className="mt-2 space-y-1.5">{r.references.map(ref => <li key={ref.url}><a href={ref.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-bw-ink-soft hover:text-bw-ink"><ExternalLink className="size-3.5 shrink-0" aria-hidden /><bdi dir="ltr" className="break-all">{ref.host}</bdi> — {ref.title}</a></li>)}</ul></details>}

      <CommandError error={error} />
      <p className="text-bw-small text-bw-ink-soft">بعد الحفظ البراند بيتفعّل من غير أي تصنيف، فمفيش منتجات هتدخل لحد ما تختار التصنيفات. والمنتجات ماتنشرش تلقائيًا أبدًا.</p>
    </div>}
  </Dialog>
}

function ExistingBrand({ brand, busy, onView, onEnable }: { brand: PolicyBrand; busy: boolean; onView: () => void; onEnable: () => Promise<void> }) {
  const [pending, setPending] = React.useState(false)
  return <li className="flex items-center gap-3 rounded-bw-field border border-bw-line px-3 py-2.5">
    <Monogram name={brand.name} muted={!brand.enabled} />
    <span className="min-w-0 flex-1">
      <bdi className="block truncate font-semibold">{brand.name}</bdi>
      <span className="block text-bw-small text-bw-ink-subtle">{brand.enabled ? 'مفعّل بالفعل' : brand.isActive ? 'موجود في الكتالوج · موقوف' : 'غير نشط في الكتالوج'}</span>
    </span>
    {brand.enabled ? <Button variant="ghost" onClick={onView}>عرض</Button>
      : <Button variant="secondary" disabled={busy || !brand.isActive} loading={pending} onClick={async () => { setPending(true); try { await onEnable() } finally { setPending(false) } }}>تفعيل</Button>}
  </li>
}
