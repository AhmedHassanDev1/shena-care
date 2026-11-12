'use client'

import * as React from 'react'
import { ChevronDown, Layers, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { Button, Code, Dialog, Field, Skeleton, StateBlock, Switch, useDialog } from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BrandLine, BrandSummary, catalogErrorMessage } from './catalog-model'
import { Banner, Dot, RowMenu, SearchBox, TextBlock, absoluteUrl } from './ui'

/** Brand names, Arabic or English, ignoring case and Arabic letter forms. */
function fold(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ً-ٰٟـ]/g, '')
}

function safeWebsiteUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function BrandsTab({ brands, loading, error, onReload, onViewProducts }: {
  brands: BrandSummary[]
  loading: boolean
  error: string | null
  onReload: () => void
  onViewProducts: (brandId: string) => void
}) {
  const [query, setQuery] = React.useState('')
  const [notice, setNotice] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<BrandSummary | null>(null)
  const [linesOf, setLinesOf] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<BrandSummary | null>(null)
  const formDialog = useDialog()
  const linesDialog = useDialog()
  const deleteDialog = useDialog()

  const q = fold(query.trim())
  const visible = brands.filter((b) => !q || fold(`${b.name} ${b.slug} ${b.aliases.join(' ')}`).includes(q))
  const linesBrand = brands.find((b) => b.id === linesOf) ?? null

  const later = (fn: () => void) => window.setTimeout(fn, 0)
  const toggleActive = async (brand: BrandSummary) => {
    setFailure(null)
    try {
      await api(`/brands/${brand.id}`, { method: 'PATCH', body: { isActive: !brand.isActive } })
      setNotice(brand.isActive ? `تم إيقاف «${brand.name}»` : `تم تفعيل «${brand.name}»`)
      onReload()
    } catch (err) {
      setFailure(catalogErrorMessage(err as ApiError, 'تعذر تغيير حالة الماركة'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} label="بحث في الماركات" placeholder="اسم الماركة بالعربية أو الإنجليزية" />
        <Button className="ms-auto" onClick={() => { setEditing(null); later(() => formDialog.open()) }}><Plus className="size-4" aria-hidden />إضافة ماركة</Button>
      </div>

      {notice ? <Banner tone="ok" onClose={() => setNotice(null)}>{notice}</Banner> : null}
      {failure ? <Banner tone="danger" onClose={() => setFailure(null)}>{failure}</Banner> : null}
      {error ? <LoadError message={error} onRetry={onReload} /> : null}
      {loading && brands.length === 0 ? <Skeleton className="h-56 w-full" /> : null}
      {!loading && brands.length > 0 && visible.length === 0 ? <StateBlock kind="empty" title="لا توجد ماركة بهذا الاسم" body="جرّب اسمًا آخر أو مرادفًا عربيًا." /> : null}
      {!loading && !error && brands.length === 0 ? <StateBlock kind="empty" title="لا توجد ماركات بعد" body="أضف أول ماركة لتنظيم منتجاتك." /> : null}

      {visible.length > 0 ? (
        <ul className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-surface">
          {visible.map((brand) => (
            <li key={brand.id} className="flex items-center gap-3 px-3 py-2.5 md:px-4">
              <Logo brand={brand} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-bw-ink"><bdi>{brand.name}</bdi></p>
                {brand.aliases.length ? <p className="truncate text-[12px] text-bw-ink-soft">{brand.aliases.slice(0, 3).join('، ')}</p> : null}
                {safeWebsiteUrl(brand.websiteUrl) ? (
                  <a
                    href={safeWebsiteUrl(brand.websiteUrl) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-[11px] text-bw-cobalt hover:underline block"
                  >
                    {brand.websiteUrl}
                  </a>
                ) : null}
              </div>
              {!brand.isActive ? <span className="hidden sm:block"><Dot tone="muted">موقوفة</Dot></span> : null}
              {brand.productLines.length ? <span className="hidden text-[12px] text-bw-ink-subtle md:block"><Code>{brand.productLines.length}</Code> خط</span> : null}
              <button
                type="button"
                disabled={brand.productCount === 0}
                onClick={() => onViewProducts(brand.id)}
                className="min-h-9 rounded-bw-field px-2.5 text-bw-small text-bw-cobalt transition-colors hover:bg-bw-sunken disabled:text-bw-ink-subtle disabled:hover:bg-transparent"
              >
                <Code>{brand.productCount}</Code> منتج
              </button>
              <RowMenu label={`إجراءات ${brand.name}`} actions={[
                { label: 'تعديل', icon: Pencil, onSelect: () => { setEditing(brand); later(() => formDialog.open()) } },
                { label: 'خطوط الإنتاج', icon: Layers, onSelect: () => { setLinesOf(brand.id); later(() => linesDialog.open()) } },
                { label: brand.isActive ? 'إيقاف' : 'تفعيل', icon: Power, onSelect: () => void toggleActive(brand) },
                { label: 'حذف', icon: Trash2, tone: 'danger', onSelect: () => { setDeleting(brand); later(() => deleteDialog.open()) } },
              ]} />
            </li>
          ))}
        </ul>
      ) : null}

      <BrandModal key={editing?.id ?? 'new'} dialogRef={formDialog.ref} brand={editing} onClose={() => formDialog.close()} onSaved={(m) => { formDialog.close(); setNotice(m); onReload() }} />
      <LinesDialog dialogRef={linesDialog.ref} brand={linesBrand} onChanged={onReload} onClose={() => linesDialog.close()} />
      <DeleteDialog dialogRef={deleteDialog.ref} brand={deleting} onClose={() => deleteDialog.close()} onDeactivate={(b) => { deleteDialog.close(); void toggleActive(b) }} onDeleted={(m) => { deleteDialog.close(); setNotice(m); onReload() }} />
    </div>
  )
}

function Logo({ brand }: { brand: BrandSummary }) {
  const src = absoluteUrl(brand.logoUrl)
  const [failed, setFailed] = React.useState(false)
  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-bw-field bg-bw-sunken text-bw-small font-bold text-bw-ink-soft">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} className="size-full object-contain" />
      ) : (
        <span aria-hidden>{brand.name.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  )
}

/* ── One modal for add and edit ────────────────────────────────────────────────────────────── */

function BrandModal({ dialogRef, brand, onClose, onSaved }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  brand: BrandSummary | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = React.useState(brand?.name ?? '')
  const [aliases, setAliases] = React.useState(brand?.aliases.join('، ') ?? '')
  const [country, setCountry] = React.useState(brand?.countryOfOrigin ?? '')
  const [website, setWebsite] = React.useState(brand?.websiteUrl ?? '')
  const [logo, setLogo] = React.useState(brand?.logoUrl ?? '')
  const [slug, setSlug] = React.useState(brand?.slug ?? '')
  const [description, setDescription] = React.useState(brand?.description ?? '')
  const [active, setActive] = React.useState(brand?.isActive ?? true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (name.trim().length < 2) { setError('اسم الماركة حرفان على الأقل'); return }
    if (website.trim() && !safeWebsiteUrl(website.trim())) {
      setError('رابط الموقع يجب أن يبدأ بـ http:// أو https://')
      return
    }
    const body: Record<string, unknown> = {
      name: name.trim(),
      aliases: aliases.split(/[,،\n]+/).map((s) => s.trim()).filter(Boolean),
      ...(slug.trim() ? { slug: slug.trim().toLowerCase() } : {}),
      description: description.trim(),
      ...(logo.trim() ? { logoUrl: logo.trim() } : {}),
      ...(website.trim() ? { websiteUrl: safeWebsiteUrl(website.trim()) ?? undefined } : {}),
      ...(country.trim() ? { countryOfOrigin: country.trim() } : {}),
      isActive: active,
    }
    setBusy(true)
    setError(null)
    try {
      if (brand) await api(`/brands/${brand.id}`, { method: 'PATCH', body })
      else await api('/brands', { method: 'POST', body })
      onSaved(brand ? `تم حفظ «${name.trim()}»` : `تمت إضافة «${name.trim()}»`)
    } catch (err) {
      setError(catalogErrorMessage(err as ApiError, 'تعذر حفظ الماركة'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      dialogRef={dialogRef}
      title={brand ? 'تعديل الماركة' : 'إضافة ماركة'}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" form="brand-form" loading={busy}>{brand ? 'حفظ' : 'إضافة'}</Button></>}
    >
      <form id="brand-form" dir="rtl" onSubmit={save} className="space-y-4">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="اسم الماركة" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <Field label="أسماء بديلة وعربية" value={aliases} onChange={(e) => setAliases(e.target.value)} hint="افصل بفاصلة. تساعد في التعرف على الماركة في ملفات الموردين." />
        <details className="group rounded-bw-field border border-bw-line">
          <summary className="flex min-h-bw-control cursor-pointer list-none items-center justify-between px-3 text-bw-small font-semibold text-bw-ink-soft">
            خيارات إضافية <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-3 border-t border-bw-line p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="بلد المنشأ" value={country} onChange={(e) => setCountry(e.target.value)} />
              <Field label="الموقع الرسمي" ltr value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
            </div>
            <Field label="رابط الشعار" ltr value={logo} onChange={(e) => setLogo(e.target.value)} />
            <Field label="المعرّف (slug)" ltr value={slug} onChange={(e) => setSlug(e.target.value)} hint="فارغ = يُولَّد تلقائيًا" />
            <TextBlock label="نبذة" value={description} onChange={setDescription} rows={2} />
            <Switch label="الماركة نشطة" checked={active} onChange={(e) => setActive(e.target.checked)} />
          </div>
        </details>
      </form>
    </Dialog>
  )
}

/* ── Product lines: reachable from the menu, not a screen of their own ─────────────────────── */

function LinesDialog({ dialogRef, brand, onChanged, onClose }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  brand: BrandSummary | null
  onChanged: () => void
  onClose: () => void
}) {
  const [name, setName] = React.useState('')
  const [editing, setEditing] = React.useState<BrandLine | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { setName(''); setEditing(null); setError(null) }, [brand?.id])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setName('')
      setEditing(null)
      onChanged()
    } catch (err) {
      setError(catalogErrorMessage(err as ApiError, 'تعذر تنفيذ العملية'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog dialogRef={dialogRef} title={brand ? `خطوط إنتاج ${brand.name}` : 'خطوط الإنتاج'} onClose={onClose}>
      {brand ? (
        <div dir="rtl" className="space-y-4">
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim().length < 2) { setError('اسم الخط حرفان على الأقل'); return }
              void run(() => editing
                ? api(`/brands/product-lines/${editing.id}`, { method: 'PATCH', body: { name: name.trim() } })
                : api(`/brands/${brand.id}/product-lines`, { method: 'POST', body: { name: name.trim() } }))
            }}
          >
            <Field className="flex-1" label={editing ? 'تعديل اسم الخط' : 'خط جديد'} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" loading={busy}>{editing ? 'حفظ' : 'إضافة'}</Button>
            {editing ? <Button variant="ghost" onClick={() => { setEditing(null); setName('') }}>إلغاء</Button> : null}
          </form>
          {brand.productLines.length === 0 ? <p className="text-bw-small text-bw-ink-soft">لا توجد خطوط إنتاج بعد.</p> : (
            <ul className="divide-y divide-bw-line rounded-bw-field border border-bw-line">
              {brand.productLines.map((line) => (
                <li key={line.id} className="flex items-center gap-2 px-3 py-2">
                  <span className={cn('min-w-0 flex-1 truncate text-bw-small', line.isActive ? 'text-bw-ink' : 'text-bw-ink-subtle')}><bdi>{line.name}</bdi></span>
                  <RowMenu label={`إجراءات ${line.name}`} actions={[
                    { label: 'تعديل الاسم', icon: Pencil, onSelect: () => { setEditing(line); setName(line.name) } },
                    { label: line.isActive ? 'إيقاف' : 'تفعيل', icon: Power, onSelect: () => void run(() => api(`/brands/product-lines/${line.id}`, { method: 'PATCH', body: { isActive: !line.isActive } })) },
                    { label: 'حذف', icon: Trash2, tone: 'danger', onSelect: () => void run(() => api(`/brands/product-lines/${line.id}`, { method: 'DELETE' })) },
                  ]} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Dialog>
  )
}

/* ── Delete: says up front when it is not possible, and offers the safe alternative ────────── */

function DeleteDialog({ dialogRef, brand, onClose, onDeactivate, onDeleted }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  brand: BrandSummary | null
  onClose: () => void
  onDeactivate: (brand: BrandSummary) => void
  onDeleted: (message: string) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => setError(null), [brand?.id])
  const blocked = brand ? brand.productCount > 0 || brand.productLines.length > 0 : false
  return (
    <Dialog
      dialogRef={dialogRef}
      title="حذف الماركة"
      onClose={onClose}
      footer={brand ? (
        <>
          <Button variant="ghost" onClick={onClose}>تراجع</Button>
          {blocked ? (
            brand.isActive ? <Button onClick={() => onDeactivate(brand)}>إيقاف الماركة بدلًا من حذفها</Button> : null
          ) : (
            <Button variant="danger" loading={busy} onClick={async () => {
              setBusy(true)
              setError(null)
              try { await api(`/brands/${brand.id}`, { method: 'DELETE' }); onDeleted(`تم حذف «${brand.name}»`) }
              catch (err) { setError(catalogErrorMessage(err as ApiError, 'تعذر حذف الماركة')) }
              finally { setBusy(false) }
            }}>حذف نهائي</Button>
          )}
        </>
      ) : undefined}
    >
      {brand ? (
        <div dir="rtl" className="space-y-3 text-bw-small">
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {blocked ? (
            <p className="text-bw-ink-soft">لا يمكن حذف «{brand.name}» لأنها مرتبطة بـ <Code>{brand.productCount}</Code> منتج و<Code>{brand.productLines.length}</Code> خط إنتاج. الإيقاف يخفيها دون المساس بمنتجاتها.</p>
          ) : (
            <p className="text-bw-ink-soft">سيُحذف «{brand.name}» نهائيًا. لا توجد منتجات أو خطوط مرتبطة بها. لا يمكن التراجع، وإن كانت لها قاعدة في قائمة السماح سيرفض النظام الحذف.</p>
          )}
        </div>
      ) : null}
    </Dialog>
  )
}
