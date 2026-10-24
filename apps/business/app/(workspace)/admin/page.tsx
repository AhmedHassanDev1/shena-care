'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Package, RefreshCw, ShieldAlert, Truck, Wallet } from 'lucide-react'
import { Code, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Egp, Page, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { formatDateTime, ORDER_STATUS } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

type Paged<T> = { total: number; items: T[] }

interface AttentionQueue {
  supplyActionRequired: Paged<{ orderId: string; orderNumber: string | null }>
  customerDecisionsPending: Paged<{ orderId: string; orderNumber: string }>
  distributionRequired: Paged<{ purchaseOrderId: string; lineId: string }>
  failedDeliveries: Paged<{ orderId: string; orderNumber: string | null; reasonCode: string | null; failedAt: string }>
  cashVariances?: { short: Paged<Record<string, unknown>>; over: Paged<Record<string, unknown>> }
  openCases?: Paged<{ id: string; title: string; priority: string; orderId: string | null; createdAt: string }>
}

interface DashboardKpis {
  revenueToday: number | null
  ordersToday: number
  totalOrders: number
  activeOrders: number
  pipeline: { placed: number; confirmed: number; packing: number; shipped: number; delivered: number; terminal: number; total: number }
}

interface OrderRow {
  id: string
  orderNumber: string
  status: string
  customerName: string
  governorate: string | null
  area: string | null
  totalAmount: number
  itemCount?: number
  createdAt: string
}

/**
 * Founder Admin overview: only numbers and queues the API actually returns (GLO-223). Anything that needs a decision opens the
 * owning order or queue; nothing is resolved from this page.
 */
export function AdminOverview() {
  const kpis = useApi<DashboardKpis>('/operations/dashboard/kpis', { pollMs: 30000 })
  const attention = useApi<AttentionQueue>('/operations/queues/attention', { pollMs: 30000 })
  const orders = useApi<Paged<OrderRow>>('/admin/orders?take=20', { pollMs: 30000 })

  const error = kpis.error ?? attention.error ?? orders.error
  const reload = () => { kpis.reload(); attention.reload(); orders.reload() }

  const queues = attention.data
    ? [
        { key: 'supply', title: 'نقص توريد يحتاج قرار', count: queues_total(attention.data.supplyActionRequired), href: '/admin/exceptions' },
        { key: 'customer', title: 'قرارات عملاء معلّقة', count: queues_total(attention.data.customerDecisionsPending), href: '/admin/exceptions' },
        { key: 'distribution', title: 'بضاعة موردين محتاجة توزيع', count: queues_total(attention.data.distributionRequired), href: '/admin/sourcing' },
        { key: 'failed', title: 'توصيلات فاشلة', count: queues_total(attention.data.failedDeliveries), href: '/admin/delivery' },
        { key: 'cash', title: 'فروق نقدية', count: queues_total(attention.data.cashVariances?.short) + queues_total(attention.data.cashVariances?.over), href: '/admin/cash' },
        { key: 'cases', title: 'حالات دعم مفتوحة', count: queues_total(attention.data.openCases), href: '/admin/exceptions' },
      ]
    : []
  const needsAttention = queues.reduce((sum, q) => sum + q.count, 0)

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="sc-page-title">نظرة عامة</h1>
          <p className="text-bw-small text-bw-ink-soft">
            {attention.data ? (needsAttention > 0 ? `${needsAttention} حاجة محتاجة تدخّل` : 'مفيش حاجة محتاجة تدخّل دلوقتي') : 'بنحمّل الطوابير…'}
          </p>
        </div>
        <button type="button" onClick={reload} className="sc-btn sm flex items-center gap-1.5"><RefreshCw className="size-3.5" />تحديث</button>
      </div>

      {error ? <LoadError message={error.message} onRetry={reload} /> : null}

      <section aria-label="مؤشرات اليوم" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<Package className="size-4" />} label="طلبات اليوم" value={kpis.data ? kpis.data.ordersToday : null} />
        <Kpi icon={<Truck className="size-4" />} label="طلبات شغّالة" value={kpis.data ? kpis.data.activeOrders : null} />
        <Kpi icon={<Truck className="size-4" />} label="مع المناديب" value={kpis.data ? kpis.data.pipeline.shipped : null} />
        <Kpi icon={<Wallet className="size-4" />} label="إيراد اليوم" value={kpis.data ? kpis.data.revenueToday : null} money />
      </section>

      <Section title={<span className="flex items-center gap-2"><ShieldAlert className="size-4" />طوابير التدخّل</span>}>
        {!attention.data && attention.loading ? <Skeleton className="h-24 w-full" /> : null}
        {attention.data ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {queues.map((q) => (
              <li key={q.key}>
                <Link href={q.href} className="sc-card flex items-center justify-between p-3.5 hover:border-[#34d27b]/40">
                  <span className="flex items-center gap-2 text-bw-small">
                    {q.count > 0 ? <AlertTriangle className="size-4 text-[#f5a524]" /> : null}
                    {q.title}
                  </span>
                  <span className="flex items-center gap-2"><b className="sc-num">{q.count}</b><ArrowLeft className="size-4" /></span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="آخر الطلبات" aside={<Link href="/admin/orders" className="text-bw-small underline">كل الطلبات</Link>}>
        {!orders.data && orders.loading ? <Skeleton className="h-32 w-full" /> : null}
        {orders.data && orders.data.items.length === 0 ? <StateBlock kind="empty" title="مافيش طلبات لسه" body="الطلبات بتظهر هنا أول ما عميل يأكّد طلب." /> : null}
        {orders.data && orders.data.items.length > 0 ? (
          <table className="w-full text-start text-bw-small">
            <thead><tr><th className="py-2 text-start">الطلب</th><th className="text-start">العميل</th><th className="text-start">المنطقة</th><th className="text-start">الإجمالي</th><th className="text-start">الحالة</th><th className="text-start">الوقت</th></tr></thead>
            <tbody>
              {orders.data.items.map((o) => (
                <tr key={o.id} className="border-t border-bw-line">
                  <td className="py-2"><Link href={`/admin/orders/${o.id}`} className="underline"><Code>{o.orderNumber}</Code></Link></td>
                  <td>{o.customerName}</td>
                  <td>{[o.governorate, o.area].filter(Boolean).join(' - ') || '—'}</td>
                  <td><Egp value={o.totalAmount} /></td>
                  <td><Status map={ORDER_STATUS} value={o.status} /></td>
                  <td>{formatDateTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>
    </Page>
  )
}

function queues_total(page: Paged<unknown> | undefined): number {
  return page?.total ?? 0
}

function Kpi({ icon, label, value, money }: { icon: React.ReactNode; label: string; value: number | null; money?: boolean }) {
  return (
    <div className="sc-card space-y-2 p-4">
      <div className="flex items-center justify-between text-xs text-bw-ink-subtle"><span>{label}</span>{icon}</div>
      <div className="sc-num text-2xl font-bold">{value === null ? '—' : money ? <Egp value={value} /> : value}</div>
    </div>
  )
}

export default function AdminOverviewPage() {
  return (
    <RoleShell role="admin" active="attention" mode="desktop">
      <AdminOverview />
    </RoleShell>
  )
}
