'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Building2, FolderTree, Package, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/bw/primitives'
import { Page } from '@/components/workspace/kit'
import { RoleShell } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { AllowlistTab } from './allowlist-tab'
import { BrandsTab } from './brands-tab'
import { BrandSummary, CategoryNode, ProductFilters, parseProductFilters } from './catalog-model'
import { CategoriesTab } from './categories-tab'
import { ProductsTab } from './products-tab'

const TABS = [
  { key: 'products', label: 'المنتجات', icon: Package },
  { key: 'brands', label: 'الماركات', icon: Building2 },
  { key: 'categories', label: 'التصنيفات', icon: FolderTree },
  { key: 'allowlist', label: 'قائمة السماح', icon: ShieldCheck },
] as const

type TabKey = (typeof TABS)[number]['key']

/**
 * Admin Catalog, simplified. The tab, every product filter and the open product live in the URL, so closing a
 * panel, refreshing or coming back never loses where you were.
 */
export default function AdminCatalogNext() {
  return (
    <React.Suspense fallback={null}>
      <CatalogPage />
    </React.Suspense>
  )
}

function CatalogPage() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const brandsApi = useApi<BrandSummary[]>('/brands?includeInactive=true')
  const categoriesApi = useApi<CategoryNode[]>('/categories?includeInactive=true')

  const rawTab = params.get('tab')
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : 'products'
  const filters = parseProductFilters((key) => params.get(key))
  const selectedId = params.get('p')

  const update = React.useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [params, pathname, router])

  const setFilters = React.useCallback((patch: Partial<ProductFilters>) => {
    const out: Record<string, string | null> = {}
    if ('q' in patch) out.q = patch.q ?? null
    if ('brand' in patch) out.brand = patch.brand ?? null
    if ('cat' in patch) out.cat = patch.cat ?? null
    if ('status' in patch) out.status = patch.status && patch.status !== 'all' ? patch.status : null
    if ('ready' in patch) out.ready = patch.ready ?? null
    if ('page' in patch) out.page = patch.page && patch.page > 1 ? String(patch.page) : null
    update(out)
  }, [update])

  const selectTab = (key: TabKey) => update({ tab: key === 'products' ? null : key, p: null })

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = TABS.findIndex((t) => t.key === tab)
    const step = getComputedStyle(event.currentTarget).direction === 'rtl' ? (event.key === 'ArrowLeft' ? 1 : -1) : (event.key === 'ArrowRight' ? 1 : -1)
    const next = TABS[(index + step + TABS.length) % TABS.length]
    selectTab(next.key)
    ;(event.currentTarget.querySelectorAll('[role="tab"]')[TABS.indexOf(next)] as HTMLButtonElement | undefined)?.focus()
  }

  return (
    <RoleShell role="admin" active="catalog" mode="desktop">
      <Page>
        <PageHeader
          title="الكتالوج"
          actions={
            <Link
              href="/admin/catalog"
              className="inline-flex h-bw-control items-center gap-2 rounded-bw-field border border-bw-line bg-bw-surface px-3.5 text-bw-small font-semibold text-bw-ink transition-colors hover:border-bw-line-field hover:bg-bw-sunken"
            >
              الواجهة التفصيلية
            </Link>
          }
        />
        <div role="tablist" aria-label="أقسام الكتالوج" onKeyDown={onKeyDown} className="flex gap-3.5 border-b border-bw-line sm:gap-7">
          {TABS.map(({ key, label, icon: Icon }) => {
            const selected = tab === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`catalog-tab-${key}`}
                aria-selected={selected}
                aria-controls="catalog-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(key)}
                className={cn(
                  '-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-0.5 text-bw-small font-semibold transition-colors sm:px-1 sm:text-bw-body',
                  selected ? 'border-bw-cobalt text-bw-ink' : 'border-transparent text-bw-ink-soft hover:text-bw-ink',
                )}
              >
                <Icon className={cn('hidden size-4 sm:block', selected ? 'text-bw-cobalt' : 'text-bw-ink-subtle')} aria-hidden />
                {label}
              </button>
            )
          })}
        </div>

        <div role="tabpanel" id="catalog-panel" aria-labelledby={`catalog-tab-${tab}`}>
          {tab === 'products' ? (
            <ProductsTab
              brands={brandsApi.data ?? []}
              categories={categoriesApi.data ?? []}
              filters={filters}
              setFilters={setFilters}
              selectedId={selectedId}
              setSelectedId={(id) => update({ p: id })}
            />
          ) : null}
          {tab === 'brands' ? (
            <BrandsTab
              brands={brandsApi.data ?? []}
              loading={brandsApi.loading}
              error={brandsApi.error?.message ?? null}
              onReload={brandsApi.reload}
              onViewProducts={(brand) => update({ tab: null, brand, cat: null, q: null, status: null, ready: null, page: null, p: null })}
            />
          ) : null}
          {tab === 'categories' ? (
            <CategoriesTab
              categories={categoriesApi.data ?? []}
              loading={categoriesApi.loading}
              error={categoriesApi.error?.message ?? null}
              onReload={categoriesApi.reload}
              onViewProducts={(cat) => update({ tab: null, cat, brand: null, q: null, status: null, ready: null, page: null, p: null })}
            />
          ) : null}
          {tab === 'allowlist' ? <AllowlistTab brands={brandsApi.data ?? []} categories={categoriesApi.data ?? []} /> : null}
        </div>
      </Page>
    </RoleShell>
  )
}
