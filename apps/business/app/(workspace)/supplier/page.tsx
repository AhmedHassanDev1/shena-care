'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft, Clock, Eye, Search } from 'lucide-react'
import { Code, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Egp, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { PO_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

export interface SupplierPo {
  id: string
  status: string
  batchRef: string | null
  issuedAt: string | null
  openedAt: string | null
  confirmedAt: string | null
  readyAt: string | null
  receivedAt: string | null
  createdAt: string
  lines: Array<{
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
  }>
}

export const OPEN = ['created', 'sent', 'reviewed']

type FilterTab = 'all' | 'needs_response' | 'confirmed' | 'ready' | 'received'

/** Supplier inbox: consolidated PO inbox with real statuses and useful filters. */
export default function SupplierInbox() {
  const { data, error, loading, reload } = useApi<{ total: number; items: SupplierPo[] }>(
    '/purchase-orders?take=50',
    { pollMs: 30000 }
  )

  const [activeTab, setActiveTab] = React.useState<FilterTab>('all')
  const [searchQuery, setSearchQuery] = React.useState('')

  const items = data?.items ?? []
  const needsResponseCount = items.filter((po) => OPEN.includes(po.status)).length

  const filteredItems = React.useMemo(() => {
    return items.filter((po) => {
      // Tab filter
      if (activeTab === 'needs_response' && !OPEN.includes(po.status)) return false
      if (activeTab === 'confirmed' && !['confirmed', 'partial'].includes(po.status)) return false
      if (activeTab === 'ready' && po.status !== 'ready') return false
      if (activeTab === 'received' && po.status !== 'received_at_hub') return false

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const matchesId = po.id.toLowerCase().includes(q) || shortId(po.id).toLowerCase().includes(q)
        const matchesSku = po.lines.some((l) =>
          l.sku?.productName?.toLowerCase().includes(q) ||
          l.sku?.skuCode?.toLowerCase().includes(q) ||
          l.sku?.variantName?.toLowerCase().includes(q) ||
          l.sku?.barcode?.toLowerCase().includes(q)
        )
        if (!matchesId && !matchesSku) return false
      }

      return true
    })
  }, [items, activeTab, searchQuery])

  return (
    <RoleShell role="supplier" active="pos" mode="mobile" counts={{ pos: needsResponseCount }}>
      <div className="space-y-4 p-4">
        <PageHeader
          title="طلبات شيناكير"
          meta="أوامر الشراء الموجهة إليك — رد على كل أمر بالكمية وسعر الشراء المعتمد"
        />

        {/* Search bar */}
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-3 size-4 text-bw-ink-subtle" />
          <input
            type="text"
            placeholder="بحث برقم الأمر أو كود المنتج أو الباركود..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-bw-surface/90 pe-3 ps-9 text-xs text-bw-ink placeholder:text-bw-ink-subtle transition-all focus:border-[#34d27b] focus:outline-none focus:ring-1 focus:ring-[#34d27b]/30 shadow-inner"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute end-2.5 top-2.5 text-xs text-bw-ink-subtle hover:text-bw-ink"
            >
              مسح
            </button>
          ) : null}
        </div>

        {/* Filter Pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors ${
              activeTab === 'all'
                ? 'bg-bw-ink text-bw-surface font-semibold'
                : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft hover:text-bw-ink'
            }`}
          >
            الكل
            <span className="opacity-75">({items.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('needs_response')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors ${
              activeTab === 'needs_response'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft hover:text-bw-ink'
            }`}
          >
            محتاجة رد
            {needsResponseCount > 0 ? (
              <span className="rounded-full bg-amber-500/30 px-1.5 py-0.2 text-[10px] font-bold text-amber-200">
                {needsResponseCount}
              </span>
            ) : (
              <span className="opacity-75">(0)</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('confirmed')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors ${
              activeTab === 'confirmed'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft hover:text-bw-ink'
            }`}
          >
            مؤكدة
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ready')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors ${
              activeTab === 'ready'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 font-semibold'
                : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft hover:text-bw-ink'
            }`}
          >
            جاهزة للاستلام
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('received')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors ${
              activeTab === 'received'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold'
                : 'border border-white/[0.08] bg-bw-surface text-bw-ink-soft hover:text-bw-ink'
            }`}
          >
            مستلمة بالمخزن
          </button>
        </div>

        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        ) : null}

        {data && items.length === 0 ? (
          <StateBlock
            kind="empty"
            title="مافيش طلبات أوامر شراء"
            body="أوامر الشراء الجديدة الصادرة من شيناكير هتظهر هنا فور تعميدها."
          />
        ) : null}

        {data && items.length > 0 && filteredItems.length === 0 ? (
          <StateBlock
            kind="empty"
            title="لا توجد أوامر مطابقة للفلتر"
            body="جرب اختيار تبويب تاني أو مسح كلمة البحث."
          />
        ) : null}

        <ul className="space-y-3">
          {filteredItems.map((po) => {
            const isUnopened = !po.openedAt && OPEN.includes(po.status)
            const totalRequestedQty = po.lines.reduce((s, l) => s + l.requestedQuantity, 0)
            const totalPurchaseVal = po.lines.reduce((s, l) => s + (l.unitCost ?? 0) * l.requestedQuantity, 0)

            return (
              <li key={po.id}>
                <Link
                  href={`/supplier/po/${po.id}`}
                  className="group relative block rounded-2xl border border-white/[0.08] bg-bw-surface/90 p-4 transition-all duration-200 hover:border-white/[0.18] hover:bg-bw-surface shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bw-display text-sm font-bold text-white tracking-wide">
                          أمر <Code className="text-white font-mono">{shortId(po.id)}</Code>
                        </span>
                        <Status map={PO_STATUS} value={po.status} />
                        {isUnopened ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/35 px-2 py-0.5 text-[10px] font-bold text-emerald-300 animate-pulse">
                            <span className="size-1.5 rounded-full bg-emerald-400" />
                            جديد
                          </span>
                        ) : null}
                      </div>

                      <p className="text-xs text-bw-ink-soft">
                        <Code>{po.lines.length}</Code> أصناف · <Code>{totalRequestedQty}</Code> قطعة · إجمالي تكلفة الشراء <Egp value={totalPurchaseVal} />
                      </p>
                    </div>

                    <div className="flex items-center gap-1 self-center text-bw-ink-subtle group-hover:text-[#34d27b] transition-colors">
                      <ChevronLeft className="size-5" aria-hidden />
                    </div>
                  </div>

                  {/* Summary preview of items */}
                  {po.lines.length > 0 ? (
                    <div className="mt-3 border-t border-white/[0.06] pt-2.5">
                      <div className="space-y-1">
                        {po.lines.slice(0, 2).map((l) => (
                          <div key={l.id} className="flex items-center justify-between text-[11px] text-bw-ink-subtle">
                            <span className="truncate max-w-[200px]">
                              {l.sku?.productName ?? shortId(l.skuId)} {l.sku?.variantName ? `(${l.sku.variantName})` : ''}
                            </span>
                            <span className="font-mono text-bw-ink font-semibold shrink-0">
                              {l.requestedQuantity} قطعة
                            </span>
                          </div>
                        ))}
                        {po.lines.length > 2 ? (
                          <p className="text-[10px] text-bw-ink-subtle pt-0.5">
                            +{po.lines.length - 2} أصناف إضافية
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Operational Footer Details */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2 text-[10px] text-bw-ink-subtle">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3 text-bw-ink-subtle" />
                      {formatDateTime(po.issuedAt ?? po.createdAt)}
                    </span>
                    {po.openedAt ? (
                      <span className="flex items-center gap-1 text-[10px] text-bw-ink-subtle">
                        <Eye className="size-3" />
                        تم الفتح: {formatDateTime(po.openedAt)}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </RoleShell>
  )
}
