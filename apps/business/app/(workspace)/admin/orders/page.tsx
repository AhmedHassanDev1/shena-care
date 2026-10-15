'use client'

import * as React from 'react'
import Link from 'next/link'
import { Code, DataTable, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { ORDER_STATUS, formatDateTime } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

interface OrderRow {
  id: string; orderNumber: string; status: string; customerName: string; governorate: string | null; area: string | null
  paymentMethod: string; totalAmount: number; codAmount: number | null; itemCount: number; hasPin: boolean; createdAt: string
}

const PAGE = 25

/** Real orders from the Ordering module (W2), newest first. */
export default function AdminOrders() {
  const [status, setStatus] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [q, setQ] = React.useState('')
  const [skip, setSkip] = React.useState(0)
  const params = new URLSearchParams({ take: String(PAGE), skip: String(skip), ...(status ? { status } : {}), ...(q ? { q } : {}) })
  const { data, error, loading, reload } = useApi<{ total: number; items: OrderRow[] }>(`/admin/orders?${params}`, { pollMs: 30000 })

  return (
    <RoleShell role="admin" active="orders" mode="desktop">
      <Page>
        <PageHeader title="الطلبات" meta={data ? <>الإجمالي <Code>{data.total}</Code></> : null} />
        <Section>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); setSkip(0); setQ(query.trim()) }}
          >
            <Select
              className="w-56"
              label="الحالة"
              value={status}
              onChange={(v) => { setStatus(v); setSkip(0) }}
              options={[['', 'كل الحالات'], ...Object.entries(ORDER_STATUS).map(([k, [t]]) => [k, t] as [string, string])]}
            />
            <div className="min-w-56 flex-1 space-y-1">
              <label htmlFor="order-search" className="block text-bw-small font-semibold">بحث</label>
              <input id="order-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="رقم الطلب أو اسم العميل أو الموبايل"
                className="h-bw-control w-full rounded-bw-field border-[1.5px] border-bw-line-field bg-bw-surface px-3" />
            </div>
            <button type="submit" className="h-bw-control rounded-full border-[1.5px] border-bw-line-field px-5 font-semibold">بحث</button>
          </form>
        </Section>

        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-64 w-full" /> : null}
        {data && data.items.length === 0 ? <StateBlock kind="empty" title="مافيش طلبات بالشروط دي" /> : null}
        {data && data.items.length ? (
          <Section>
            <DataTable caption="الطلبات" head={['الطلب', 'العميل', 'المنطقة', 'الحالة', 'المطلوب عند الاستلام', 'القطع', 'اتطلب']}>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/admin/orders/${o.id}`} className="font-semibold text-bw-action-ink underline"><Code>{o.orderNumber}</Code></Link></td>
                  <td>{o.customerName}</td>
                  <td>{[o.area, o.governorate].filter(Boolean).join('، ')}{o.hasPin ? '' : ' · بدون دبوس'}</td>
                  <td><Status map={ORDER_STATUS} value={o.status} /></td>
                  <td><Egp value={o.codAmount ?? o.totalAmount} /> <span className="text-bw-small text-bw-ink-soft">{o.paymentMethod}</span></td>
                  <td><Code>{o.itemCount}</Code></td>
                  <td className="text-bw-small">{formatDateTime(o.createdAt)}</td>
                </tr>
              ))}
            </DataTable>
            <div className="mt-3 flex items-center justify-between text-bw-small">
              <button type="button" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))} className="font-semibold disabled:text-bw-ink-subtle">السابق</button>
              <span><Code>{`${skip + 1}–${Math.min(skip + PAGE, data.total)} / ${data.total}`}</Code></span>
              <button type="button" disabled={skip + PAGE >= data.total} onClick={() => setSkip(skip + PAGE)} className="font-semibold disabled:text-bw-ink-subtle">التالي</button>
            </div>
          </Section>
        ) : null}
      </Page>
    </RoleShell>
  )
}
