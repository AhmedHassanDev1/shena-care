'use client'

import * as React from 'react'
import Link from 'next/link'
import { Code, DataTable, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { COLLECTION_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

interface Collection {
  orderId: string; orderNumber: string; orderStatus: string; locationId: string | null; courierId: string | null; status: string
  expectedAmount: string; declaredAmount: string | null; countedAmount: string | null; variance: string | null; settlementBatchId: string | null; updatedAt: string
}
interface Batch { id: string; reference: string; courierId: string; locationId: string | null; totalExpected: string; totalCollected: string; netSettled: string; settledAt: string; actorId: string }

/**
 * COD visibility (W2): expected → declared by the driver → counted at the hub → settled. The founder
 * watches; counting is the hub cashier's authorised action, never the driver's.
 */
export default function AdminCash() {
  return (
    <RoleShell role="admin" active="cod" mode="desktop">
      <CashBody />
    </RoleShell>
  )
}

function CashBody() {
  const me = useMe()
  const [status, setStatus] = React.useState('')
  const collections = useApi<{ total: number; items: Collection[] }>(`/ordering/settlements/collections?take=100${status ? `&status=${status}` : ''}`, { pollMs: 30000 })
  const batches = useApi<{ total: number; items: Batch[] }>('/ordering/settlements/batches?take=50')
  const drivers = useApi<Array<{ id: string; name: string }>>('/workspace/drivers')
  const driverName = new Map((drivers.data ?? []).map((d) => [d.id, d.name]))
  const hubName = new Map(me.hubLocations.map((h) => [h.id, h.name]))

  return (
    <Page>
      <PageHeader title="التحصيل والتسويات" meta="المبيعات حق الصيدلية؛ نسبة المؤسس بتتحسب منفصلة ومابتتخصمش من نقدية المندوب." />
      <Section title="التحصيلات" aside={<Select className="w-64" label="الحالة" value={status} onChange={setStatus} options={[['', 'الكل'], ...Object.entries(COLLECTION_STATUS).map(([k, [t]]) => [k, t] as [string, string])]} />}>
        {collections.error ? <LoadError message={collections.error.message} onRetry={collections.reload} /> : null}
        {!collections.data && collections.loading ? <Skeleton className="h-40 w-full" /> : null}
        {collections.data && collections.data.items.length === 0 ? <StateBlock kind="empty" title="مافيش تحصيلات" body="التحصيل المتوقع بيتسجّل لما المشوار يخرج من المخزن." /> : null}
        {collections.data?.items.length ? (
          <DataTable caption="التحصيلات" head={['الطلب', 'المخزن', 'المندوب', 'متوقع', 'أعلن المندوب', 'اتعدّ', 'الفرق', 'الحالة', 'آخر تحديث']}>
            {collections.data.items.map((c) => (
              <tr key={c.orderId}>
                <td><Link className="underline" href={`/admin/orders/${c.orderId}`}><Code>{c.orderNumber}</Code></Link></td>
                <td>{c.locationId ? hubName.get(c.locationId) ?? shortId(c.locationId) : '—'}</td>
                <td>{c.courierId ? driverName.get(c.courierId) ?? shortId(c.courierId) : '—'}</td>
                <td><Egp value={c.expectedAmount} /></td>
                <td><Egp value={c.declaredAmount} /></td>
                <td><Egp value={c.countedAmount} /></td>
                <td><Egp value={c.variance} /></td>
                <td><Status map={COLLECTION_STATUS} value={c.status} /></td>
                <td className="text-bw-small">{formatDateTime(c.updatedAt)}</td>
              </tr>
            ))}
          </DataTable>
        ) : null}
      </Section>
      <Section title="تسويات العدّ في المخزن">
        {batches.data && batches.data.items.length === 0 ? <p className="text-bw-small text-bw-ink-soft">مافيش تسويات لسه.</p> : null}
        {batches.data?.items.length ? (
          <DataTable caption="التسويات" head={['المرجع', 'المخزن', 'المندوب', 'متوقع', 'اتعدّ', 'صافي', 'وقت التسوية']}>
            {batches.data.items.map((b) => (
              <tr key={b.id}>
                <td><Code>{b.reference}</Code></td>
                <td>{b.locationId ? hubName.get(b.locationId) ?? shortId(b.locationId) : '—'}</td>
                <td>{driverName.get(b.courierId) ?? shortId(b.courierId)}</td>
                <td><Egp value={b.totalExpected} /></td>
                <td><Egp value={b.totalCollected} /></td>
                <td><Egp value={b.netSettled} /></td>
                <td className="text-bw-small">{formatDateTime(b.settledAt)}</td>
              </tr>
            ))}
          </DataTable>
        ) : null}
      </Section>
    </Page>
  )
}
