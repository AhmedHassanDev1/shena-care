'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button, Code, Skeleton, StateBlock, StatusLabel, useDialog } from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import {
  BrandSummary,
  CatalogItem,
  CatalogItemsResponse,
  CatalogThumbnail,
  CategoryNode,
  flattenCategories,
  readinessIssueLabel,
} from './catalog-utils'
import { ProductWorkbenchDrawer } from './product-drawer'

type StatusFilter = 'all' | 'published' | 'draft' | 'archived'
type ReadinessFilter = '' | 'missing_image' | 'pending_image' | 'missing_price' | 'not_listed' | 'ready'

export function ProductsTab({
  brands,
  categories,
  initialBrandId,
  initialCategoryId,
  onClearExternalFilters,
}: {
  brands: BrandSummary[]
  categories: CategoryNode[]
  initialBrandId?: string
  initialCategoryId?: string
  onClearExternalFilters?: () => void
}) {
  const [query, setQuery] = React.useState('')
  const [brandId, setBrandId] = React.useState(initialBrandId ?? '')
  const [categoryId, setCategoryId] = React.useState(initialCategoryId ?? '')
  const [status, setStatus] = React.useState<StatusFilter>('all')
  const [readiness, setReadiness] = React.useState<ReadinessFilter>('')
  const [page, setPage] = React.useState(1)

  const [selected, setSelected] = React.useState<CatalogItem | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const drawer = useDialog()

  React.useEffect(() => {
    if (initialBrandId !== undefined) setBrandId(initialBrandId)
  }, [initialBrandId])

  React.useEffect(() => {
    if (initialCategoryId !== undefined) setCategoryId(initialCategoryId)
  }, [initialCategoryId])

  React.useEffect(() => {
    setPage(1)
  }, [query, brandId, categoryId, status, readiness])

  const path = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (query.trim()) params.set('q', query.trim())
    if (brandId) params.set('brandId', brandId)
    if (categoryId) params.set('categoryId', categoryId)
    if (status !== 'all') params.set('status', status)
    if (readiness) params.set('readiness', readiness)
    return `/catalog/items?${params.toString()}`
  }, [page, query, brandId, categoryId, status, readiness])

  const itemsApi = useApi<CatalogItemsResponse>(path)
  const flatCategories = React.useMemo(() => flattenCategories(categories), [categories])

  const hasFilters = Boolean(query.trim() || brandId || categoryId || status !== 'all' || readiness)

  function clearFilters() {
    setQuery('')
    setBrandId('')
    setCategoryId('')
    setStatus('all')
    setReadiness('')
    onClearExternalFilters?.()
  }

  async function quickRestore(product: CatalogItem) {
    setBusyId(product.id)
    setActionError(null)
    try {
      await api(`/catalog/items/${product.id}/restore`, { method: 'POST' })
      setNotice(`تمت استعادة «${product.name}» كمسودة.`)
      itemsApi.reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'تعذر استعادة المنتج.')
    } finally {
      setBusyId(null)
    }
  }

  const summary = itemsApi.data?.summary
  const totalPages = itemsApi.data ? Math.max(1, Math.ceil(itemsApi.data.total / itemsApi.data.limit)) : 1

  return (
    <section aria-label="قائمة المنتجات" className="space-y-4">
      {summary ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            {
              key: 'all' as const,
              label: 'إجمالي الكتالوج',
              count: summary.total,
              accent: 'text-bw-ink',
              active: status === 'all' && !readiness,
              onClick: () => {
                setStatus('all')
                setReadiness('')
              },
            },
            {
              key: 'published' as const,
              label: 'منشور بالمتجر',
              count: summary.published,
              accent: 'text-bw-emerald',
              active: status === 'published',
              onClick: () => {
                setStatus('published')
                setReadiness('')
              },
            },
            {
              key: 'draft' as const,
              label: 'مسودات',
              count: summary.draft,
              accent: 'text-bw-amber',
              active: status === 'draft',
              onClick: () => {
                setStatus('draft')
                setReadiness('')
              },
            },
            {
              key: 'archived' as const,
              label: 'مؤرشف',
              count: summary.archived,
              accent: 'text-bw-ink-subtle',
              active: status === 'archived',
              onClick: () => {
                setStatus('archived')
                setReadiness('')
              },
            },
            {
              key: 'missing_image' as const,
              label: 'بلا صورة منشورة',
              count: summary.missingImage,
              accent: 'text-bw-rose',
              active: readiness === 'missing_image',
              onClick: () => {
                setStatus('all')
                setReadiness('missing_image')
              },
            },
          ].map((stat) => (
            <button
              key={stat.key}
              type="button"
              onClick={stat.onClick}
              className={`rounded-bw-card border px-3.5 py-2.5 text-start transition-colors ${
                stat.active
                  ? 'border-bw-cobalt bg-bw-cobalt-soft'
                  : 'border-bw-line bg-bw-surface hover:bg-bw-sunken'
              }`}
            >
              <span className="block text-[11px] font-semibold text-bw-ink-soft">
                {stat.label}
              </span>
              <span className={`mt-0.5 block font-bw-display text-xl font-bold ${stat.accent}`}>
                <Code>{stat.count}</Code>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-3.5 lg:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))_auto] lg:items-end">
        <label className="relative block">
          <span className="mb-1 block text-[11px] font-semibold text-bw-ink-soft">
            بحث سريع
          </span>
          <Search
            className="pointer-events-none absolute bottom-3 start-3 size-4 text-bw-ink-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="اسم المنتج، الماركة، SKU أو الباركود"
            className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-sunken pe-3 ps-9 text-bw-small text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-cobalt focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-bw-ink-soft">الماركة</span>
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-sunken px-3 text-bw-small text-bw-ink focus:border-bw-cobalt focus:outline-none"
          >
            <option value="">كل الماركات</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-bw-ink-soft">التصنيف</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-sunken px-3 text-bw-small text-bw-ink focus:border-bw-cobalt focus:outline-none"
          >
            <option value="">كل التصنيفات</option>
            {flatCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentName ? `${c.parentName} ← ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-bw-ink-soft">الحالة</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-sunken px-3 text-bw-small text-bw-ink focus:border-bw-cobalt focus:outline-none"
          >
            <option value="all">كل الحالات</option>
            <option value="published">منشور</option>
            <option value="draft">مسودة</option>
            <option value="archived">مؤرشف</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-bw-ink-soft">الجاهزية</span>
          <select
            value={readiness}
            onChange={(e) => setReadiness(e.target.value as ReadinessFilter)}
            className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-sunken px-3 text-bw-small text-bw-ink focus:border-bw-cobalt focus:outline-none"
          >
            <option value="">كل مستويات الجاهزية</option>
            <option value="ready">جاهز للبيع</option>
            <option value="missing_image">بلا صورة منشورة</option>
            <option value="pending_image">صورة بانتظار المراجعة</option>
            <option value="missing_price">بلا سعر بيع</option>
            <option value="not_listed">غير ظاهر بالمتجر</option>
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          {hasFilters ? (
            <Button variant="ghost" onClick={clearFilters} title="إلغاء جميع الفلاتر">
              <SlidersHorizontal className="size-4" aria-hidden />
              مسح
            </Button>
          ) : null}
          <Button variant="ghost" aria-label="تحديث المنتجات" onClick={itemsApi.reload}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          className="rounded-bw-field border border-bw-emerald/30 bg-bw-emerald-soft px-3.5 py-2.5 text-bw-small text-bw-ink"
        >
          {notice}
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="rounded-bw-field border border-bw-rose/30 bg-bw-rose-soft px-3.5 py-2.5 text-bw-small text-bw-ink"
        >
          {actionError}
        </div>
      ) : null}

      {itemsApi.error ? <LoadError message={itemsApi.error.message} onRetry={itemsApi.reload} /> : null}
      {itemsApi.loading && !itemsApi.data ? <Skeleton className="h-72 w-full rounded-bw-card" /> : null}

      {itemsApi.data && itemsApi.data.items.length === 0 ? (
        <StateBlock
          kind="empty"
          title="لا توجد منتجات مطابقة"
          body={
            hasFilters
              ? 'جرّب تعديل كلمات البحث أو مسح الفلاتر لعرض منتجات أخرى.'
              : 'لم يتم إضافة أي منتجات في الكتالوج بعد.'
          }
          action={hasFilters ? <Button variant="secondary" onClick={clearFilters}>مسح الفلاتر</Button> : undefined}
        />
      ) : null}

      {itemsApi.data && itemsApi.data.items.length > 0 ? (
        <>
          <div className="hidden overflow-x-auto rounded-bw-card border border-bw-line bg-bw-surface md:block">
            <table className="w-full text-start text-bw-small">
              <thead className="border-b border-bw-line bg-bw-sunken text-[11px] font-semibold text-bw-ink-soft">
                <tr>
                  <th className="px-4 py-3 text-start">المنتج</th>
                  <th className="px-3 py-3 text-start">التصنيف</th>
                  <th className="px-3 py-3 text-start">النسخ والأكواد</th>
                  <th className="px-3 py-3 text-start">الحالة</th>
                  <th className="px-3 py-3 text-start">الجاهزية والبيانات</th>
                  <th className="px-3 py-3 text-start">السعر والتوافر</th>
                  <th className="px-4 py-3 text-end">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bw-line">
                {itemsApi.data.items.map((product) => {
                  const firstSku = product.skus[0]
                  const pricedSku = product.skus.find((s) => s.currentPrice)
                  const anyListed = product.skus.some((s) => s.isListed)
                  const activeCount = product.skus.filter((s) => s.isActive).length
                  return (
                    <tr
                      key={product.id}
                      className="transition-colors hover:bg-bw-sunken"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <CatalogThumbnail
                            url={product.media[0]?.url}
                            alt={product.name}
                            mediaStatus={product.mediaStatus}
                          />
                          <div className="min-w-0 max-w-xs">
                            <p className="truncate font-semibold text-bw-ink">
                              <bdi>{product.name}</bdi>
                            </p>
                            <p className="truncate text-[11px] text-bw-ink-soft">
                              <bdi>{product.brand.name}</bdi>
                              {product.productLine ? (
                                <span className="text-bw-ink-subtle"> · {product.productLine.name}</span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3 text-bw-ink-soft">
                        {product.category ? product.category.name : <span className="text-bw-rose">غير مصنف</span>}
                      </td>

                      <td className="px-3 py-3">
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Code className="rounded bg-bw-sunken px-1.5 py-0.5 text-[11px] text-bw-ink">
                              {firstSku?.code ?? '—'}
                            </Code>
                            {product.skus.length > 1 ? (
                              <span className="text-[11px] text-bw-ink-subtle">
                                +<Code>{product.skus.length - 1}</Code>
                              </span>
                            ) : null}
                          </div>
                          {firstSku?.barcode || firstSku?.size ? (
                            <p className="text-[11px] text-bw-ink-subtle">
                              {firstSku.size ? (
                                <Code>{`${firstSku.size}${firstSku.sizeUnit ?? ''}`}</Code>
                              ) : null}
                              {firstSku.size && firstSku.barcode ? ' · ' : null}
                              {firstSku.barcode ? <Code>{firstSku.barcode}</Code> : null}
                            </p>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        <StatusLabel
                          tone={product.archivedAt ? 'pending' : product.isPublished ? 'ok' : 'warn'}
                        >
                          {product.archivedAt ? 'مؤرشف' : product.isPublished ? 'منشور' : 'مسودة'}
                        </StatusLabel>
                      </td>

                      <td className="px-3 py-3">
                        {product.archivedAt ? (
                          <span className="text-[11px] text-bw-ink-subtle">مؤرشف</span>
                        ) : product.readiness.issues.length === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-bw-emerald/25 bg-bw-emerald-soft px-2 py-0.5 text-[11px] font-semibold text-bw-emerald">
                            مكتمل البيانات
                          </span>
                        ) : (
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {product.readiness.issues.slice(0, 2).map((issue) => (
                              <span
                                key={issue}
                                className="rounded-full border border-bw-amber/25 bg-bw-amber-soft px-2 py-0.5 text-[11px] text-bw-ink"
                              >
                                {readinessIssueLabel(issue)}
                              </span>
                            ))}
                            {product.readiness.issues.length > 2 ? (
                              <span className="rounded-full bg-bw-sunken px-2 py-0.5 text-[11px] text-bw-ink-subtle">
                                +<Code>{product.readiness.issues.length - 2}</Code>
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-bw-ink">
                            {pricedSku?.currentPrice ? (
                              <Code>{`${pricedSku.currentPrice.amount} EGP`}</Code>
                            ) : (
                              <span className="text-bw-rose">بلا سعر</span>
                            )}
                          </p>
                          <p className="text-[11px] text-bw-ink-subtle">
                            {anyListed ? 'ظاهر بالمتجر' : 'غير معروض'} · <Code>{`${activeCount}/${product.skus.length}`}</Code> مفعّل
                          </p>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-end">
                        {product.archivedAt ? (
                          <Button
                            variant="secondary"
                            loading={busyId === product.id}
                            onClick={() => void quickRestore(product)}
                          >
                            <RotateCcw className="size-3.5" aria-hidden />
                            استعادة
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setSelected(product)
                              drawer.open()
                            }}
                          >
                            إدارة المنتج
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2.5 md:hidden">
            {itemsApi.data.items.map((product) => {
              const firstSku = product.skus[0]
              const pricedSku = product.skus.find((s) => s.currentPrice)
              return (
                <article
                  key={product.id}
                  className="space-y-2.5 rounded-bw-card border border-bw-line bg-bw-surface p-3.5"
                >
                  <div className="flex items-start gap-3">
                    <CatalogThumbnail
                      url={product.media[0]?.url}
                      alt={product.name}
                      mediaStatus={product.mediaStatus}
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-[11px] text-bw-ink-soft">
                        {product.brand.name} · {product.category?.name ?? 'غير مصنف'}
                      </p>
                      <h3 className="font-semibold text-bw-ink">
                        <bdi>{product.name}</bdi>
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-bw-ink-subtle">
                        <Code>{firstSku?.code ?? '—'}</Code>
                        {pricedSku?.currentPrice ? (
                          <span className="font-semibold text-bw-emerald">
                            <Code>{`${pricedSku.currentPrice.amount} EGP`}</Code>
                          </span>
                        ) : (
                          <span className="text-bw-rose">بلا سعر</span>
                        )}
                      </div>
                    </div>
                    <StatusLabel
                      tone={product.archivedAt ? 'pending' : product.isPublished ? 'ok' : 'warn'}
                    >
                      {product.archivedAt ? 'مؤرشف' : product.isPublished ? 'منشور' : 'مسودة'}
                    </StatusLabel>
                  </div>

                  {!product.archivedAt && product.readiness.issues.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {product.readiness.issues.slice(0, 3).map((issue) => (
                        <span
                          key={issue}
                          className="rounded-full bg-bw-amber-soft px-2 py-0.5 text-[11px] text-bw-ink"
                        >
                          {readinessIssueLabel(issue)}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex justify-end border-t border-bw-line pt-2.5">
                    {product.archivedAt ? (
                      <Button
                        variant="secondary"
                        loading={busyId === product.id}
                        onClick={() => void quickRestore(product)}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        استعادة
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSelected(product)
                          drawer.open()
                        }}
                      >
                        إدارة المنتج والنسخ
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          {itemsApi.data.total > itemsApi.data.limit ? (
            <nav
              aria-label="ترقيم صفحات المنتجات"
              className="flex items-center justify-between gap-3 rounded-bw-card border border-bw-line bg-bw-surface px-4 py-2.5 text-bw-small"
            >
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronRight className="size-4" aria-hidden />
                السابق
              </Button>
              <span className="text-bw-ink-soft">
                صفحة <Code className="font-semibold text-bw-ink">{page}</Code> من{' '}
                <Code className="font-semibold text-bw-ink">{totalPages}</Code> (
                <Code>{itemsApi.data.total}</Code> منتج)
              </span>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}

      <ProductWorkbenchDrawer
        dialogRef={drawer.ref}
        product={selected}
        brands={brands}
        categories={categories}
        onClose={() => {
          drawer.close()
          setSelected(null)
        }}
        onChanged={(msg) => {
          setNotice(msg)
          itemsApi.reload()
        }}
      />
    </section>
  )
}
