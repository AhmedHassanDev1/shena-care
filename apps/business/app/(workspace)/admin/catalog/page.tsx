'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Building2,
  FileSpreadsheet,
  FolderTree,
  Image as ImageIcon,
  Layers,
  Package,
  ShieldCheck,
} from 'lucide-react'
import { Code, PageHeader } from '@/components/bw/primitives'
import { RoleShell } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import { AllowlistTab } from './allowlist-tab'
import { BrandsTab } from './brands-tab'
import { BrandSummary, CategoryNode } from './catalog-utils'
import { CategoriesTab } from './categories-tab'
import { ProductsTab } from './products-tab'

type CatalogTabKey = 'products' | 'brands' | 'categories' | 'allowlist'

export default function AdminCatalog() {
  const [activeTab, setActiveTab] = React.useState<CatalogTabKey>('products')
  const [productBrandFilter, setProductBrandFilter] = React.useState<string>('')
  const [productCategoryFilter, setProductCategoryFilter] = React.useState<string>('')

  const brandsApi = useApi<BrandSummary[]>('/brands?includeInactive=true')
  const categoriesApi = useApi<CategoryNode[]>('/categories?includeInactive=true')

  const brands = brandsApi.data ?? []
  const categories = categoriesApi.data ?? []

  function jumpToBrandProducts(brandId: string) {
    setProductCategoryFilter('')
    setProductBrandFilter(brandId)
    setActiveTab('products')
  }

  function jumpToCategoryProducts(categoryId: string) {
    setProductBrandFilter('')
    setProductCategoryFilter(categoryId)
    setActiveTab('products')
  }

  const tabs: Array<{
    key: CatalogTabKey
    label: string
    icon: React.ElementType
    count?: number
  }> = [
    { key: 'products', label: 'المنتجات', icon: Package },
    { key: 'brands', label: 'الماركات', icon: Building2, count: brands.length },
    {
      key: 'categories',
      label: 'التصنيفات',
      icon: FolderTree,
      count: categories.reduce((acc, c) => acc + 1 + c.children.length, 0),
    },
    { key: 'allowlist', label: 'قائمة السماح (Allowlist)', icon: ShieldCheck },
  ]

  return (
    <RoleShell role="admin" active="catalog">
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-8" dir="rtl">
        <PageHeader
          eyebrow="مساحة الإدارة / الكتالوج"
          title="إدارة الكتالوج"
          meta="إدارة المنتجات، الماركات، شجرة التصنيفات، وقواعد قائمة السماح لاستيراد الموردين من مكان واحد."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/admin/catalog-next"
                className="inline-flex h-bw-control items-center gap-2 rounded-bw-field border border-bw-line bg-bw-surface px-3.5 text-bw-small font-semibold text-bw-ink transition-colors hover:border-bw-line-field hover:bg-bw-sunken"
              >
                <Layers className="size-4 text-bw-cobalt" aria-hidden />
                الواجهة المبسطة
              </Link>
              <Link
                href="/admin/catalog/media-templates"
                className="inline-flex h-bw-control items-center gap-2 rounded-bw-field border border-bw-line bg-bw-surface px-3.5 text-bw-small font-semibold text-bw-ink transition-colors hover:border-bw-line-field hover:bg-bw-sunken"
              >
                <ImageIcon className="size-4 text-bw-violet" aria-hidden />
                قوالب الصور
              </Link>
              <Link
                href="/admin/catalog/intake"
                className="inline-flex h-bw-control items-center gap-2 rounded-bw-field border border-bw-line bg-bw-surface px-3.5 text-bw-small font-semibold text-bw-ink transition-colors hover:border-bw-line-field hover:bg-bw-sunken"
              >
                <FileSpreadsheet className="size-4 text-bw-cobalt" aria-hidden />
                إدخال المنتجات
              </Link>
            </div>
          }
        />

        <nav
          aria-label="أقسام إدارة الكتالوج"
          role="tablist"
          className="flex flex-wrap gap-1.5 rounded-bw-card border border-bw-line bg-bw-sunken p-1.5"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon
            const selected = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex min-h-bw-control items-center gap-2 rounded-bw-field px-3.5 py-2 text-bw-small font-semibold transition-colors ${
                  selected
                    ? 'border border-bw-cobalt/30 bg-bw-surface text-bw-ink shadow-bw-card'
                    : 'text-bw-ink-soft hover:bg-bw-surface/50 hover:text-bw-ink'
                }`}
              >
                <Icon
                  className={`size-4 ${selected ? 'text-bw-cobalt' : 'text-bw-ink-subtle'}`}
                  aria-hidden
                />
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && tab.count > 0 ? (
                  <Code className="rounded-full bg-bw-sunken px-2 py-0.5 text-[11px] text-bw-ink-soft">
                    {tab.count}
                  </Code>
                ) : null}
              </button>
            )
          })}
        </nav>

        {activeTab === 'products' ? (
          <ProductsTab
            brands={brands}
            categories={categories}
            initialBrandId={productBrandFilter}
            initialCategoryId={productCategoryFilter}
            onClearExternalFilters={() => {
              setProductBrandFilter('')
              setProductCategoryFilter('')
            }}
          />
        ) : null}

        {activeTab === 'brands' ? (
          <BrandsTab
            brands={brands}
            loading={brandsApi.loading}
            error={brandsApi.error?.message ?? null}
            onReload={brandsApi.reload}
            onViewBrandProducts={jumpToBrandProducts}
          />
        ) : null}

        {activeTab === 'categories' ? (
          <CategoriesTab
            categories={categories}
            loading={categoriesApi.loading}
            error={categoriesApi.error?.message ?? null}
            onReload={categoriesApi.reload}
            onViewCategoryProducts={jumpToCategoryProducts}
          />
        ) : null}

        {activeTab === 'allowlist' ? (
          <AllowlistTab brands={brands} categories={categories} />
        ) : null}
      </main>
    </RoleShell>
  )
}
