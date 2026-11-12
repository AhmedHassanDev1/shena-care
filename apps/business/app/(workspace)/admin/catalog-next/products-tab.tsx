'use client'

import * as React from 'react'
import Link from 'next/link'
import { Archive, ChevronLeft, ChevronRight, FileSpreadsheet, ImageIcon, Pencil, RotateCcw, SlidersHorizontal, SquarePen, TriangleAlert } from 'lucide-react'
import { Button, Code, Dialog, Field, Money, Select, Skeleton, StateBlock, useDialog } from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { ProductWorkbenchDrawer } from '../catalog/product-drawer'
import {
  BrandSummary,
  CatalogItem,
  CatalogItemsResponse,
  CategoryNode,
  ProductFilters,
  READINESS_FILTER_LABELS,
  STATUS_FILTER_LABELS,
  catalogErrorMessage,
  flattenCategories,
  hasActiveProductFilters,
  productPrice,
  productSizeText,
  productsApiQuery,
  readinessIssueLabel,
  rowStatus,
  skuSizeText,
  summaryLine,
} from './catalog-model'
import { Banner, RowMenu, SearchBox, TextBlock, Thumb } from './ui'

const STATUS_OPTIONS = Object.entries(STATUS_FILTER_LABELS).map(([value, label]) => ({ value, label }))

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return debounced
}

export function ProductsTab({ brands, categories, filters, setFilters, selectedId, setSelectedId }: {
  brands: BrandSummary[]
  categories: CategoryNode[]
  filters: ProductFilters
  setFilters: (patch: Partial<ProductFilters>) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
}) {
  const [search, setSearch] = React.useState(filters.q)
  const debounced = useDebounced(search, 300)
  React.useEffect(() => { if (debounced !== filters.q) setFilters({ q: debounced, page: 1 }) }, [debounced])
  React.useEffect(() => setSearch(filters.q), [filters.q])

  const advancedCount = [filters.brand, filters.cat, filters.ready].filter(Boolean).length
  const [filtersOpen, setFiltersOpen] = React.useState(advancedCount > 0)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [editorProduct, setEditorProduct] = React.useState<CatalogItem | null>(null)
  const editor = useDialog()

  const list = useApi<CatalogItemsResponse>(`/catalog/items?${productsApiQuery(filters)}`)
  const flatCategories = React.useMemo(() => flattenCategories(categories), [categories])
  const items = list.data?.items ?? []
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.limit)) : 1
  const filtered = hasActiveProductFilters(filters)

  // A deep link (?p=id) may point outside the current page, so the single-product endpoint backs it up.
  const inList = items.find((p) => p.id === selectedId) ?? null
  const single = useApi<CatalogItem>(selectedId && !inList && list.data ? `/catalog/items/${selectedId}` : null)
  const selected = inList ?? (selectedId ? single.data ?? null : null)

  const restore = async (product: CatalogItem) => {
    setBusyId(product.id)
    setError(null)
    try {
      await api(`/catalog/items/${product.id}/restore`, { method: 'POST' })
      setNotice(`تمت استعادة «${product.name}» كمسودة`)
      list.reload()
    } catch (err) {
      setError(catalogErrorMessage(err as ApiError, 'تعذر استعادة المنتج'))
    } finally {
      setBusyId(null)
    }
  }

  const openEditor = (product: CatalogItem) => {
    setEditorProduct(product)
    setSelectedId(null)
    window.setTimeout(() => editor.open(), 0)
  }

  return (
    <div className="space-y-4">
      {/* One summary line instead of five cards. */}
      {list.data ? <p className="text-bw-small text-bw-ink-soft">{summaryLine(list.data.summary)}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} label="بحث في المنتجات" placeholder="اسم المنتج أو الكود أو الباركود" />
        <label className="sr-only" htmlFor="status-filter">حالة المنتج</label>
        <select
          id="status-filter"
          value={filters.status}
          onChange={(e) => setFilters({ status: e.target.value as ProductFilters['status'], page: 1 })}
          className="h-bw-control rounded-bw-field border border-bw-line-field bg-bw-surface px-3 text-bw-small text-bw-ink focus:border-bw-cobalt focus:outline-none"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Button variant="secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
          <SlidersHorizontal className="size-4" aria-hidden />
          فلاتر
          {advancedCount > 0 ? <span className="grid size-5 place-items-center rounded-full bg-bw-cobalt text-[11px] font-bold text-bw-page">{advancedCount}</span> : null}
        </Button>
        <div className="ms-auto flex items-center gap-1">
          <Link href="/admin/catalog/intake" className="inline-flex h-bw-control items-center gap-2 rounded-bw-field px-3 text-bw-small font-semibold text-bw-cobalt transition-colors hover:bg-bw-sunken">
            <FileSpreadsheet className="size-4" aria-hidden />
            إدخال منتجات
          </Link>
          <RowMenu label="المزيد" actions={[{ label: 'قوالب الصور', icon: ImageIcon, onSelect: () => { window.location.href = '/admin/catalog/media-templates' } }]} />
        </div>
      </div>

      {filtersOpen ? (
        <div className="grid gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-3 sm:grid-cols-3">
          <Select label="الماركة" value={filters.brand} onChange={(e) => setFilters({ brand: e.target.value, page: 1 })} options={[{ value: '', label: 'كل الماركات' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} />
          <Select label="التصنيف" value={filters.cat} onChange={(e) => setFilters({ cat: e.target.value, page: 1 })} options={[{ value: '', label: 'كل التصنيفات' }, ...flatCategories.map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} ← ${c.name}` : c.name }))]} />
          <Select label="ما يحتاج انتباه" value={filters.ready} onChange={(e) => setFilters({ ready: e.target.value as ProductFilters['ready'], page: 1 })} options={[{ value: '', label: 'الكل' }, ...Object.entries(READINESS_FILTER_LABELS).map(([value, label]) => ({ value, label }))]} />
          {advancedCount > 0 ? <button type="button" className="text-start text-bw-small text-bw-ink-soft underline sm:col-span-3" onClick={() => setFilters({ brand: '', cat: '', ready: '', page: 1 })}>مسح الفلاتر</button> : null}
        </div>
      ) : null}

      {notice ? <Banner tone="ok" onClose={() => setNotice(null)}>{notice}</Banner> : null}
      {error ? <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner> : null}
      {list.error ? <LoadError message={list.error.message} onRetry={list.reload} /> : null}
      {!list.data && list.loading ? <Skeleton className="h-64 w-full" /> : null}

      {list.data && items.length === 0 ? (
        <StateBlock
          kind="empty"
          title="لا توجد منتجات مطابقة"
          body={filtered ? 'جرّب كلمة أخرى أو امسح الفلاتر.' : 'لم تُضف منتجات بعد. ابدأ بإدخال قائمة منتجات.'}
          action={filtered ? <Button variant="secondary" onClick={() => { setSearch(''); setFilters({ q: '', brand: '', cat: '', ready: '', status: 'all', page: 1 }) }}>مسح الفلاتر</Button> : undefined}
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-surface">
          <li aria-hidden className="hidden grid-cols-[minmax(0,1fr)_7rem_13rem_6.5rem] gap-3 px-4 py-2 text-[11px] text-bw-ink-subtle md:grid">
            <span>المنتج</span><span>السعر</span><span>الحالة</span><span />
          </li>
          {items.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              busy={busyId === product.id}
              onOpen={() => setSelectedId(product.id)}
              onRestore={() => void restore(product)}
              onFullEditor={() => openEditor(product)}
            />
          ))}
        </ul>
      ) : null}

      {list.data && list.data.total > list.data.limit ? (
        <nav aria-label="صفحات المنتجات" className="flex items-center justify-between gap-3 text-bw-small text-bw-ink-soft">
          <Button variant="ghost" disabled={filters.page <= 1} onClick={() => setFilters({ page: filters.page - 1 })}><ChevronRight className="size-4" aria-hidden />السابق</Button>
          <span>صفحة <Code>{filters.page}</Code> من <Code>{totalPages}</Code></span>
          <Button variant="ghost" disabled={filters.page >= totalPages} onClick={() => setFilters({ page: filters.page + 1 })}>التالي<ChevronLeft className="size-4" aria-hidden /></Button>
        </nav>
      ) : null}

      <ProductPanel
        product={selected}
        brands={brands}
        categories={categories}
        onClose={() => setSelectedId(null)}
        onFullEditor={openEditor}
        onChanged={(message) => { setNotice(message); list.reload() }}
      />

      {/* The existing full editor (data, variants, publication, images) stays the home of complex edits. */}
      <ProductWorkbenchDrawer
        dialogRef={editor.ref}
        product={editorProduct}
        brands={brands}
        categories={categories}
        onClose={() => { editor.close(); setEditorProduct(null) }}
        onChanged={(message) => { setNotice(message); list.reload() }}
      />
    </div>
  )
}

function ProductRow({ product, busy, onOpen, onRestore, onFullEditor }: {
  product: CatalogItem
  busy: boolean
  onOpen: () => void
  onRestore: () => void
  onFullEditor: () => void
}) {
  const status = rowStatus(product)
  const price = productPrice(product)
  const size = productSizeText(product)
  return (
    <li
      onClick={onOpen}
      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 transition-colors hover:bg-bw-sunken md:grid-cols-[minmax(0,1fr)_7rem_13rem_6.5rem] md:px-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Thumb media={product.media[0]} alt={product.name} />
        <div className="min-w-0">
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen() }} className="block max-w-full truncate rounded-bw-field text-start font-semibold text-bw-ink focus-visible:outline-2 focus-visible:outline-bw-focus">
            <bdi>{product.name}</bdi>
          </button>
          <p className="truncate text-[12px] text-bw-ink-soft"><bdi>{product.brand.name}</bdi>{size ? <> · <Code>{size}</Code></> : null}</p>
        </div>
      </div>

      <div className="hidden text-bw-small text-bw-ink md:block">
        {price ? <Money value={price.amount} /> : <span className="text-bw-ink-subtle">—</span>}
      </div>

      <div className="col-span-2 flex items-center gap-2 pe-1 md:col-span-1">
        <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-bw-small', status.tone === 'warn' ? 'text-bw-amber' : status.tone === 'cobalt' ? 'text-bw-cobalt' : 'text-bw-ink-soft')}>
          {status.tone === 'warn' ? <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> : null}
          <span className="truncate">{status.label}</span>
          {status.issues.length > 1 ? <span className="shrink-0 text-[11px] text-bw-ink-subtle">+<Code>{status.issues.length - 1}</Code></span> : null}
        </span>
        <span className="ms-auto text-bw-small text-bw-ink-soft md:hidden">{price ? <Money value={price.amount} /> : null}</span>
      </div>

      <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 md:col-start-auto md:row-start-auto" onClick={(e) => e.stopPropagation()}>
        {product.archivedAt ? (
          <Button variant="secondary" loading={busy} onClick={onRestore}><RotateCcw className="size-3.5" aria-hidden />استعادة</Button>
        ) : status.issues.length ? (
          <button type="button" onClick={onOpen} className="hidden h-9 rounded-bw-field px-2.5 text-bw-small font-semibold text-bw-cobalt transition-colors hover:bg-bw-sunken md:block">إصلاح</button>
        ) : null}
        <RowMenu label={`إجراءات ${product.name}`} actions={[
          { label: 'التفاصيل والتعديل السريع', icon: Pencil, onSelect: onOpen },
          { label: 'المحرر الكامل', icon: SquarePen, onSelect: onFullEditor },
        ]} />
      </div>
    </li>
  )
}

/* ── Details panel: quick edit + everything hidden from the list ───────────────────────────── */

function ProductPanel({ product, brands, categories, onClose, onFullEditor, onChanged }: {
  product: CatalogItem | null
  brands: BrandSummary[]
  categories: CategoryNode[]
  onClose: () => void
  onFullEditor: (product: CatalogItem) => void
  onChanged: (message: string) => void
}) {
  const dialog = useDialog()
  const archiveDialog = useDialog()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [brandId, setBrandId] = React.useState('')
  const [categoryId, setCategoryId] = React.useState('')
  const [lineId, setLineId] = React.useState('')
  const [busy, setBusy] = React.useState<'save' | 'archive' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const flat = React.useMemo(() => flattenCategories(categories), [categories])
  const lines = brands.find((b) => b.id === brandId)?.productLines ?? []

  React.useEffect(() => {
    const el = dialog.ref.current
    if (!el) return
    if (product && !el.open) el.showModal()
    if (!product && el.open) el.close()
  }, [product, dialog.ref])

  React.useEffect(() => {
    if (!product) return
    setName(product.name)
    setDescription(product.description ?? '')
    setBrandId(product.brandId)
    setCategoryId(product.categoryId ?? '')
    setLineId(product.productLineId ?? '')
    setError(null)
  }, [product])

  const dirty = product ? name.trim() !== product.name || (description.trim() !== (product.description ?? '')) || brandId !== product.brandId || categoryId !== (product.categoryId ?? '') || lineId !== (product.productLineId ?? '') : false
  const status = product ? rowStatus(product) : null

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!product) return
    if (name.trim().length < 2) { setError('اسم المنتج حرفان على الأقل'); return }
    setBusy('save')
    setError(null)
    try {
      await api(`/products/${product.id}`, { method: 'PATCH', body: { name: name.trim(), description: description.trim(), brandId, ...(categoryId ? { categoryId } : {}), ...(lineId ? { productLineId: lineId } : {}) } })
      onChanged(`تم حفظ «${name.trim()}»`)
      onClose()
    } catch (err) {
      setError(catalogErrorMessage(err as ApiError, 'تعذر حفظ المنتج'))
    } finally {
      setBusy(null)
    }
  }

  const archive = async () => {
    if (!product) return
    setBusy('archive')
    try {
      await api(`/catalog/items/${product.id}/archive`, { method: 'POST' })
      archiveDialog.close()
      onChanged(`تمت أرشفة «${product.name}»`)
      onClose()
    } catch (err) {
      setError(catalogErrorMessage(err as ApiError, 'تعذرت الأرشفة'))
      archiveDialog.close()
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Dialog
        dialogRef={dialog.ref}
        variant="drawer"
        title={product?.name ?? 'المنتج'}
        onClose={onClose}
        footer={product && !product.archivedAt ? (
          <>
            <RowMenu label="المزيد" actions={[{ label: 'أرشفة المنتج', icon: Archive, tone: 'danger', onSelect: () => archiveDialog.open() }]} />
            <Button variant="ghost" onClick={() => onFullEditor(product)}><SquarePen className="size-4" aria-hidden />المحرر الكامل</Button>
            <Button type="submit" form="quick-edit" loading={busy === 'save'} disabled={!dirty}>حفظ</Button>
          </>
        ) : product ? (
          <Button variant="ghost" onClick={() => onFullEditor(product)}>المحرر الكامل</Button>
        ) : undefined}
      >
        {product ? (
          <div dir="rtl" className="space-y-5">
            <div className="flex items-center gap-3">
              <Thumb media={product.media[0]} alt={product.name} size="lg" />
              <div className="min-w-0 space-y-1 text-bw-small">
                <p className="text-bw-ink-soft"><bdi>{product.brand.name}</bdi>{product.category ? <> · {product.category.name}</> : null}</p>
                <p className={cn('font-semibold', status?.tone === 'warn' ? 'text-bw-amber' : status?.tone === 'cobalt' ? 'text-bw-cobalt' : 'text-bw-ink')}>{product.archivedAt ? 'مؤرشف' : product.isPublished ? 'منشور بالمتجر' : 'مسودة'}</p>
                {product.media[0]?.hiddenReason && product.media[0].hiddenReason !== 'PRODUCT_NOT_PUBLISHED' ? <p className="text-bw-amber">{readinessIssueLabel('PRIMARY_PACKSHOT_NOT_APPROVED')}</p> : null}
              </div>
            </div>

            {status && status.issues.length ? (
              <section aria-label="ما يحتاج إصلاح" className="rounded-bw-field border border-bw-amber/30 bg-bw-amber-soft/50 p-3">
                <p className="mb-1.5 text-bw-small font-semibold text-bw-ink">يمنع النشر أو الظهور</p>
                <ul className="space-y-1 text-bw-small text-bw-ink">
                  {status.issues.map((code) => <li key={code} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-bw-amber" aria-hidden />{readinessIssueLabel(code)}</li>)}
                </ul>
                <button type="button" onClick={() => onFullEditor(product)} className="mt-2 text-bw-small font-semibold text-bw-cobalt underline underline-offset-4">أصلحها في المحرر الكامل</button>
              </section>
            ) : null}

            {error ? <Banner tone="danger">{error}</Banner> : null}

            <form id="quick-edit" onSubmit={save} className="space-y-3">
              <Field label="اسم المنتج" value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(product.archivedAt)} />
              <Select label="التصنيف" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={Boolean(product.archivedAt)} options={[{ value: '', label: 'بلا تصنيف' }, ...flat.map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} ← ${c.name}` : c.name }))]} />
              <Select label="الماركة" value={brandId} onChange={(e) => { setBrandId(e.target.value); setLineId('') }} disabled={Boolean(product.archivedAt)} options={brands.map((b) => ({ value: b.id, label: b.name }))} />
              {lines.length ? <Select label="خط الإنتاج" value={lineId} onChange={(e) => setLineId(e.target.value)} disabled={Boolean(product.archivedAt)} options={[{ value: '', label: 'بدون' }, ...lines.map((l) => ({ value: l.id, label: l.name }))]} /> : null}
              <TextBlock label="الوصف" value={description} onChange={setDescription} rows={3} />
            </form>

            <details className="group rounded-bw-field border border-bw-line">
              <summary className="flex min-h-bw-control cursor-pointer list-none items-center justify-between px-3 text-bw-small font-semibold text-bw-ink-soft">
                النسخ والأكواد <Code>{product.skus.length}</Code>
              </summary>
              <ul className="divide-y divide-bw-line border-t border-bw-line">
                {product.skus.map((sku) => (
                  <li key={sku.id} className="space-y-0.5 px-3 py-2 text-bw-small">
                    <p className="flex flex-wrap items-center gap-x-3 text-bw-ink"><Code className="font-semibold">{sku.code}</Code><span>{skuSizeText(sku)}</span>{sku.currentPrice ? <Money value={sku.currentPrice.amount} /> : <span className="text-bw-amber">بلا سعر</span>}</p>
                    <p className="text-[11px] text-bw-ink-subtle">{sku.barcode ? <>باركود <Code>{sku.barcode}</Code></> : 'بلا باركود'} · {sku.isActive ? 'مفعّلة' : 'موقوفة'} · {sku.isListed ? 'ظاهرة بالمتجر' : 'غير ظاهرة'}</p>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        dialogRef={archiveDialog.ref}
        title="أرشفة المنتج"
        footer={<><Button variant="ghost" onClick={() => archiveDialog.close()}>تراجع</Button><Button variant="danger" loading={busy === 'archive'} onClick={() => void archive()}>أرشفة</Button></>}
      >
        <p dir="rtl" className="text-bw-small text-bw-ink-soft">سيتوقف نشر «{product?.name}» وتُعطَّل نسخه. يمكنك استعادته لاحقًا كمسودة.</p>
      </Dialog>
    </>
  )
}
