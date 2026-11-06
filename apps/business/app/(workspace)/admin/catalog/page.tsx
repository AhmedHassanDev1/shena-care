'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowUpLeft, FileUp, PackageSearch, RefreshCw, Search } from 'lucide-react'
import { Button, Code, Dialog, PageHeader, Skeleton, StateBlock, StatusLabel, useDialog } from '@/components/bw/primitives'
import { RoleShell, LoadError } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import { CatalogItems, ProductImage } from './catalog-items'

type CatalogProduct = {
  id: string
  name: string
  description: string | null
  brand: { name: string }
  category?: { name: string } | null
  skus: Array<{ id: string; variantName: string; size: number | null; sizeUnit: string | null; code: string }>
  media: Array<{ url: string; altText: string | null; isPrimary: boolean }>
}

type Candidate = {
  id: string
  name: string
  brand: string
  category?: string
  status: string
  supplierSkuCode: string
}

const candidateStates: Record<string, string> = {
  review_required: 'بحاجة لمراجعة', pending: 'قيد التحرير', approved: 'جاهز للنشر',
  published: 'منشور', rejected: 'مرفوض',
}

export default function AdminCatalog() {
  const [query, setQuery] = React.useState('')
  const [view, setView] = React.useState<'published' | 'review' | 'items'>('published')
  const [selected, setSelected] = React.useState<CatalogProduct | null>(null)
  const drawer = useDialog()
  const inspect = (product: CatalogProduct) => { setSelected(product); drawer.open() }
  const productsApi = useApi<CatalogProduct[]>('/products?limit=100', { pollMs: 60000 })
  const candidatesApi = useApi<Candidate[]>('/ingestion/candidates?status=review_required', { pollMs: 30000 })
  const normalized = query.trim().toLocaleLowerCase()
  const products = (productsApi.data ?? []).filter((product) =>
    [product.name, product.brand.name, product.category?.name, ...product.skus.map((sku) => sku.code)]
      .some((value) => value?.toLocaleLowerCase().includes(normalized)))
  const candidates = (candidatesApi.data ?? []).filter((candidate) =>
    [candidate.name, candidate.brand, candidate.supplierSkuCode]
      .some((value) => value?.toLocaleLowerCase().includes(normalized)))

  return <RoleShell role="admin" active="catalog" counts={{ catalog: candidatesApi.data?.length }}>
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:px-8 sm:py-9" dir="rtl">
      <PageHeader eyebrow="مساحة الإدارة / الكتالوج" title="الكتالوج"
        meta="المنتجات المنشورة والمراجعات التي تنتظر قرارك."
        actions={<Link href="/admin/catalog/imports" className="inline-flex h-bw-control items-center justify-center gap-2 rounded-bw-field bg-bw-action px-4 text-bw-small font-semibold text-bw-on-action transition-colors hover:bg-bw-action-hover"><FileUp className="size-4" />رفع ملف منتجات</Link>} />

      <div className="grid gap-4 border-y border-bw-line py-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <label className="relative block max-w-xl">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-bw-ink-subtle" aria-hidden />
          <span className="sr-only">ابحث في الكتالوج</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="اسم المنتج، البراند أو الكود"
            className="h-bw-control w-full rounded-bw-field border border-bw-line bg-bw-surface pe-4 ps-10 text-bw-small text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-focus focus:outline-none" />
        </label>
        <div className="flex flex-wrap items-center gap-1 rounded-bw-field bg-bw-sunken p-1" role="group" aria-label="عرض الكتالوج">
          <button type="button" aria-pressed={view === 'published'} onClick={() => setView('published')}
            className={`rounded-bw-field px-3 py-2 text-bw-small transition-colors ${view === 'published' ? 'bg-bw-surface font-semibold text-bw-ink shadow-bw-card' : 'text-bw-ink-soft hover:text-bw-ink'}`}>المعروض</button>
          <button type="button" aria-pressed={view === 'review'} onClick={() => setView('review')}
            className={`rounded-bw-field px-3 py-2 text-bw-small transition-colors ${view === 'review' ? 'bg-bw-surface font-semibold text-bw-ink shadow-bw-card' : 'text-bw-ink-soft hover:text-bw-ink'}`}>بانتظار المراجعة <Code>{candidatesApi.data?.length ?? '—'}</Code></button>
          <button type="button" aria-pressed={view === 'items'} onClick={() => setView('items')}
            className={`rounded-bw-field px-3 py-2 text-bw-small transition-colors ${view === 'items' ? 'bg-bw-surface font-semibold text-bw-ink shadow-bw-card' : 'text-bw-ink-soft hover:text-bw-ink'}`}>إدارة العناصر</button>
        </div>
      </div>

      {view === 'published' ? <section aria-label="المنتجات المنشورة" className="space-y-4">
        <div className="flex items-center justify-between gap-3"><h2 className="text-bw-heading font-semibold">المنتجات المنشورة</h2><Button variant="ghost" onClick={productsApi.reload} aria-label="تحديث المنتجات"><RefreshCw className="size-4" /></Button></div>
        {productsApi.error ? <LoadError message={productsApi.error.message} onRetry={productsApi.reload} /> : null}
        {productsApi.loading && !productsApi.data ? <Skeleton className="h-64 w-full rounded-bw-card" /> : null}
        {productsApi.data && products.length === 0 ? <StateBlock kind="empty" title="لا توجد منتجات مطابقة" body="غيّر البحث أو راجع المنتجات التي تنتظر الاعتماد." /> : null}
        {products.length ? <div className="overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface divide-y divide-bw-line">
          {products.map((product) => {
            const image = product.media.find((media) => media.isPrimary) ?? product.media[0]
            return <button key={product.id} type="button" onClick={() => inspect(product)}
              className="group flex w-full items-center gap-4 p-3 text-start transition-colors hover:bg-bw-sunken sm:p-4">
              <ProductImage image={image} name={product.name} />
              <span className="min-w-0 flex-1"><span className="block text-bw-small text-bw-ink-soft">{product.brand.name}</span><span className="line-clamp-2 font-semibold text-bw-ink"><bdi>{product.name}</bdi></span><span className="block truncate text-bw-small text-bw-ink-subtle"><bdi>{product.skus.map((sku) => sku.variantName).filter(Boolean).join(' · ') || product.category?.name || '—'}</bdi></span></span>
              <StatusLabel tone="ok">منشور</StatusLabel><ArrowLeft className="hidden size-4 text-bw-ink-subtle transition-transform group-hover:-translate-x-1 sm:block" aria-hidden />
            </button>
          })}
        </div> : null}
      </section> : view === 'review' ? <section aria-label="منتجات تحتاج المراجعة" className="space-y-4">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-bw-heading font-semibold">بحاجة إلى قرار</h2><p className="text-bw-small text-bw-ink-soft">افتح سجل المنتج للتحقق من الهوية والأدلة قبل الاعتماد.</p></div><Button variant="ghost" onClick={candidatesApi.reload} aria-label="تحديث المراجعات"><RefreshCw className="size-4" /></Button></div>
        {candidatesApi.error ? <LoadError message={candidatesApi.error.message} onRetry={candidatesApi.reload} /> : null}
        {candidatesApi.loading && !candidatesApi.data ? <Skeleton className="h-64 w-full rounded-bw-card" /> : null}
        {candidatesApi.data && candidates.length === 0 ? <StateBlock kind="empty" title="لا توجد مراجعات مطابقة" body="كل المنتجات الواردة تمت معالجتها أو لا تطابق البحث." /> : null}
        {candidates.length ? <div className="overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface divide-y divide-bw-line">
          {candidates.map((candidate) => <Link key={candidate.id} href={`/admin/catalog/review?candidate=${encodeURIComponent(candidate.id)}`}
            className="group flex items-center gap-4 p-4 transition-colors hover:bg-bw-sunken">
            <span className="grid size-14 shrink-0 place-items-center rounded-bw-field bg-bw-sunken"><PackageSearch className="size-5 text-bw-ink-soft" aria-hidden /></span>
            <span className="min-w-0 flex-1"><span className="line-clamp-2 font-semibold text-bw-ink"><bdi>{candidate.name}</bdi></span><span className="block text-bw-small text-bw-ink-soft">{candidate.brand} · <Code>{candidate.supplierSkuCode}</Code></span></span>
            <StatusLabel tone="warn">{candidateStates[candidate.status] ?? candidate.status}</StatusLabel><ArrowUpLeft className="hidden size-4 text-bw-ink-subtle sm:block" aria-hidden />
          </Link>)}
        </div> : null}
      </section> : <CatalogItems query={query} />}

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-bw-line pt-5 text-bw-small">
        <Link className="text-bw-ink-soft underline-offset-4 hover:text-bw-ink hover:underline" href="/admin/catalog/workbench">المنتجات المخزنة وتجهيز النشر</Link>
        <Link className="text-bw-ink-soft underline-offset-4 hover:text-bw-ink hover:underline" href="/admin/catalog/review">مراجعة البراندات والقوالب</Link>
        <Link className="text-bw-ink-soft underline-offset-4 hover:text-bw-ink hover:underline" href="/admin/ingestion-policy">سياسة البراندات والفئات</Link>
        <Link className="text-bw-ink-soft underline-offset-4 hover:text-bw-ink hover:underline" href="/admin/catalog/imports">ملفات الإدخال</Link>
      </footer>
    </main>
    <Dialog dialogRef={drawer.ref} variant="drawer" title="تفاصيل المنتج" onClose={() => setSelected(null)}
      footer={<Link href="/admin/catalog/workbench" className="inline-flex h-bw-control items-center rounded-bw-field border border-bw-line px-4 text-bw-small font-semibold text-bw-ink hover:bg-bw-sunken">افتح تجهيز المنتج للنشر</Link>}>
      {selected ? <div dir="rtl" className="space-y-6">
        <ProductImage image={selected.media.find((media) => media.isPrimary) ?? selected.media[0]} name={selected.name} large />
        <div><p className="text-bw-small text-bw-ink-soft">{selected.brand.name}</p><h3 className="mt-1 font-bw-display text-2xl font-semibold"><bdi>{selected.name}</bdi></h3>
          <div className="mt-3"><StatusLabel tone="ok">منشور</StatusLabel></div></div>
        {selected.description ? <p className="leading-7 text-bw-ink-soft">{selected.description}</p> : null}
        <div className="border-t border-bw-line pt-5"><h4 className="mb-4 font-semibold">النسخ المتاحة</h4><ul className="space-y-3">{selected.skus.map((sku) => <li key={sku.id} className="flex items-center justify-between gap-3 rounded-bw-field bg-bw-sunken p-3"><span>{sku.variantName ? <bdi>{sku.variantName}</bdi> : 'النسخة الأساسية'} {sku.size && !sku.variantName?.includes(String(sku.size)) ? <span className="text-bw-ink-soft">· <bdi dir="ltr">{sku.size} {sku.sizeUnit}</bdi></span> : null}</span><Code className="text-bw-ink-soft">{sku.code}</Code></li>)}</ul></div>
      </div> : null}
    </Dialog>
  </RoleShell>
}
