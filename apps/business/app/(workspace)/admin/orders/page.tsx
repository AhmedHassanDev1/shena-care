'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Filter,
  MapPin,
  MapPinOff,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Truck,
  User,
  Wallet,
  X,
} from 'lucide-react'
import { Code, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { ORDER_STATUS, formatDateTime } from '@/lib/labels'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

interface OrderRow {
  id: string
  orderNumber: string
  status: string
  customerName: string
  customerPhone?: string
  governorate: string | null
  area: string | null
  paymentMethod: string
  totalAmount: number
  codAmount: number | null
  itemCount: number
  hasPin: boolean
  createdAt: string
}

const PAGE_SIZE = 25

export default function AdminOrders() {
  const [status, setStatus] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [q, setQ] = React.useState('')
  const [paymentFilter, setPaymentFilter] = React.useState<string>('all')
  const [locationFilter, setLocationFilter] = React.useState<string>('all')
  const [pinFilter, setPinFilter] = React.useState<string>('all')
  const [skip, setSkip] = React.useState(0)

  const params = new URLSearchParams({
    take: String(PAGE_SIZE),
    skip: String(skip),
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
  })

  const { data, error, loading, reload } = useApi<{ total: number; items: OrderRow[] }>(
    `/admin/orders?${params}`,
    { pollMs: 30000 }
  )

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSkip(0)
    setQ(query.trim())
  }

  const handleResetFilters = () => {
    setStatus('')
    setQuery('')
    setQ('')
    setPaymentFilter('all')
    setLocationFilter('all')
    setPinFilter('all')
    setSkip(0)
  }

  // Client-side sub-filtering for secondary dimensions (location/pin/payment) if selected
  const items = React.useMemo(() => {
    if (!data?.items) return []
    return data.items.filter((item) => {
      if (paymentFilter !== 'all') {
        const isCod = item.paymentMethod?.toLowerCase().includes('cod') || item.paymentMethod === 'نقد عند الاستلام'
        if (paymentFilter === 'cod' && !isCod) return false
        if (paymentFilter === 'electronic' && isCod) return false
      }
      if (locationFilter !== 'all') {
        const gov = item.governorate?.toLowerCase() || ''
        const area = item.area?.toLowerCase() || ''
        if (locationFilter === 'cairo' && !gov.includes('قاهر') && !area.includes('قاهر') && !area.includes('معادي') && !area.includes('تجمع')) return false
        if (locationFilter === 'giza' && !gov.includes('جيز') && !area.includes('جيز') && !area.includes('دقي') && !area.includes('أكتوبر')) return false
      }
      if (pinFilter !== 'all') {
        if (pinFilter === 'with_pin' && !item.hasPin) return false
        if (pinFilter === 'no_pin' && item.hasPin) return false
      }
      return true
    })
  }, [data?.items, paymentFilter, locationFilter, pinFilter])

  // Count summaries from returned data
  const totalOrders = data?.total ?? 0

  return (
    <RoleShell role="admin" active="orders" mode="desktop">
      <Page>
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="sc-badge t-success flex items-center gap-1.5">
                <ShoppingBag className="size-3.5" />
                سجل طلبات العملاء المركزي
              </span>
              <span className="text-xs text-bw-ink-soft">
                تحديث لحظي لكافة طلبات القاهرة والجيزة
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
              إدارة الطلبات
              {data && (
                <span className="sc-badge font-mono text-sm bg-white/[0.06] text-emerald-400 border-white/10">
                  {totalOrders} طلب إجمالي
                </span>
              )}
            </h1>
            <p className="text-xs text-bw-ink-soft mt-1 leading-relaxed max-w-3xl">
              استعراض ومتابعة رحلة طلبات العملاء من التأكيد الأولي، التوريد من الصيدليات والمستودعات، التجهيز في مخزن المعادي، وحتى التسليم النهائي والتحصيل.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => reload()}
              disabled={loading}
              className="sc-btn md secondary flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className={cn('size-4 text-emerald-400', loading && 'animate-spin')} />
              <span>تحديث البيانات</span>
            </button>
          </div>
        </div>

        {/* Status Pipeline Fast Filters */}
        <div className="flex flex-wrap items-center gap-1.5 py-1">
          {[
            { id: '', label: 'كافة الطلبات' },
            { id: 'PLACED', label: 'بانتظار التوريد' },
            { id: 'SOURCING', label: 'جاري التوريد' },
            { id: 'PREPARING', label: 'في مخزن المعادي' },
            { id: 'DISPATCHED', label: 'خرجت للتوصيل' },
            { id: 'DELIVERED', label: 'تم التسليم' },
            { id: 'CANCELLED', label: 'ملغاة / مسترجعة' },
          ].map((tab) => {
            const active = status === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatus(tab.id)
                  setSkip(0)
                }}
                className={cn(
                  'px-3.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-colors border',
                  active
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'text-bw-ink-soft border-transparent hover:text-white hover:bg-white/[0.04]'
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Filter & Search Bar */}
        <div className="sc-card p-4 space-y-3 border-white/[0.08] bg-bw-surface">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col md:flex-row items-stretch md:items-center gap-3"
          >
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 size-4 text-bw-ink-muted" />
              <input
                id="order-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="البحث برقم الطلب (مثال: 1042)، اسم العميل، أو رقم الهاتف..."
                className="w-full pl-3 pr-10 py-2.5 text-xs rounded-xl bg-black/40 border border-white/[0.08] text-white placeholder-bw-ink-muted focus:outline-none focus:border-emerald-500 transition-colors"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setQ('')
                    setSkip(0)
                  }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-bw-ink-muted hover:text-white"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Payment Method Selector */}
            <div className="w-full md:w-44">
              <select
                aria-label="طريقة الدفع"
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="w-full py-2.5 px-3 text-xs rounded-xl bg-black/40 border border-white/[0.08] text-white focus:outline-none focus:border-emerald-500 transition-colors"
              >
                <option value="all">كافة طرق الدفع</option>
                <option value="cod">دفع عند الاستلام (COD)</option>
                <option value="electronic">دفع إلكتروني / بطاقة</option>
              </select>
            </div>

            {/* Zone Selector */}
            <div className="w-full md:w-36">
              <select
                aria-label="النطاق الجغرافي"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="w-full py-2.5 px-3 text-xs rounded-xl bg-black/40 border border-white/[0.08] text-white focus:outline-none focus:border-emerald-500 transition-colors"
              >
                <option value="all">كافة المناطق</option>
                <option value="cairo">القاهرة</option>
                <option value="giza">الجيزة</option>
              </select>
            </div>

            {/* GPS Pin Selector */}
            <div className="w-full md:w-36">
              <select
                aria-label="تحديد العنوان الجغرافي"
                value={pinFilter}
                onChange={(e) => setPinFilter(e.target.value)}
                className="w-full py-2.5 px-3 text-xs rounded-xl bg-black/40 border border-white/[0.08] text-white focus:outline-none focus:border-emerald-500 transition-colors"
              >
                <option value="all">كل العناوين</option>
                <option value="with_pin">مثبت بدبوس GPS</option>
                <option value="no_pin">بدون دبوس</option>
              </select>
            </div>

            <button
              type="submit"
              className="sc-btn md primary shrink-0 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Filter className="size-3.5" />
              <span>تطبيق</span>
            </button>

            {(status || q || paymentFilter !== 'all' || locationFilter !== 'all' || pinFilter !== 'all') && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="sc-btn md ghost shrink-0 text-bw-ink-soft hover:text-white"
                title="إعادة تعيين الفلاتر"
              >
                <X className="size-4" />
                <span className="hidden lg:inline text-xs">مسح الفلاتر</span>
              </button>
            )}
          </form>
        </div>

        {/* Load Error Handling */}
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}

        {/* Loading Skeleton */}
        {!data && loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : null}

        {/* Empty State */}
        {data && items.length === 0 ? (
          <div className="sc-card p-12 text-center border-white/[0.08] bg-bw-surface space-y-3">
            <ShoppingBag className="size-10 text-bw-ink-muted mx-auto" />
            <h3 className="text-base font-bold text-white">لم يتم العثور على طلبات مطابقة</h3>
            <p className="text-xs text-bw-ink-soft max-w-md mx-auto">
              جرب تغيير معايير البحث أو تصفية الحالات لاستعراض طلبات أخرى في النظام.
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="sc-btn sm secondary inline-flex items-center gap-1.5 mt-2"
            >
              مسح الفلاتر وإعادة المحاولة
            </button>
          </div>
        ) : null}

        {/* Orders Table */}
        {data && items.length > 0 ? (
          <div className="sc-card overflow-hidden border-white/[0.08] bg-bw-surface shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-black/20 text-bw-ink-soft font-semibold">
                    <th className="py-3 px-4">رقم الطلب</th>
                    <th className="py-3 px-4">العميل والموقع</th>
                    <th className="py-3 px-4">الحالة التشغيلية</th>
                    <th className="py-3 px-4">المبلغ والدفع</th>
                    <th className="py-3 px-4">الأصناف</th>
                    <th className="py-3 px-4">توقيت الطلب</th>
                    <th className="py-3 px-4 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {items.map((order) => {
                    const isCod =
                      order.paymentMethod?.toLowerCase().includes('cod') ||
                      order.paymentMethod === 'نقد عند الاستلام'

                    return (
                      <tr
                        key={order.id}
                        className="hover:bg-white/[0.02] transition-colors group"
                      >
                        {/* Order Number */}
                        <td className="py-3.5 px-4 font-mono">
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="font-bold text-emerald-400 group-hover:underline flex items-center gap-1.5"
                          >
                            <span>#{order.orderNumber}</span>
                            <ExternalLink className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </Link>
                        </td>

                        {/* Customer & Location */}
                        <td className="py-3.5 px-4">
                          <div className="space-y-1">
                            <div className="font-semibold text-white flex items-center gap-1.5">
                              <span className="size-5 rounded-full bg-white/[0.08] flex items-center justify-center text-[10px] text-bw-ink-soft">
                                {order.customerName.charAt(0) || 'ع'}
                              </span>
                              <span>{order.customerName}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-bw-ink-soft">
                              {order.hasPin ? (
                                <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                                  <MapPin className="size-3 shrink-0" />
                                  <span>{[order.area, order.governorate].filter(Boolean).join('، ') || 'القاهرة'}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-400/90 font-medium">
                                  <MapPinOff className="size-3 shrink-0" />
                                  <span>{[order.area, order.governorate].filter(Boolean).join('، ') || 'بدون إحداثيات GPS'}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4">
                          <Status map={ORDER_STATUS} value={order.status} />
                        </td>

                        {/* Payment & Amount */}
                        <td className="py-3.5 px-4">
                          <div className="space-y-0.5">
                            <div className="font-bold font-mono text-white text-sm">
                              <Egp value={order.codAmount ?? order.totalAmount} />
                            </div>
                            <div className="flex items-center gap-1 text-[10px]">
                              {isCod ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-[#f5a524] border border-amber-500/20">
                                  <Wallet className="size-2.5" />
                                  تحصيل عند الاستلام
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  <CreditCard className="size-2.5" />
                                  مدفوع إلكترونياً
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Item Count */}
                        <td className="py-3.5 px-4">
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/[0.05] text-white font-mono text-xs">
                            <Package className="size-3 text-bw-ink-soft" />
                            <span>{order.itemCount} قطع</span>
                          </div>
                        </td>

                        {/* Time */}
                        <td className="py-3.5 px-4 text-bw-ink-soft text-[11px]">
                          <div className="flex items-center gap-1">
                            <Clock className="size-3 text-bw-ink-muted" />
                            <span>{formatDateTime(order.createdAt)}</span>
                          </div>
                        </td>

                        {/* Detail Link */}
                        <td className="py-3.5 px-4 text-center">
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="sc-btn sm secondary inline-flex items-center gap-1.5 text-[11px] py-1 px-2.5"
                          >
                            <span>التفاصيل</span>
                            <ArrowLeft className="size-3" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between p-4 border-t border-white/[0.08] bg-black/20 text-xs">
              <button
                type="button"
                disabled={skip === 0}
                onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
                className="sc-btn sm secondary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                السابق
              </button>

              <span className="text-bw-ink-soft font-mono">
                {skip + 1}–{Math.min(skip + PAGE_SIZE, totalOrders)} من أصل {totalOrders} طلب
              </span>

              <button
                type="button"
                disabled={skip + PAGE_SIZE >= totalOrders}
                onClick={() => setSkip(skip + PAGE_SIZE)}
                className="sc-btn sm secondary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                التالي
              </button>
            </div>
          </div>
        ) : null}
      </Page>
    </RoleShell>
  )
}
