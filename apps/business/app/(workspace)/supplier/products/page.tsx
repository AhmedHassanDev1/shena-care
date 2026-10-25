'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit2,
  FileSpreadsheet,
  Filter,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Store,
  Tag,
  X,
  XCircle,
} from 'lucide-react'
import { Button, Code, Field, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { CommandError, Egp } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { api, type ApiError } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

export interface SupplierOffer {
  id: string
  supplierId: string
  skuId: string
  costPrice: number
  currency: string
  isAvailable: boolean
  /** Quantity the supplier says it can supply now; null = not reported. Allocation never goes above it. */
  availableQuantity?: number | null
  lastObservedAt: string
  lastConfirmedAt: string | null
  createdAt: string
  updatedAt: string
  sku?: {
    productName: string
    brandName: string | null
    variantName: string
    skuCode: string
    barcode: string | null
    size?: number | null
    sizeUnit?: string | null
    imageUrl?: string | null
  }
}

export interface CatalogProductView {
  id: string
  name: string
  brand: {
    id: string
    name: string
  }
  skus: Array<{
    id: string
    code: string
    barcode: string | null
    variantName: string
    size: number | null
    sizeUnit: string | null
  }>
  media?: Array<{
    url: string
    isPrimary: boolean
  }>
}

export interface EnrichedOffer extends SupplierOffer {
  productName: string
  brandName: string | null
  variantName: string | null
  size: number | null
  sizeUnit: string | null
  skuCode: string | null
  barcode: string | null
  imageUrl?: string | null
}

type AvailabilityFilter = 'all' | 'available' | 'unavailable'
type SortField = 'name' | 'price_asc' | 'price_desc' | 'updated'

export default function SupplierProductsPage() {
  return (
    <RoleShell role="supplier" active="products" mode="responsive">
      <ProductsContent />
    </RoleShell>
  )
}

function ProductsContent() {
  const me = useMe()
  const supplierId = me.supplierId

  // Fetch supplier offers
  const offersApi = useApi<SupplierOffer[]>(
    supplierId ? `/sourcing/offers?supplierId=${supplierId}` : null,
    { pollMs: 30000 }
  )

  // Fetch catalog products to enrich SKU names and barcodes
  const productsApi = useApi<CatalogProductView[]>('/products?limit=100')

  // Build a lookup index for SKUs
  const skuIndex = React.useMemo(() => {
    const map = new Map<
      string,
      {
        productName: string
        brandName: string
        variantName: string
        size: number | null
        sizeUnit: string | null
        skuCode: string
        barcode: string | null
        imageUrl: string | null
      }
    >()

    if (productsApi.data) {
      for (const prod of productsApi.data) {
        const primaryImage = prod.media?.find((m) => m.isPrimary)?.url ?? prod.media?.[0]?.url ?? null
        for (const sku of prod.skus) {
          map.set(sku.id, {
            productName: prod.name,
            brandName: prod.brand.name,
            variantName: sku.variantName,
            size: sku.size,
            sizeUnit: sku.sizeUnit,
            skuCode: sku.code,
            barcode: sku.barcode,
            imageUrl: primaryImage,
          })
        }
      }
    }
    return map
  }, [productsApi.data])

  // Combine offers with catalog product metadata
  const enrichedOffers = React.useMemo<EnrichedOffer[]>(() => {
    const rawOffers = offersApi.data ?? []
    return rawOffers.map((offer) => {
      const meta = offer.sku ?? skuIndex.get(offer.skuId)
      return {
        ...offer,
        productName: meta?.productName ?? `صنف #${shortId(offer.skuId)}`,
        brandName: meta?.brandName ?? null,
        variantName: meta?.variantName ?? null,
        size: meta?.size ?? null,
        sizeUnit: meta?.sizeUnit ?? null,
        skuCode: meta?.skuCode ?? null,
        barcode: meta?.barcode ?? null,
        imageUrl: meta?.imageUrl ?? null,
      }
    })
  }, [offersApi.data, skuIndex])

  // Filter & Search states
  const [searchQuery, setSearchQuery] = React.useState('')
  const [availabilityFilter, setAvailabilityFilter] = React.useState<AvailabilityFilter>('all')
  const [sortBy, setSortBy] = React.useState<SortField>('updated')

  // Pagination states
  const [currentPage, setCurrentPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)

  // Selection states for bulk actions
  const [selectedOfferIds, setSelectedOfferIds] = React.useState<Set<string>>(new Set())

  // Modal edit state
  const [editingOffer, setEditingOffer] = React.useState<EnrichedOffer | null>(null)

  // Filter & Sort computation
  const filteredAndSortedOffers = React.useMemo(() => {
    let result = enrichedOffers.filter((offer) => {
      if (availabilityFilter === 'available' && !offer.isAvailable) return false
      if (availabilityFilter === 'unavailable' && offer.isAvailable) return false

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const matchesName = offer.productName.toLowerCase().includes(q)
        const matchesBrand = offer.brandName?.toLowerCase().includes(q)
        const matchesVariant = offer.variantName?.toLowerCase().includes(q)
        const matchesCode = offer.skuCode?.toLowerCase().includes(q)
        const matchesBarcode = offer.barcode?.toLowerCase().includes(q)
        const matchesSkuId = offer.skuId.toLowerCase().includes(q) || shortId(offer.skuId).toLowerCase().includes(q)

        if (!matchesName && !matchesBrand && !matchesVariant && !matchesCode && !matchesBarcode && !matchesSkuId) {
          return false
        }
      }
      return true
    })

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'name') {
        return a.productName.localeCompare(b.productName, 'ar')
      }
      if (sortBy === 'price_asc') {
        return a.costPrice - b.costPrice
      }
      if (sortBy === 'price_desc') {
        return b.costPrice - a.costPrice
      }
      // 'updated'
      const dateA = new Date(a.lastObservedAt ?? a.updatedAt).getTime()
      const dateB = new Date(b.lastObservedAt ?? b.updatedAt).getTime()
      return dateB - dateA
    })

    return result
  }, [enrichedOffers, availabilityFilter, searchQuery, sortBy])

  // Total pages
  const totalItems = filteredAndSortedOffers.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const paginatedOffers = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredAndSortedOffers.slice(start, start + pageSize)
  }, [filteredAndSortedOffers, currentPage, pageSize])

  // Reset page on search/filter changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, availabilityFilter, pageSize])

  // Aggregate KPI metrics
  const availableCount = enrichedOffers.filter((o) => o.isAvailable).length
  const unavailableCount = enrichedOffers.length - availableCount
  const avgCostPrice = enrichedOffers.length
    ? enrichedOffers.reduce((sum, o) => sum + o.costPrice, 0) / enrichedOffers.length
    : 0

  // Bulk Selection Handlers
  const handleSelectAllCurrentPage = () => {
    setSelectedOfferIds((prev) => {
      const allSelected = paginatedOffers.every((o) => prev.has(o.id))
      const next = new Set(prev)
      if (allSelected) {
        paginatedOffers.forEach((o) => next.delete(o.id))
      } else {
        paginatedOffers.forEach((o) => next.add(o.id))
      }
      return next
    })
  }

  const toggleSelectOffer = (id: string) => {
    setSelectedOfferIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Bulk Availability Command
  const [bulkPending, setBulkPending] = React.useState(false)
  const [bulkError, setBulkError] = React.useState<ApiError | null>(null)

  const handleBulkSetAvailability = async (isAvailable: boolean) => {
    if (selectedOfferIds.size === 0) return
    setBulkPending(true)
    setBulkError(null)
    try {
      for (const offerId of selectedOfferIds) {
        await api(`/sourcing/offers/${offerId}/confirm-availability`, {
          method: 'POST',
          body: { isAvailable },
        })
      }
      setSelectedOfferIds(new Set())
      offersApi.reload()
    } catch (err: any) {
      setBulkError(err)
    } finally {
      setBulkPending(false)
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Top Header & Fast Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <PageHeader
            title="منتجاتي وأسعاري"
            meta="قائمة أصناف المورد المعتمدة وأسعار الشراء الصافية لشيناكير مع التحكم المباشر بحالة التوفر"
          />
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => {
                offersApi.reload()
                productsApi.reload()
              }}
              disabled={offersApi.loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-bw-surface px-3 text-xs font-semibold text-bw-ink-soft hover:bg-white/[0.04] hover:text-white transition-all shadow-xs"
            >
              <RefreshCw className={`size-3.5 ${offersApi.loading ? 'animate-spin' : ''}`} />
              <span>تحديث العروض</span>
            </button>
            <Link
              href="/supplier/updates"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#34d27b] px-3.5 text-xs font-bold text-black hover:bg-[#2eb96c] transition-all shadow-[0_2px_12px_rgba(52,210,123,0.3)]"
            >
              <FileSpreadsheet className="size-3.5" />
              <span>تحديث جماعي عبر Excel/CSV</span>
            </Link>
          </div>
        </div>

        {/* Operational KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="rounded-2xl border border-white/[0.08] bg-bw-surface/70 p-4 space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-bw-ink-subtle">
              إجمالي الأصناف المسجلة
            </span>
            <p className="font-mono text-2xl sm:text-3xl font-extrabold text-white">
              {enrichedOffers.length}
            </p>
            <p className="text-[11px] text-bw-ink-subtle">
              أصناف مسعرة تحت حسابكم
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                متوفر للطلب
              </span>
              <CheckCircle2 className="size-4 text-emerald-400" />
            </div>
            <p className="font-mono text-2xl sm:text-3xl font-extrabold text-white">
              {availableCount}
            </p>
            <p className="text-[11px] text-bw-ink-subtle">
              جاهز لإصدار أوامر الشراء
            </p>
          </div>

          <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">
                غير متوفر / نافد
              </span>
              <XCircle className="size-4 text-red-400" />
            </div>
            <p className="font-mono text-2xl sm:text-3xl font-extrabold text-white">
              {unavailableCount}
            </p>
            <p className="text-[11px] text-bw-ink-subtle">
              موقوف مؤقتاً لتجنب أوامر الشراء
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-bw-surface/70 p-4 space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-bw-ink-subtle">
              متوسط سعر الشراء
            </span>
            <p className="font-mono text-2xl sm:text-3xl font-extrabold text-white">
              <Egp value={avgCostPrice} />
            </p>
            <p className="text-[11px] text-bw-ink-subtle">
              تكلفة التوريد الصافية لشيناكير
            </p>
          </div>
        </div>

        {/* Search, Filters, and Bulk Actions Toolbar */}
        <div className="space-y-3">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute start-3 top-2.5 size-4 text-bw-ink-subtle" />
              <input
                type="text"
                placeholder="بحث باسم المنتج، الماركة، الحجم، كود الصنف، أو الباركود..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-bw-surface/90 pe-3 ps-9 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-[#34d27b] focus:outline-none focus:ring-1 focus:ring-[#34d27b]/30 transition-all shadow-inner"
              />
            </div>

            {/* Filter & Sort Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Availability Filter Buttons */}
              <div className="flex rounded-xl border border-white/[0.08] bg-bw-surface p-1">
                {(
                  [
                    ['all', 'الكل'],
                    ['available', 'متوفر'],
                    ['unavailable', 'غير متوفر'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAvailabilityFilter(key)}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all ${
                      availabilityFilter === key
                        ? 'bg-[#34d27b] text-black shadow-xs'
                        : 'text-bw-ink-soft hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Sort Selector */}
              <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-bw-surface px-2.5 py-1 text-xs">
                <ArrowUpDown className="size-3.5 text-bw-ink-subtle" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortField)}
                  className="bg-transparent text-xs text-bw-ink font-medium focus:outline-none cursor-pointer"
                >
                  <option value="updated" className="bg-[#14171d] text-white">آخر تحديث</option>
                  <option value="name" className="bg-[#14171d] text-white">اسم المنتج (أ - ي)</option>
                  <option value="price_asc" className="bg-[#14171d] text-white">سعر الشراء: الأقل للأعلى</option>
                  <option value="price_desc" className="bg-[#14171d] text-white">سعر الشراء: الأعلى للأقل</option>
                </select>
              </div>
            </div>
          </div>

          {/* Bulk Actions Bar (Shown when rows are selected) */}
          {selectedOfferIds.size > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs shadow-sm">
              <div className="flex items-center gap-2 font-bold text-white">
                <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-black text-[11px] font-mono">
                  {selectedOfferIds.size}
                </span>
                <span>أصناف محددة</span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="md"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-8 text-xs"
                  loading={bulkPending}
                  onClick={() => handleBulkSetAvailability(true)}
                >
                  <Check className="size-3 me-1" />
                  تأكيد توفر المحددة
                </Button>
                <Button
                  size="md"
                  variant="secondary"
                  className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 font-bold h-8 text-xs"
                  loading={bulkPending}
                  onClick={() => handleBulkSetAvailability(false)}
                >
                  <X className="size-3 me-1" />
                  تعطيل توفر المحددة
                </Button>
                <button
                  type="button"
                  onClick={() => setSelectedOfferIds(new Set())}
                  className="text-bw-ink-subtle hover:text-white px-2 py-1 text-xs"
                >
                  إلغاء التحديد
                </button>
              </div>
            </div>
          ) : null}

          {bulkError ? <CommandError error={bulkError} /> : null}
        </div>

        {/* Content Section: Loading, Error, Table / Cards */}
        {offersApi.error ? (
          <LoadError message={offersApi.error.message} onRetry={offersApi.reload} />
        ) : null}

        {offersApi.loading && !offersApi.data ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>
        ) : null}

        {!offersApi.loading && filteredAndSortedOffers.length === 0 ? (
          <StateBlock
            kind="empty"
            title="لا توجد أصناف مطابقة"
            body={
              searchQuery.trim()
                ? 'لم يتم العثور على أي منتج يطابق معايير البحث. جرب كلمات بحث أخرى أو ابحث بالباركود.'
                : 'لم تقم بتسجيل أي عروض أسعار بعد. يمكنك رفع ملف الأسعار لتسجيل أصنافك دفعة واحدة.'
            }
            action={
              searchQuery.trim() ? (
                <Button size="md" variant="secondary" onClick={() => setSearchQuery('')}>
                  مسح البحث
                </Button>
              ) : (
                <Link
                  href="/supplier/updates"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#34d27b] px-4 text-xs font-bold text-black hover:bg-[#2eb96c]"
                >
                  <FileSpreadsheet className="size-3.5" />
                  <span>رفع أول ملف أسعار</span>
                </Link>
              )
            }
          />
        ) : null}

        {/* Scalable Desktop Table (>= 768px) */}
        {paginatedOffers.length > 0 ? (
          <>
            <div className="hidden md:block overflow-hidden rounded-2xl border border-white/[0.08] bg-bw-surface shadow-md">
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.08] bg-black/40 text-bw-ink-subtle font-semibold text-[11px]">
                      <th className="py-3 px-3 text-center w-10">
                        <input
                          type="checkbox"
                          checked={
                            paginatedOffers.length > 0 &&
                            paginatedOffers.every((o) => selectedOfferIds.has(o.id))
                          }
                          onChange={handleSelectAllCurrentPage}
                          className="rounded border-white/20 bg-bw-surface text-emerald-500 focus:ring-0 cursor-pointer"
                        />
                      </th>
                      <th className="py-3 px-4 text-start">المنتج ورمز الصنف (SKU)</th>
                      <th className="py-3 px-4 text-end w-36">سعر الشراء الصافي</th>
                      <th className="py-3 px-4 text-center w-36">حالة التوفر</th>
                      <th className="py-3 px-4 text-start w-32">آخر تحديث</th>
                      <th className="py-3 px-4 text-center w-28">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {paginatedOffers.map((offer) => {
                      const isSelected = selectedOfferIds.has(offer.id)
                      const displaySku = offer.skuCode || shortId(offer.skuId)

                      return (
                        <tr
                          key={offer.id}
                          className={`hover:bg-white/[0.02] transition-colors ${
                            isSelected ? 'bg-emerald-500/[0.04]' : ''
                          }`}
                        >
                          {/* Row Checkbox */}
                          <td className="py-3 px-3 text-center align-middle">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectOffer(offer.id)}
                              className="rounded border-white/20 bg-bw-surface text-emerald-500 focus:ring-0 cursor-pointer"
                            />
                          </td>

                          {/* Primary Cell: Product Name + SKU + Variant + Barcode */}
                          <td className="py-3 px-4">
                            <div className="flex items-start gap-3">
                              {offer.imageUrl ? (
                                <img
                                  src={offer.imageUrl}
                                  alt=""
                                  className="size-11 rounded-xl object-cover border border-white/[0.08] shrink-0 mt-0.5 shadow-xs"
                                />
                              ) : (
                                <div className="flex size-11 items-center justify-center rounded-xl border border-white/[0.08] bg-black/40 text-bw-ink-subtle shrink-0 mt-0.5">
                                  <Package className="size-5 text-bw-ink-subtle" />
                                </div>
                              )}
                              <div className="min-w-0 space-y-1">
                                {/* Line 1: Brand Badge + Product Name */}
                                <div className="flex flex-wrap items-center gap-1.5 leading-snug">
                                  {offer.brandName ? (
                                    <span className="inline-flex items-center rounded-md bg-emerald-500/15 border border-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 shrink-0">
                                      {offer.brandName}
                                    </span>
                                  ) : null}
                                  <span className="font-bold text-white text-xs leading-snug break-words" title={offer.productName}>
                                    {offer.productName}
                                  </span>
                                </div>

                                {/* Line 2: Prominent Monospace SKU Badge + Variant/Size */}
                                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                  <span className="inline-flex items-center gap-1 rounded-md bg-black/50 border border-white/[0.12] px-2 py-0.5 font-mono text-[11px] font-semibold text-bw-ink tracking-wide shadow-xs">
                                    <span className="text-bw-ink-subtle text-[9px] font-sans">SKU:</span>
                                    <span className="text-emerald-400 font-bold">{displaySku}</span>
                                  </span>

                                  {offer.variantName || offer.size ? (
                                    <span className="text-[11px] text-bw-ink-soft font-medium">
                                      {offer.variantName} {offer.size ? `(${offer.size} ${offer.sizeUnit ?? ''})` : ''}
                                    </span>
                                  ) : null}
                                </div>

                                {/* Line 3: Optional Barcode */}
                                {offer.barcode ? (
                                  <div className="flex items-center gap-1.5 text-[10px] text-bw-ink-subtle font-mono">
                                    <Tag className="size-3 text-bw-ink-subtle" />
                                    <span>باركود: {offer.barcode}</span>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>

                          {/* Purchase Price */}
                          <td className="py-3 px-4 text-end align-middle font-mono font-bold text-white whitespace-nowrap text-sm">
                            <span className="text-emerald-300">
                              <Egp value={offer.costPrice} />
                            </span>
                          </td>

                          {/* Availability Toggle */}
                          <td className="py-3 px-4 text-center align-middle whitespace-nowrap">
                            <InlineAvailabilityToggle
                              offer={offer}
                              onSuccess={offersApi.reload}
                            />
                          </td>

                          {/* Last Updated */}
                          <td className="py-3 px-4 text-start align-middle text-bw-ink-soft whitespace-nowrap text-[11px] font-mono">
                            {formatDateTime(offer.lastObservedAt ?? offer.updatedAt)}
                          </td>

                          {/* Actions: Edit Modal */}
                          <td className="py-3 px-4 text-center align-middle whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setEditingOffer(offer)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/[0.08] hover:border-emerald-500/30 transition-all shadow-xs"
                            >
                              <Edit2 className="size-3 text-emerald-400" />
                              <span>تعديل</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Cards View (< 768px) */}
            <div className="md:hidden space-y-3">
              {paginatedOffers.map((offer) => {
                const isSelected = selectedOfferIds.has(offer.id)
                const displaySku = offer.skuCode || shortId(offer.skuId)

                return (
                  <div
                    key={offer.id}
                    className={`rounded-2xl border p-4 space-y-3 transition-all ${
                      isSelected
                        ? 'border-emerald-500/40 bg-emerald-500/[0.03]'
                        : 'border-white/[0.08] bg-bw-surface'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOffer(offer.id)}
                          className="rounded border-white/20 bg-bw-surface text-emerald-500 focus:ring-0 cursor-pointer mt-1"
                        />
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {offer.brandName ? (
                              <span className="inline-flex items-center rounded-md bg-emerald-500/15 border border-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                                {offer.brandName}
                              </span>
                            ) : null}
                            <p className="font-bold text-white text-sm leading-snug">
                              {offer.productName}
                            </p>
                          </div>

                          {/* Distinct Mobile SKU Badge */}
                          <div className="inline-flex items-center gap-1 rounded-md bg-black/50 border border-white/[0.1] px-1.5 py-0.5 font-mono text-[10px] text-bw-ink">
                            <span className="text-bw-ink-subtle text-[9px]">SKU:</span>
                            <span className="text-emerald-400 font-bold">{displaySku}</span>
                          </div>
                        </div>
                      </div>
                      <span className="font-mono font-bold text-emerald-300 text-sm shrink-0">
                        <Egp value={offer.costPrice} />
                      </span>
                    </div>

                    <div className="rounded-xl border border-white/[0.06] bg-black/20 p-2.5 space-y-1 text-xs">
                      <div className="flex items-center justify-between text-bw-ink-subtle">
                        <span>
                          {offer.variantName} {offer.size ? `(${offer.size} ${offer.sizeUnit ?? ''})` : ''}
                        </span>
                        {offer.barcode ? (
                          <span className="font-mono text-[10px]">
                            باركود: {offer.barcode}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-bw-ink-subtle pt-1 border-t border-white/[0.04]">
                        <span>تحديث: {formatDateTime(offer.lastObservedAt ?? offer.updatedAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <InlineAvailabilityToggle
                        offer={offer}
                        onSuccess={offersApi.reload}
                      />
                      <button
                        type="button"
                        onClick={() => setEditingOffer(offer)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/[0.08] transition-all"
                      >
                        <Edit2 className="size-3 text-emerald-400" />
                        <span>تعديل السعر</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination Toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-bw-ink-subtle pt-2">
              <div className="flex items-center gap-2">
                <span>عرض</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-lg border border-white/[0.08] bg-bw-surface px-2 py-1 text-xs text-white focus:outline-none cursor-pointer font-mono"
                >
                  <option value={25} className="bg-[#14171d]">25</option>
                  <option value={50} className="bg-[#14171d]">50</option>
                  <option value={100} className="bg-[#14171d]">100</option>
                </select>
                <span>صنف لكل صفحة · إجمالي {totalItems} صنف</span>
              </div>

              <div className="flex items-center gap-1.5 font-mono">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-white/[0.08] bg-bw-surface text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.04]"
                >
                  <ChevronRight className="size-4" />
                </button>
                <span className="px-2 font-bold text-white">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-white/[0.08] bg-bw-surface text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.04]"
                >
                  <ChevronLeft className="size-4" />
                </button>
              </div>
            </div>
          </>
        ) : null}

        {/* Edit Price & Availability Modal Dialog */}
        {editingOffer ? (
          <EditOfferModal
            offer={editingOffer}
            onClose={() => setEditingOffer(null)}
            onSuccess={() => {
              setEditingOffer(null)
              offersApi.reload()
            }}
          />
        ) : null}
      </div>
  )
}

function InlineAvailabilityToggle({
  offer,
  onSuccess,
}: {
  offer: SupplierOffer
  onSuccess: () => void
}) {
  const toggle = useCommand(() =>
    api(`/sourcing/offers/${offer.id}/confirm-availability`, {
      method: 'POST',
      body: { isAvailable: !offer.isAvailable },
    })
  )

  const handleToggle = async () => {
    const res = await toggle.execute()
    if (res) onSuccess()
  }

  return (
    <button
      type="button"
      disabled={toggle.pending}
      onClick={handleToggle}
      className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold transition-all shadow-xs ${
        offer.isAvailable
          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
          : 'border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20'
      }`}
    >
      {toggle.pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : offer.isAvailable ? (
        <>
          <CheckCircle2 className="size-3 text-emerald-400" />
          <span>متوفر للطلب</span>
        </>
      ) : (
        <>
          <XCircle className="size-3 text-red-400" />
          <span>غير متوفر</span>
        </>
      )}
    </button>
  )
}

function EditOfferModal({
  offer,
  onClose,
  onSuccess,
}: {
  offer: EnrichedOffer
  onClose: () => void
  onSuccess: () => void
}) {
  const [costPrice, setCostPrice] = React.useState(String(offer.costPrice))
  const [isAvailable, setIsAvailable] = React.useState(offer.isAvailable)
  const [quantity, setQuantity] = React.useState(offer.availableQuantity === null || offer.availableQuantity === undefined ? '' : String(offer.availableQuantity))

  // Blank = no quantity reported (yes/no availability only). A number caps what ShinaCare can order from this offer.
  const quantityText = quantity.trim()
  const isValidQuantity = quantityText === '' || (/^\d+$/.test(quantityText) && Number(quantityText) <= 1_000_000)

  const save = useCommand(() =>
    api(`/sourcing/offers/${offer.id}`, {
      method: 'PATCH',
      body: {
        costPrice: Number(costPrice),
        isAvailable,
        ...(quantityText === '' ? {} : { availableQuantity: Number(quantityText) }),
      },
    })
  )

  const isValidPrice = Number(costPrice) > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidPrice || !isValidQuantity) return
    const res = await save.execute()
    if (res) onSuccess()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#14171d] p-5 sm:p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <h3 className="font-bold text-white text-sm sm:text-base">تعديل سعر وتوفر الصنف</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-bw-ink-subtle hover:text-white"
          >
            <X className="size-4.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-white/[0.06] bg-black/30 p-3 space-y-1 text-xs">
            <p className="font-bold text-white text-sm">{offer.productName}</p>
            {offer.brandName ? <p className="text-emerald-400 font-medium">{offer.brandName}</p> : null}
            <div className="flex items-center gap-2 text-[10px] text-bw-ink-subtle pt-1 font-mono">
              {offer.skuCode ? <span>كود: {offer.skuCode}</span> : null}
              {offer.barcode ? <span>· باركود: {offer.barcode}</span> : null}
            </div>
          </div>

          <Field
            label="سعر الشراء المعتمد للمورد (ج.م)"
            ltr
            inputMode="decimal"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
            error={!isValidPrice ? 'يرجى إدخال سعر توريد صحيح أكبر من صفر' : undefined}
          />
          <p className="text-[11px] text-bw-ink-subtle -mt-2">
            هذا هو سعر الشراء الصافي المتفق عليه لتوريد المنتج لشيناكير.
          </p>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-bw-ink">حالة التوفر الحالية بالمستودع:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsAvailable(true)}
                className={`h-10 rounded-xl border text-xs font-bold transition-all ${
                  isAvailable
                    ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                    : 'border-white/[0.08] bg-bw-surface text-bw-ink-soft hover:border-white/20'
                }`}
              >
                متوفر للطلب
              </button>
              <button
                type="button"
                onClick={() => setIsAvailable(false)}
                className={`h-10 rounded-xl border text-xs font-bold transition-all ${
                  !isAvailable
                    ? 'border-red-500 bg-red-500/20 text-red-300'
                    : 'border-white/[0.08] bg-bw-surface text-bw-ink-soft hover:border-white/20'
                }`}
              >
                غير متوفر / نافد
              </button>
            </div>
          </div>

          <Field
            label="الكمية المتاحة عندك دلوقتي (اختياري)"
            ltr
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={!isValidQuantity ? 'اكتب رقم صحيح (٠ أو أكتر)' : undefined}
          />
          <p className="text-[11px] text-bw-ink-subtle -mt-2">
            حدّث الرقم كل ما يتغير. شيناكير مش هتطلب منك أكتر منه، و٠ معناها نفد.
          </p>

          <CommandError error={save.error} />

          <div className="flex gap-2.5 pt-3 border-t border-white/[0.08]">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={onClose}
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-[#34d27b] text-black font-bold hover:bg-[#2eb96c]"
              loading={save.pending}
              disabled={!isValidPrice || !isValidQuantity}
            >
              حفظ التعديل
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
