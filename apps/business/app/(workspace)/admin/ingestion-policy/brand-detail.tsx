import * as React from 'react'
import { ArrowRight, Check, Loader2, Plus, Search, Undo2 } from 'lucide-react'
import { Button, Code, Dialog, Field, Notice, Skeleton, StateBlock, StatusLabel, Switch, useDialog } from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { formatDate, leafGroups } from '@/lib/catalog-policy'
import type { BrandIdentity, BrandProduct, PolicyBrand, PolicyCategory } from '@/lib/catalog-policy'
import type { Commit } from './page'

/** The brand's saved official logo when it has one; otherwise its initial in type. Never a drawn logo. */
export function Monogram({ name, muted, large, logoUrl }: { name: string; muted?: boolean; large?: boolean; logoUrl?: string | null }) {
  const letter = [...name.trim()][0]?.toLocaleUpperCase() ?? '؟'
  if (logoUrl) return <img src={logoUrl} alt="" className={cn('shrink-0 rounded-bw-field border border-bw-line bg-white object-contain p-1', large ? 'size-14' : 'size-9', muted && 'opacity-60')} />
  return <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-bw-field border border-bw-line font-bw-display font-semibold',
    large ? 'size-14 text-bw-title' : 'size-9 text-bw-body', muted ? 'bg-bw-page text-bw-ink-subtle' : 'bg-bw-sunken text-bw-ink')}>{letter}</span>
}

export function BrandDetail({ brand, categories, busy, pending, onToggle, commit, onBack }: {
  brand: PolicyBrand; categories: PolicyCategory[]; busy: boolean; pending: string | null
  onToggle: () => void; commit: Commit; onBack: () => void
}) {
  const [excluding, setExcluding] = React.useState(false)
  const groups = React.useMemo(() => leafGroups(categories), [categories])
  const allowed = new Set(brand.categoryIds)
  const leafCount = groups.reduce((n, g) => n + g.leaves.length, 0)
  const toggleLeaf = (leaf: PolicyCategory) => {
    const next = allowed.has(leaf.id) ? brand.categoryIds.filter(id => id !== leaf.id) : [...brand.categoryIds, leaf.id]
    void commit(brand, { categoryIds: next }, `leaf:${leaf.id}`, allowed.has(leaf.id) ? `${leaf.name} اتشال من ${brand.name}` : `${leaf.name} مسموح لـ ${brand.name}`)
  }

  return <article aria-labelledby="brand-title" className="bw-panel space-y-8 p-5 sm:p-7">
    <button type="button" onClick={onBack} className="-mt-1 inline-flex min-h-bw-control items-center gap-1.5 text-bw-small text-bw-ink-soft hover:text-bw-ink lg:hidden">
      <ArrowRight className="size-4" aria-hidden />كل البراندات
    </button>

    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <Monogram name={brand.name} muted={!brand.enabled} large logoUrl={brand.logoUrl} />
        <div className="min-w-0 space-y-1">
          <h2 id="brand-title" className="font-bw-display text-bw-title font-semibold"><bdi>{brand.name}</bdi></h2>
          <p className="text-bw-small text-bw-ink-soft">
            <Code>{brand.productCount}</Code> {brand.productCount === 1 ? 'منتج' : 'منتجات'} في الكتالوج
            {brand.aliases.length > 0 && <> · بيتعرف كمان باسم <bdi>{brand.aliases.slice(0, 3).join('، ')}</bdi></>}
          </p>
        </div>
      </div>
      <Switch label={brand.enabled ? 'بيقبل منتجات' : 'موقوف'} aria-label={`قبول منتجات ${brand.name}`} checked={brand.enabled}
        onChange={onToggle} disabled={busy || (!brand.isActive && !brand.enabled)} className="font-semibold" />
    </header>

    <IdentityPanel brand={brand} />

    {!brand.isActive && <Notice tone="neutral" title="البراند غير نشط في الكتالوج">تفعيله هنا متاح بعد ما يرجع نشط من الكتالوج.</Notice>}
    {brand.isActive && !brand.enabled && <Notice tone="neutral" title="البراند موقوف">أي منتج منه في الملفات الجديدة بيتخطّى تلقائيًا. التصنيفات المختارة تحت محفوظة لو فعّلته تاني.</Notice>}
    {brand.enabled && !brand.categoryIds.length && <Notice tone="warn" title="اختار تصنيف واحد على الأقل">لحد ما تختار، مفيش منتجات من البراند ده هتدخل الكتالوج.</Notice>}

    <section aria-labelledby="leaves-title" className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="leaves-title" className="text-bw-heading font-semibold">التصنيفات المسموحة</h3>
        <span className="text-bw-small text-bw-ink-soft"><Code>{brand.categoryIds.length}</Code> من <Code>{leafCount}</Code></span>
      </div>
      <p className="-mt-3 max-w-2xl text-bw-small text-bw-ink-soft">اختار التصنيف الدقيق. السماح بتصنيف مش بيسمح بأي تصنيف تاني، ولو التصنيف ناقص في الملف الصف بيتعلّق للمراجعة.</p>
      {groups.length ? groups.map(group => <div key={group.id} className="space-y-2.5">
        <p className="text-bw-small font-semibold text-bw-ink-soft">{group.name}</p>
        <div className="flex flex-wrap gap-2">
          {group.leaves.map(leaf => {
            const on = allowed.has(leaf.id)
            const saving = pending === `leaf:${leaf.id}`
            return <button key={leaf.id} type="button" aria-pressed={on} disabled={busy} onClick={() => toggleLeaf(leaf)}
              className={cn('inline-flex min-h-bw-control items-center gap-2 rounded-bw-pill border px-4 text-bw-small transition-colors duration-150 disabled:cursor-not-allowed',
                on ? 'border-bw-ink-subtle bg-bw-action-soft font-semibold text-bw-ink' : 'border-bw-line text-bw-ink-soft hover:border-bw-line-field hover:text-bw-ink',
                busy && !saving && 'opacity-60')}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : on ? <Check className="size-4" aria-hidden /> : <Plus className="size-4 text-bw-ink-subtle" aria-hidden />}
              {leaf.name}
            </button>
          })}
        </div>
      </div>) : <p className="text-bw-small text-bw-ink-soft">مفيش تصنيفات دقيقة نشطة في الكتالوج لسه.</p>}
    </section>

    <section aria-labelledby="exclusions-title" className="space-y-4 border-t border-bw-line pt-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 id="exclusions-title" className="text-bw-heading font-semibold">منتجات مستبعدة</h3>
          <p className="max-w-xl text-bw-small text-bw-ink-soft">منتج مستبعد مش بيدخل من أي ملف حتى لو البراند والتصنيف مسموحين. مكانه الحالي في الكتالوج مش بيتغير.</p>
        </div>
        <Button variant="secondary" disabled={busy || !brand.productCount} onClick={() => setExcluding(true)}>استبعاد منتج</Button>
      </div>
      {brand.exclusions.length ? <ul className="divide-y divide-bw-line rounded-bw-field border border-bw-line">
        {brand.exclusions.map(exclusion => <li key={exclusion.productId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <bdi className="block break-words font-semibold">{exclusion.name}</bdi>
            <p className="text-bw-small text-bw-ink-soft">{exclusion.reason} · <bdi>{formatDate(exclusion.at)}</bdi></p>
          </div>
          <Button variant="ghost" disabled={busy} loading={pending === `restore:${exclusion.productId}`} aria-label={`إرجاع ${exclusion.name}`}
            onClick={() => void commit(brand, { restoreProductId: exclusion.productId }, `restore:${exclusion.productId}`, `${exclusion.name} رجع مسموح`)}>
            <Undo2 className="size-4" aria-hidden />إرجاع
          </Button>
        </li>)}
      </ul> : <p className="text-bw-small text-bw-ink-subtle">{brand.productCount ? 'مفيش منتجات مستبعدة.' : 'لما يبقى للبراند منتجات في الكتالوج تقدر تستبعد منها.'}</p>}
    </section>

    {excluding && <ExcludeDrawer brand={brand} pending={pending} commit={commit} onClose={() => setExcluding(false)} />}
  </article>
}

const shortUrl = (url: string) => url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')
const FIELD_LABEL: Array<[string, string]> = [['name', 'الاسم'], ['website', 'الموقع'], ['description', 'النبذة'], ['country', 'بلد المنشأ'], ['parentCompany', 'الشركة الأم']]

/** What we know about the brand and where it came from. Shown only when there is something to show. */
function IdentityPanel({ brand }: { brand: PolicyBrand }) {
  const identity = useApi<BrandIdentity>(`/ingestion/eligibility/brands/${brand.id}/identity`)
  const fields = identity.data?.fields ?? null
  const status = (key: string) => { const f = fields?.[key]; return f && !Array.isArray(f) ? f : null }
  const rows = [brand.websiteUrl && { key: 'website', label: 'الموقع الرسمي', value: brand.websiteUrl, ltr: true },
    brand.countryOfOrigin && { key: 'country', label: 'بلد المنشأ', value: brand.countryOfOrigin },
    status('parentCompany') && { key: 'parentCompany', label: 'الشركة الأم', value: String((fields!.parentCompany as { value?: string }).value ?? '') },
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; ltr?: boolean }>
  if (!brand.description && !rows.length) return null
  const verified = FIELD_LABEL.filter(([key]) => status(key)?.status === 'VERIFIED').length
  return <section aria-label="معلومات البراند" className="space-y-3 rounded-bw-field border border-bw-line bg-bw-sunken/40 p-4">
    {brand.description && <p className="max-w-2xl text-bw-small leading-relaxed text-bw-ink-soft">{brand.description}</p>}
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-bw-small">
      {rows.map(row => <div key={row.key} className="flex items-center gap-2"><dt className="text-bw-ink-subtle">{row.label}</dt>
        <dd className="font-semibold">{row.ltr ? <a href={row.value} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline"><bdi dir="ltr">{shortUrl(row.value)}</bdi></a> : <bdi>{row.value}</bdi>}</dd>
        {status(row.key)?.status === 'VERIFIED' ? <StatusLabel tone="ok">موثّق</StatusLabel> : fields ? <StatusLabel tone="neutral">إدخال مسؤول</StatusLabel> : null}</div>)}
    </dl>
    {fields && <p className="text-bw-small text-bw-ink-subtle">{verified ? `${verified} معلومات موثّقة من الموقع الرسمي للبراند.` : 'المعلومات دي أدخلها مسؤول ومش موثّقة من مصدر.'}</p>}
  </section>
}

function ExcludeDrawer({ brand, pending, commit, onClose }: { brand: PolicyBrand; pending: string | null; commit: Commit; onClose: () => void }) {
  const dialog = useDialog()
  const [query, setQuery] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [choice, setChoice] = React.useState<BrandProduct | null>(null)
  const [reason, setReason] = React.useState('')
  const searchInput = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { dialog.ref.current?.showModal(); searchInput.current?.focus() }, [dialog.ref])
  React.useEffect(() => { const id = window.setTimeout(() => setDebounced(query.trim()), 250); return () => window.clearTimeout(id) }, [query])
  const products = useApi<BrandProduct[]>(`/ingestion/eligibility/brands/${brand.id}/products?q=${encodeURIComponent(debounced)}`)
  const excluded = new Set(brand.exclusions.map(e => e.productId))
  const saving = pending === `exclude:${choice?.id}`

  return <Dialog dialogRef={dialog.ref} variant="drawer" title={`استبعاد منتج من ${brand.name}`} onClose={onClose}
    footer={<><Button variant="secondary" onClick={dialog.close}>إلغاء</Button>
      <Button variant="danger" disabled={!choice} loading={saving} onClick={async () => {
        if (!choice) return
        const ok = await commit(brand, { excludeProductId: choice.id, reason: reason.trim() || undefined }, `exclude:${choice.id}`, `${choice.name} مستبعد`)
        if (ok) dialog.close()
      }}>استبعاد المنتج</Button></>}>
    <div className="space-y-5">
      <p className="text-bw-small text-bw-ink-soft">اختار المنتج من الكتالوج. الاستبعاد بيتطبق بعد ما الصف يتعرف إنه المنتج ده بالظبط، ومش بيحذف أو يخفي حاجة موجودة.</p>
      <label className="relative block">
        <span className="mb-1.5 block text-bw-small font-semibold">ابحث في منتجات البراند</span>
        <Search className="pointer-events-none absolute bottom-3.5 start-3 size-4 text-bw-ink-subtle" aria-hidden />
        <input ref={searchInput} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="الاسم أو كود الـ SKU أو الباركود"
          className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-sunken ps-9 pe-3 text-bw-body text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-action focus:outline-none" />
      </label>
      {products.error ? <LoadError message={products.error.message} onRetry={products.reload} />
        : !products.data ? <div className="space-y-2" aria-busy><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        : products.data.length ? <fieldset className="space-y-1.5">
          <legend className="sr-only">المنتج المطلوب استبعاده</legend>
          {products.data.map(product => {
            const already = excluded.has(product.id)
            return <label key={product.id} className={cn('flex cursor-pointer items-start gap-3 rounded-bw-field border px-3 py-2.5 transition-colors',
              choice?.id === product.id ? 'border-bw-ink-subtle bg-bw-sunken' : 'border-bw-line hover:bg-bw-sunken/60', already && 'cursor-not-allowed opacity-60')}>
              <input type="radio" name="exclude-product" className="mt-1 accent-bw-action" disabled={already} checked={choice?.id === product.id} onChange={() => setChoice(product)} />
              <span className="min-w-0 flex-1 space-y-0.5">
                <bdi className="block break-words font-semibold">{product.name}</bdi>
                <span className="flex flex-wrap items-center gap-2 text-bw-small text-bw-ink-soft">
                  {product.skus.map(sku => <Code key={sku.code}>{sku.code}</Code>)}
                  {already ? <StatusLabel tone="neutral">مستبعد بالفعل</StatusLabel> : product.isPublished ? <span>منشور</span> : <span>غير منشور</span>}
                </span>
              </span>
            </label>
          })}
        </fieldset>
        : <StateBlock kind="empty" title="مفيش منتج مطابق" body={debounced ? 'جرّب جزء تاني من الاسم أو كود الـ SKU.' : 'البراند ده مالوش منتجات في الكتالوج.'} />}
      {choice && <Field label="السبب (اختياري)" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} placeholder="مثلًا: تركيبة قديمة اتوقفت" />}
    </div>
  </Dialog>
}
