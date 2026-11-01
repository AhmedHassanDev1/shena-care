'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Eye,
  FileSpreadsheet,
  Package,
  RefreshCw,
  Search,
  Truck,
  Warehouse,
} from 'lucide-react'
import { Button, Code, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Egp, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { PO_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

export interface SupplierPoLine {
  id: string
  skuId: string
  requestedQuantity: number
  confirmedQuantity: number | null
  status: string
  unitCost: number | null
  currency: string | null
  exceptionCode: string | null
  exceptionNote: string | null
  proposedQuantity: number | null
  proposedUnitCost: number | null
  sku: {
    productName: string
    brandName: string | null
    variantName: string
    skuCode: string
    barcode: string | null
    size?: number | null
    sizeUnit?: string | null
    imageUrl?: string | null
  } | null
}

export interface SupplierPo {
  id: string
  status: string
  batchRef: string | null
  notes: string | null
  issuedAt: string | null
  responseDeadlineAt: string | null
  expedited: boolean
  openedAt: string | null
  confirmedAt: string | null
  readyAt: string | null
  receivedAt: string | null
  createdAt: string
  lines: SupplierPoLine[]
}

export const OPEN_STATUSES = ['created', 'sent', 'reviewed']

type FilterTab = 'all' | 'needs_response' | 'confirmed' | 'ready' | 'received'

export default function SupplierOrdersPage() {
  const { data, error, loading, reload } = useApi<{ total: number; items: SupplierPo[] }>(
    '/purchase-orders?take=100',
    { pollMs: 30000 }
  )

  const [activeTab, setActiveTab] = React.useState<FilterTab>('needs_response')
  const [searchQuery, setSearchQuery] = React.useState('')

  const items = data?.items ?? []
  const needsResponseCount = items.filter((po) => OPEN_STATUSES.includes(po.status)).length
  const confirmedCount = items.filter((po) => ['confirmed', 'partial'].includes(po.status)).length
  const readyCount = items.filter((po) => po.status === 'ready').length
  const receivedCount = items.filter((po) => po.status === 'received_at_hub').length

  const filteredItems = React.useMemo(() => {
    return items.filter((po) => {
      // Tab filter
      if (activeTab === 'needs_response' && !OPEN_STATUSES.includes(po.status)) return false
      if (activeTab === 'confirmed' && !['confirmed', 'partial'].includes(po.status)) return false
      if (activeTab === 'ready' && po.status !== 'ready') return false
      if (activeTab === 'received' && po.status !== 'received_at_hub') return false

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const matchesId = po.id.toLowerCase().includes(q) || shortId(po.id).toLowerCase().includes(q)
        const matchesBatch = po.batchRef?.toLowerCase().includes(q)
        const matchesSku = po.lines.some((l) =>
          l.sku?.productName?.toLowerCase().includes(q) ||
          l.sku?.brandName?.toLowerCase().includes(q) ||
          l.sku?.skuCode?.toLowerCase().includes(q) ||
          l.sku?.variantName?.toLowerCase().includes(q) ||
          l.sku?.barcode?.toLowerCase().includes(q)
        )
        if (!matchesId && !matchesBatch && !matchesSku) return false
      }

      return true
    })
  }, [items, activeTab, searchQuery])

  // Aggregate KPI stats
  const totalOpenValue = React.useMemo(() => {
    return items
      .filter((po) => OPEN_STATUSES.includes(po.status))
      .reduce((sum, po) => {
        const poSum = po.lines.reduce((lSum, l) => lSum + (l.unitCost ?? 0) * l.requestedQuantity, 0)
        return sum + poSum
      }, 0)
  }, [items])

  return (
    <RoleShell
      role="supplier"
      active="orders"
      mode="responsive"
      counts={{ orders: needsResponseCount }}
    >
      <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Top Header & Context Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <PageHeader
            title="طلبات شيناكير"
            meta="أوامر الشراء والتوريد الموجهة إليك — استجب بالكميات المتوفرة وسعر الشراء المعتمد"
          />
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => reload()}
              disabled={loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-bw-surface px-3 text-xs font-semibold text-bw-ink-soft hover:bg-white/[0.04] hover:text-white transition-all shadow-xs"
            >
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث البيانات</span>
            </button>
            <Link
              href="/supplier/updates"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all shadow-xs"
            >
              <ArrowUpRight className="size-3.5" />
              <span>تحديث الأسعار والمخزون</span>
            </Link>
          </div>
        </div>

        {/* Operational KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.05] p-3.5 space-y-1 relative overflow-hidden shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                تتطلب الرد الآن
              </span>
              <AlertCircle className="size-4 text-amber-400" />
            </div>
            <p className="font-mono text-2xl font-extrabold text-white">
              {needsResponseCount}
            </p>
            <p className="text-[11px] text-bw-ink-subtle">
              إجمالي القيمة: <span className="font-bold text-amber-300 font-mono"><Egp value={totalOpenValue} /></span>
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-3.5 space-y-1 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-bw-ink-subtle">
                أوامر مؤكدة
              </span>
              <CheckCircle2 className="size-4 text-emerald-400" />
            </div>
            <p className="font-mono text-2xl font-extrabold text-white">
              {confirmedCount}
            </p>
            <p className="text-[11px] text-bw-ink-subtle">
              تم اعتماد الكميات وبانتظار التجهيز
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-3.5 space-y-1 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-bw-ink-subtle">
                جاهزة للتسليم
              </span>
              <Truck className="size-4 text-blue-400" />
            </div>
            <p className="font-mono text-2xl font-extrabold text-white">
              {readyCount}
            </p>
            <p className="text-[11px] text-bw-ink-subtle">
              بضاعة معبأة جاهزة للاستلام بالمقر
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-3.5 space-y-1 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-bw-ink-subtle">
                استلمت بالمخزن
              </span>
              <Warehouse className="size-4 text-purple-400" />
            </div>
            <p className="font-mono text-2xl font-extrabold text-white">
              {receivedCount}
            </p>
            <p className="text-[11px] text-bw-ink-subtle">
              تم الفحص والاستلام بمخزن شيناكير
            </p>
          </div>
        </div>

        {/* Toolbar & Filters */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-bw-surface/60 border border-white/[0.06] p-2 rounded-2xl shadow-xs">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              {(
                [
                  ['needs_response', 'تتطلب الرد', needsResponseCount, 'text-amber-400 border-amber-500/50 bg-amber-500/15 font-bold shadow-xs'],
                  ['all', 'كل الطلبات', items.length, 'border-white/20 bg-white/10 text-white font-bold'],
                  ['confirmed', 'مؤكدة', confirmedCount, 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 font-bold'],
                  ['ready', 'جاهزة للشحن', readyCount, 'border-blue-500/40 bg-blue-500/15 text-blue-300 font-bold'],
                  ['received', 'مستلمة بالمخزن', receivedCount, 'border-purple-500/40 bg-purple-500/15 text-purple-300 font-bold'],
                ] as const
              ).map(([tabId, label, count, activeAccent]) => {
                const isSelected = activeTab === tabId
                return (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setActiveTab(tabId)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs transition-all ${
                      isSelected
                        ? `${activeAccent} border`
                        : 'border border-transparent text-bw-ink-soft hover:bg-white/[0.04] hover:text-white'
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono font-bold ${
                        isSelected ? 'bg-black/30 text-white' : 'bg-white/[0.06] text-bw-ink-subtle'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-72 lg:w-80">
              <Search className="pointer-events-none absolute start-3 top-2.5 size-4 text-bw-ink-subtle" />
              <input
                type="text"
                placeholder="بحث برقم الطلب، المنتج، أو الباركود..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-xl border border-white/[0.08] bg-black/30 pe-3 ps-9 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-[#34d27b] focus:outline-none focus:ring-1 focus:ring-[#34d27b]/30 transition-all shadow-inner"
              />
            </div>
          </div>
        </div>

        {/* Content Section: Loading, Error, Table / Cards */}
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}

        {loading && !data ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        ) : null}

        {/* Operational Empty State */}
        {!loading && filteredItems.length === 0 ? (
          searchQuery.trim() ? (
            <StateBlock
              kind="empty"
              title="لا توجد أوامر توريد مطابقة للبحث"
              body={`لم نجد أي طلب يطابق "${searchQuery}". تأكد من صحة رقم الطلب أو اسم الصنف.`}
              action={
                <Button size="md" variant="secondary" onClick={() => setSearchQuery('')}>
                  مسح البحث والعودة
                </Button>
              }
            />
          ) : activeTab === 'needs_response' ? (
            <div className="rounded-2xl border border-white/[0.08] bg-bw-surface/70 p-6 sm:p-8 space-y-6 text-center shadow-md">
              <div className="flex flex-col items-center max-w-md mx-auto space-y-2">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                  <CheckCircle2 className="size-6" />
                </div>
                <h3 className="font-bold text-white text-base sm:text-lg">
                  لا توجد أوامر توريد تنتظر ردك حالياً
                </h3>
                <p className="text-xs text-bw-ink-soft leading-relaxed">
                  ممتاز! تم الرد على كافة أوامر الشراء الموجهة إليكم ولا توجد أي طلبات معلقة. يتم إصدار أوامر جديدة تلقائياً فور تأكيد طلبات عملاء شيناكير.
                </p>
              </div>

              {/* Operational Guidance Flow */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-start pt-2">
                <div className="rounded-xl border border-white/[0.06] bg-black/30 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-[11px] font-bold">1</span>
                    <span className="font-bold text-xs text-white">إصدار أوامر الشراء</span>
                  </div>
                  <p className="text-[11px] text-bw-ink-subtle leading-relaxed">
                    يتم تجميع وتوجيه الطلبات تلقائياً وفقاً للأسعار والكميات المتاحة المسجلة في كتالوجكم.
                  </p>
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-black/30 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-[11px] font-bold">2</span>
                    <span className="font-bold text-xs text-white">الاستجابة والمهلة</span>
                  </div>
                  <p className="text-[11px] text-bw-ink-subtle leading-relaxed">
                    يُرجى تأكيد الكميات بدقة وسعر الشراء خلال مهلة التوريد المحددة لضمان أولوية التسليم.
                  </p>
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-black/30 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-[11px] font-bold">3</span>
                    <span className="font-bold text-xs text-white">استمرار التوريد</span>
                  </div>
                  <p className="text-[11px] text-bw-ink-subtle leading-relaxed">
                    حافظ على تحديث أسعار الشراء وحالة التوفر بانتظام لضمان ظهور أصنافك كخيار أول في التوزيع.
                  </p>
                </div>
              </div>

              {/* Operational CTAs */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <Link
                  href="/supplier/products"
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#34d27b] px-4 text-xs font-bold text-black hover:bg-[#2eb96c] transition-all shadow-xs"
                >
                  <Package className="size-4" />
                  <span>مراجعة منتجاتي وأسعاري</span>
                </Link>
                <Link
                  href="/supplier/updates"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 text-xs font-semibold text-white hover:bg-white/[0.08] transition-all shadow-xs"
                >
                  <FileSpreadsheet className="size-4 text-emerald-400" />
                  <span>تحديث المخزون عبر Excel</span>
                </Link>
              </div>
            </div>
          ) : (
            <StateBlock
              kind="empty"
              title="لا توجد أوامر توريد في هذا القسم"
              body="لا توجد بيانات متاحة لهذا الفلتر حالياً."
              action={
                <Button size="md" variant="secondary" onClick={() => setActiveTab('all')}>
                  عرض كل أوامر الشراء
                </Button>
              }
            />
          )
        ) : null}

        {/* Desktop & Tablet Table (>= 768px) */}
        {filteredItems.length > 0 ? (
          <>
            <div className="hidden md:block overflow-hidden rounded-2xl border border-white/[0.08] bg-bw-surface shadow-md">
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.08] bg-black/30 text-bw-ink-subtle font-semibold text-[11px]">
                      <th className="py-3 px-4 text-start">رقم أمر الشراء</th>
                      <th className="py-3 px-4 text-start">تاريخ الإصدار</th>
                      <th className="py-3 px-4 text-start">الحالة التشغيلية</th>
                      <th className="py-3 px-4 text-start">ملخص الأصناف المطلوبة</th>
                      <th className="py-3 px-4 text-center">الكمية المطلوبة</th>
                      <th className="py-3 px-4 text-end">إجمالي القيمة</th>
                      <th className="py-3 px-4 text-center">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {filteredItems.map((po) => {
                      const isActionRequired = OPEN_STATUSES.includes(po.status)
                      const totalUnits = po.lines.reduce((s, l) => s + l.requestedQuantity, 0)
                      const totalConfirmedUnits = po.lines.reduce((s, l) => s + (l.confirmedQuantity ?? 0), 0)
                      const totalCost = po.lines.reduce((s, l) => s + (l.unitCost ?? 0) * l.requestedQuantity, 0)
                      const sampleProducts = po.lines
                        .slice(0, 2)
                        .map((l) => l.sku?.productName || shortId(l.skuId))
                        .join(' · ')
                      const remainingCount = po.lines.length - 2

                      return (
                        <tr
                          key={po.id}
                          className={`hover:bg-white/[0.02] transition-colors ${
                            isActionRequired ? 'bg-amber-500/[0.02]' : ''
                          }`}
                        >
                          {/* PO ID & Batch */}
                          <td className="py-3.5 px-4 font-mono font-bold text-white whitespace-nowrap">
                            <div className="space-y-0.5">
                              <span className="text-white hover:text-[#34d27b] transition-colors">
                                #{shortId(po.id)}
                              </span>
                              {po.batchRef ? (
                                <p className="text-[10px] text-bw-ink-subtle font-sans">
                                  دفعة: <Code className="text-[10px]">{po.batchRef}</Code>
                                </p>
                              ) : null}
                            </div>
                          </td>

                          {/* Issue Date */}
                          <td className="py-3.5 px-4 text-bw-ink-soft whitespace-nowrap">
                            <div className="flex items-center gap-1.5 text-[11px]">
                              <Clock className="size-3.5 text-bw-ink-subtle shrink-0" />
                              <span className="font-mono">{formatDateTime(po.issuedAt ?? po.createdAt)}</span>
                            </div>
                          </td>

                          {/* Status Badge */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <Status map={PO_STATUS} value={po.status} />
                          </td>

                          {/* Product Summary */}
                          <td className="py-3.5 px-4 max-w-xs">
                            <div className="space-y-0.5">
                              <p className="font-medium text-white truncate text-xs" title={sampleProducts}>
                                {sampleProducts}
                                {remainingCount > 0 ? (
                                  <span className="text-bw-ink-subtle ms-1 font-mono text-[10px]">
                                    (+{remainingCount} أخرى)
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-[10px] text-bw-ink-subtle">
                                {po.lines.length} بند
                              </p>
                            </div>
                          </td>

                          {/* Quantity */}
                          <td className="py-3.5 px-4 text-center font-mono whitespace-nowrap">
                            {['confirmed', 'partial', 'ready', 'received_at_hub'].includes(po.status) ? (
                              <div className="space-y-0.5">
                                <span className="font-bold text-emerald-300">{totalConfirmedUnits}</span>
                                <span className="text-bw-ink-subtle text-[10px]"> / {totalUnits} قط</span>
                              </div>
                            ) : (
                              <span className="font-bold text-white">{totalUnits} قط</span>
                            )}
                          </td>

                          {/* Total Purchase Value */}
                          <td className="py-3.5 px-4 text-end font-mono font-bold text-white whitespace-nowrap">
                            <Egp value={totalCost} />
                          </td>

                          {/* Action Button */}
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            <Link
                              href={`/supplier/orders/${po.id}`}
                              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all shadow-xs ${
                                isActionRequired
                                  ? 'bg-[#34d27b] text-black hover:bg-[#2eb96c] shadow-[0_2px_10px_rgba(52,210,123,0.3)]'
                                  : 'border border-white/[0.1] bg-white/[0.04] text-white hover:bg-white/[0.08]'
                              }`}
                            >
                              {isActionRequired ? (
                                <>
                                  <AlertCircle className="size-3.5" />
                                  <span>رد فوري</span>
                                </>
                              ) : (
                                <>
                                  <Eye className="size-3.5" />
                                  <span>تفاصيل</span>
                                </>
                              )}
                            </Link>
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
              {filteredItems.map((po) => {
                const isActionRequired = OPEN_STATUSES.includes(po.status)
                const totalUnits = po.lines.reduce((s, l) => s + l.requestedQuantity, 0)
                const totalCost = po.lines.reduce((s, l) => s + (l.unitCost ?? 0) * l.requestedQuantity, 0)
                const firstProduct = po.lines[0]?.sku?.productName || 'بند غير مسمى'
                const moreCount = po.lines.length - 1

                return (
                  <div
                    key={po.id}
                    className={`rounded-2xl border p-4 space-y-3 transition-all ${
                      isActionRequired
                        ? 'border-amber-500/40 bg-amber-500/[0.03] shadow-[0_4px_16px_rgba(245,158,11,0.08)]'
                        : 'border-white/[0.08] bg-bw-surface'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="font-mono font-bold text-white text-sm">
                          #{shortId(po.id)}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px] text-bw-ink-subtle">
                          <Clock className="size-3" />
                          <span className="font-mono">{formatDateTime(po.issuedAt ?? po.createdAt)}</span>
                        </div>
                      </div>
                      <Status map={PO_STATUS} value={po.status} />
                    </div>

                    <div className="rounded-xl border border-white/[0.06] bg-black/20 p-2.5 space-y-1">
                      <p className="font-medium text-white text-xs truncate">
                        {firstProduct}
                        {moreCount > 0 ? (
                          <span className="text-bw-ink-subtle ms-1 font-mono text-[10px]">
                            (+{moreCount} أصناف أخرى)
                          </span>
                        ) : null}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-bw-ink-subtle pt-1 border-t border-white/[0.04]">
                        <span>الكمية المطلوبة: <b className="text-white font-mono">{totalUnits}</b> قطعة</span>
                        <span>القيمة: <b className="text-emerald-300 font-mono"><Egp value={totalCost} /></b></span>
                      </div>
                    </div>

                    <Link
                      href={`/supplier/orders/${po.id}`}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all ${
                        isActionRequired
                          ? 'bg-[#34d27b] text-black shadow-[0_2px_12px_rgba(52,210,123,0.3)]'
                          : 'border border-white/[0.1] bg-white/[0.04] text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {isActionRequired ? (
                        <>
                          <AlertCircle className="size-3.5" />
                          <span>الرد على أمر الشراء</span>
                        </>
                      ) : (
                        <>
                          <Eye className="size-3.5" />
                          <span>عرض تفاصيل ومراحل الطلب</span>
                        </>
                      )}
                    </Link>
                  </div>
                )
              })}
            </div>
          </>
        ) : null}
      </div>
    </RoleShell>
  )
}
