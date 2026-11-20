'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, MapPinOff, RefreshCw } from 'lucide-react'
import { Button, Code, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Segmented, SearchField, Toolbar } from '@/components/bw/ops'
import { Egp, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { ORDER_STATUS } from '@/lib/labels'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type OrderRow = {
  id: string; orderNumber: string; status: string; customerName: string
  governorate: string | null; area: string | null; totalAmount: number
  itemCount: number; hasPin: boolean; createdAt: string
}
const PAGE_SIZE = 25

// Primary semantic buckets for quick operational scanning
const GROUP_FILTERS = [
  { value: '', label: 'الكل' },
  { value: 'active', label: 'طلبات جارية' },
  { value: 'shipped', label: 'مع المندوب' },
  { value: 'delivered', label: 'مكتملة' },
  { value: 'terminal', label: 'ملغاة ومرتجعة' },
]

// Granular statuses supported by backend API
const GRANULAR_STATUSES = [
  { value: 'placed', label: 'بانتظار التوفير (placed)' },
  { value: 'confirmed', label: 'تأكد التوفر (confirmed)' },
  { value: 'packing', label: 'في المخزن (packing)' },
  { value: 'shipped', label: 'مع المندوب (shipped)' },
  { value: 'delivered', label: 'مكتملة (delivered)' },
  { value: 'cancelled', label: 'ملغاة (cancelled)' },
  { value: 'returned', label: 'مرتجعة (returned)' },
]
const CLOSED = ['delivered', 'cancelled', 'returned']
const ALL_VALID_STATUSES = new Set([...GROUP_FILTERS.map((f) => f.value), ...GRANULAR_STATUSES.map((f) => f.value)].filter(Boolean))

const when = (value: string) => new Date(value).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const COLS = 'md:grid-cols-[minmax(0,1.7fr)_minmax(0,1.3fr)_3rem_6.5rem_minmax(0,1.2fr)_1rem]'

function AdminOrdersContent() {
  const searchParams = useSearchParams()
  const initialStatus = searchParams.get('status') ?? ''
  const [status, setStatus] = React.useState(ALL_VALID_STATUSES.has(initialStatus) ? initialStatus : '')
  const [query, setQuery] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [skip, setSkip] = React.useState(0)

  React.useEffect(() => {
    const paramStatus = searchParams.get('status') ?? ''
    if (paramStatus && ALL_VALID_STATUSES.has(paramStatus)) {
      setStatus(paramStatus)
      setSkip(0)
    }
  }, [searchParams])
  // Typing searches after a short pause; Enter searches at once.
  React.useEffect(() => {
    const id = window.setTimeout(() => { if (query.trim() !== search) { setSearch(query.trim()); setSkip(0) } }, 350)
    return () => window.clearTimeout(id)
  }, [query, search])

  const params = new URLSearchParams({ take: String(PAGE_SIZE), skip: String(skip), ...(status ? { status } : {}), ...(search ? { q: search } : {}) })
  const orders = useApi<{ total: number; missingPinCount?: number; items: OrderRow[] }>(`/admin/orders?${params}`, { pollMs: 30000 })
  const rows = orders.data?.items ?? []
  const total = orders.data?.total ?? 0
  const attention = orders.data?.missingPinCount ?? rows.filter((order) => !order.hasPin && !CLOSED.includes(order.status)).length
  const reset = () => { setStatus(''); setQuery(''); setSearch(''); setSkip(0) }
  const filtered = Boolean(status || search)

  // Map granular status to active group tab if applicable
  const activeGroup = ['placed', 'confirmed', 'packing'].includes(status)
    ? 'active'
    : ['cancelled', 'returned'].includes(status)
      ? 'terminal'
      : status

  return <RoleShell role="admin" active="orders">
    <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <PageHeader
        title="الطلبات"
        meta={orders.data ? <><Code>{total}</Code> {filtered ? 'طلب مطابق' : 'طلب'}{attention > 0 ? <span className="ms-3 inline-flex items-center gap-1.5 text-bw-amber"><MapPinOff className="size-3.5" aria-hidden /><Code>{attention}</Code> بلا موقع مؤكد</span> : null}</> : undefined}
        actions={<Button variant="secondary" size="sm" onClick={orders.reload} loading={orders.loading && !!orders.data}>{!(orders.loading && !!orders.data) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>}
      />

      <Toolbar>
        <SearchField value={query} onChange={setQuery} onSubmit={() => { setSearch(query.trim()); setSkip(0) }} label="بحث في الطلبات" placeholder="رقم الطلب أو العميل أو الهاتف" />
        <Segmented label="حالة الطلب" items={GROUP_FILTERS} value={activeGroup} onChange={(value) => { setStatus(value); setSkip(0) }} className="min-w-0 shrink-0" />
        <select
          aria-label="تصفية دقيقة بالحالة"
          value={GRANULAR_STATUSES.some(g => g.value === status) ? status : ''}
          onChange={(e) => { setStatus(e.target.value); setSkip(0) }}
          className="h-9 shrink-0 rounded-bw-field border border-bw-line bg-bw-surface px-2.5 text-bw-small text-bw-ink-soft transition-colors hover:border-bw-line-focus hover:text-bw-ink"
        >
          <option value="">تصفية دقيقة...</option>
          {GRANULAR_STATUSES.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
        {filtered ? <Button variant="ghost" size="sm" onClick={reset}>مسح</Button> : null}
      </Toolbar>

      <section aria-label="قائمة الطلبات" className="space-y-3">
        {orders.error ? <LoadError message={orders.error.message} onRetry={orders.reload} /> : null}
        {orders.loading && !orders.data ? <div className="space-y-px overflow-hidden rounded-bw-card"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : null}
        {orders.data && rows.length === 0 ? (
          <div className="bw-panel"><StateBlock kind="empty" title="مفيش طلبات مطابقة" body={filtered ? 'غيّر البحث أو الحالة عشان تشوف طلبات تانية.' : 'الطلبات الجديدة هتظهر هنا أول ما العملاء يأكدوها.'} action={filtered ? <Button variant="secondary" size="sm" onClick={reset}>عرض كل الطلبات</Button> : undefined} /></div>
        ) : null}
        {rows.length ? (
          <div className="bw-panel bw-arrive overflow-hidden">
            <div aria-hidden className={cn('hidden gap-4 border-b border-bw-line bg-bw-veil-1 px-4 py-2 text-[11px] font-semibold text-bw-ink-subtle md:grid', COLS)}>
              <span>الطلب</span><span>العميل والعنوان</span><span>أصناف</span><span>المبلغ</span><span>التنبيه والميعاد</span><span />
            </div>
            <ul className="divide-y divide-bw-line">
              {rows.map((order) => {
                const needsLocation = !order.hasPin && !CLOSED.includes(order.status)
                const place = [order.area, order.governorate].filter(Boolean).join('، ')
                return (
                  <li key={order.id}>
                    <Link href={`/admin/orders/${order.id}`} className={cn('bw-row group grid items-center gap-x-4 gap-y-1.5 px-4 py-3 grid-cols-[minmax(0,1fr)_auto]', COLS)}>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                        <strong className="text-bw-small text-bw-ink"><Code>{order.orderNumber.replace(/^ORD-/, '#')}</Code></strong>
                        <Status map={ORDER_STATUS} value={order.status} />
                      </span>
                      <span className="col-span-2 row-start-2 flex min-w-0 items-baseline gap-x-2 md:col-span-1 md:row-start-auto md:block">
                        <span className="block max-w-[55%] shrink-0 truncate text-bw-small font-medium text-bw-ink md:max-w-none"><bdi>{order.customerName}</bdi></span>
                        <span className="block min-w-0 truncate text-[12px] text-bw-ink-soft">{place || 'عنوان غير محدد'}</span>
                      </span>
                      <span className="hidden text-bw-small tabular-nums text-bw-ink-soft md:block"><Code>{order.itemCount}</Code></span>
                      <span className="col-start-2 row-start-1 text-end md:col-start-auto md:row-start-auto md:text-start">
                        <span className="block text-bw-body font-semibold leading-tight text-bw-ink"><Egp value={order.totalAmount} /></span>
                        <span className="block text-[11px] text-bw-ink-subtle md:hidden"><Code>{order.itemCount}</Code> أصناف</span>
                      </span>
                      <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-bw-ink-soft md:col-span-1">
                        {needsLocation ? <StatusLabel tone="danger">بلا موقع مؤكد</StatusLabel> : null}
                        <span className="text-bw-ink-subtle">{when(order.createdAt)}</span>
                      </span>
                      <ChevronLeft className="hidden size-4 text-bw-ink-subtle transition-transform group-hover:-translate-x-0.5 group-hover:text-bw-ink md:block" aria-hidden />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        {orders.data && total > PAGE_SIZE ? (
          <nav aria-label="صفحات الطلبات" className="flex items-center justify-between gap-3 text-bw-small">
            <Button variant="secondary" size="sm" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>السابق</Button>
            <span className="text-bw-ink-soft"><Code>{skip + 1}–{Math.min(skip + PAGE_SIZE, total)}</Code> من <Code>{total}</Code></span>
            <Button variant="secondary" size="sm" disabled={skip + PAGE_SIZE >= total} onClick={() => setSkip(skip + PAGE_SIZE)}>التالي</Button>
          </nav>
        ) : null}
      </section>
    </main>
  </RoleShell>
}

export default function AdminOrders() {
  return (
    <React.Suspense fallback={<div className="p-8 text-bw-small text-bw-ink-subtle">جارٍ التحميل...</div>}>
      <AdminOrdersContent />
    </React.Suspense>
  )
}
