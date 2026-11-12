'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, MapPinOff, RefreshCw, Search, ShoppingBag } from 'lucide-react'
import { Button, Code, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Egp, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { ORDER_STATUS, formatDateTime } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

type OrderRow = {
  id: string; orderNumber: string; status: string; customerName: string
  governorate: string | null; area: string | null; totalAmount: number
  itemCount: number; hasPin: boolean; createdAt: string
}
const PAGE_SIZE = 25
// Values are the API's OrderStatus enum (lowercase); the query DTO rejects anything else.
const filters = [
  { value: '', label: 'كل الطلبات' }, { value: 'placed', label: 'بانتظار التوفير' },
  { value: 'confirmed', label: 'تأكد التوفر' }, { value: 'packing', label: 'في المخزن' },
  { value: 'shipped', label: 'مع المندوب' }, { value: 'delivered', label: 'مكتملة' },
  { value: 'cancelled', label: 'ملغاة' }, { value: 'returned', label: 'مرتجعة' },
]
const CLOSED = ['delivered', 'cancelled', 'returned']

const ALLOWED_STATUSES = new Set(filters.map((f) => f.value).filter(Boolean))

function AdminOrdersContent() {
  const searchParams = useSearchParams()
  const initialStatus = searchParams.get('status') ?? ''
  const [status, setStatus] = React.useState(ALLOWED_STATUSES.has(initialStatus) ? initialStatus : '')
  const [query, setQuery] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [skip, setSkip] = React.useState(0)

  React.useEffect(() => {
    const paramStatus = searchParams.get('status') ?? ''
    if (paramStatus && ALLOWED_STATUSES.has(paramStatus)) {
      setStatus(paramStatus)
      setSkip(0)
    }
  }, [searchParams])
  const params = new URLSearchParams({ take: String(PAGE_SIZE), skip: String(skip), ...(status ? { status } : {}), ...(search ? { q: search } : {}) })
  const orders = useApi<{ total: number; items: OrderRow[] }>(`/admin/orders?${params}`, { pollMs: 30000 })
  const rows = orders.data?.items ?? []
  const total = orders.data?.total ?? 0
  const attention = rows.filter((order) => !order.hasPin && !CLOSED.includes(order.status)).length
  const reset = () => { setStatus(''); setQuery(''); setSearch(''); setSkip(0) }

  return <RoleShell role="admin" active="orders">
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:px-8 sm:py-9" dir="rtl">
      <PageHeader eyebrow="مساحة الإدارة / الطلبات" title="الطلبات" meta="ما الذي يحدث الآن، وما الذي يحتاج تدخلًا؟"
        actions={<Button variant="secondary" onClick={orders.reload} loading={orders.loading}><RefreshCw className="size-4" />تحديث</Button>} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-bw-line py-5 text-bw-small">
        <p className="text-bw-ink-soft"><strong className="text-bw-ink"><Code>{total}</Code></strong> طلب مطابق للعرض الحالي</p>
        {attention ? <p className="flex items-center gap-2 text-bw-warn"><MapPinOff className="size-4" /><strong><Code>{attention}</Code></strong> من الطلبات المعروضة بلا موقع مؤكد</p> : null}
      </div>
      <section className="space-y-5" aria-label="البحث والتصفية">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form className="relative w-full max-w-lg" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); setSkip(0) }}>
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-bw-ink-subtle" aria-hidden />
            <label htmlFor="order-search" className="sr-only">ابحث برقم الطلب أو العميل أو الهاتف</label>
            <input id="order-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="رقم الطلب، العميل أو الهاتف"
              className="h-bw-control w-full rounded-bw-field border border-bw-line bg-bw-surface pe-20 ps-10 text-bw-small text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-focus focus:outline-none" />
            <button type="submit" className="absolute inset-y-1 end-1 rounded-bw-field bg-bw-sunken px-3 text-bw-small font-semibold text-bw-ink hover:bg-bw-action-soft">بحث</button>
          </form>
          {(status || search) ? <Button variant="ghost" onClick={reset}>مسح التصفية</Button> : null}
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-bw-line pb-1" role="group" aria-label="حالة الطلب">
          {filters.map((filter) => <button key={filter.value} type="button" aria-pressed={status === filter.value}
            onClick={() => { setStatus(filter.value); setSkip(0) }}
            className={`shrink-0 rounded-bw-field px-3 py-2 text-bw-small transition-colors ${status === filter.value ? 'bg-bw-sunken font-semibold text-bw-ink' : 'text-bw-ink-soft hover:text-bw-ink'}`}>{filter.label}</button>)}
        </div>
      </section>
      <section aria-label="قائمة الطلبات" className="space-y-4">
        {orders.error ? <LoadError message={orders.error.message} onRetry={orders.reload} /> : null}
        {orders.loading && !orders.data ? <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div> : null}
        {orders.data && rows.length === 0 ? <StateBlock kind="empty" title="لا توجد طلبات مطابقة" body="غيّر البحث أو الحالة لعرض طلبات أخرى." action={<Button variant="secondary" onClick={reset}>عرض كل الطلبات</Button>} /> : null}
        {rows.length ? <div className="overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface divide-y divide-bw-line">
          {rows.map((order) => {
            const needsLocation = !order.hasPin && !CLOSED.includes(order.status)
            return <Link key={order.id} href={`/admin/orders/${order.id}`} className="group flex flex-col gap-3 p-4 transition-colors hover:bg-bw-sunken sm:flex-row sm:items-center sm:gap-5 sm:p-5">
              <span className="hidden size-11 shrink-0 place-items-center rounded-bw-field bg-bw-sunken sm:grid"><ShoppingBag className="size-5 text-bw-ink-soft" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="text-bw-ink"><Code>#{order.orderNumber}</Code></strong><Status map={ORDER_STATUS} value={order.status} />{needsLocation ? <StatusLabel tone="warn">الموقع غير مؤكد</StatusLabel> : null}</span><span className="mt-1 block truncate text-bw-small text-bw-ink-soft"><bdi>{order.customerName}</bdi> · {[order.area, order.governorate].filter(Boolean).join('، ') || 'عنوان غير محدد'}</span></span>
              <span className="flex items-center justify-between gap-4 sm:block sm:text-end"><span className="block font-semibold text-bw-ink"><Egp value={order.totalAmount} /></span><span className="block text-bw-small text-bw-ink-subtle"><Code>{order.itemCount}</Code> أصناف · {formatDateTime(order.createdAt)}</span></span>
              <ArrowLeft className="hidden size-4 shrink-0 text-bw-ink-subtle transition-transform group-hover:-translate-x-1 sm:block" aria-hidden />
            </Link>
          })}
        </div> : null}
        {orders.data && total > PAGE_SIZE ? <nav aria-label="صفحات الطلبات" className="flex items-center justify-between gap-3 text-bw-small"><Button variant="secondary" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>السابق</Button><span className="text-bw-ink-soft"><Code>{skip + 1}–{Math.min(skip + PAGE_SIZE, total)}</Code> من <Code>{total}</Code></span><Button variant="secondary" disabled={skip + PAGE_SIZE >= total} onClick={() => setSkip(skip + PAGE_SIZE)}>التالي</Button></nav> : null}
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
