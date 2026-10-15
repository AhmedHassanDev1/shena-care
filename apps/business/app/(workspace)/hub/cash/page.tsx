'use client'

import * as React from 'react'
import { Button, Code, DataTable, Field, Notice, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { HubShell, useHub } from '@/components/workspace/hub'
import { CommandError, Egp, Page } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

interface Collection { orderId: string; orderNumber: string; courierId: string | null; status: string; expectedAmount: string; declaredAmount: string | null }
interface SettlementLine { orderId: string; expectedAmount: string; declaredAmount: string; countedAmount: string; variance: string; status: string }

/**
 * Hub cashier count (W5 settlement): cash the driver declared at the door is counted here by the
 * cashier — never self-approved by the driver. Every short/over stays visible; nothing is auto-accepted.
 */
export default function HubCash() {
  return (
    <HubShell active="cash">
      <CashBody />
    </HubShell>
  )
}

interface Receipt { name: string; reference: string; lines: SettlementLine[]; orderNumbers: Record<string, string> }

function CashBody() {
  const hub = useHub()
  const [receipts, setReceipts] = React.useState<Receipt[]>([])
  const { data, error, loading, reload } = useApi<{ items: Collection[] }>(`/ordering/settlements/collections?locationId=${hub.id}&status=collected&take=100`, { pollMs: 20000 })
  const drivers = useApi<Array<{ id: string; name: string }>>('/workspace/drivers')
  const driverName = new Map((drivers.data ?? []).map((d) => [d.id, d.name]))
  const byCourier = React.useMemo(() => {
    const groups = new Map<string, Collection[]>()
    for (const c of data?.items ?? []) if (c.courierId) groups.set(c.courierId, [...(groups.get(c.courierId) ?? []), c])
    return [...groups.entries()]
  }, [data])

  return (
    <Page>
      <PageHeader title="عدّ نقدية المندوبين" meta={`${hub.name} — اعدّ الفلوس اللي استلمتها فعلاً من كل مندوب`} />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-32 w-full" /> : null}
      {data && byCourier.length === 0 ? <StateBlock kind="empty" title="مافيش نقدية مستنية عدّ" body="الطلبات اللي اتسلّمت وأعلن المندوب تحصيلها بتظهر هنا." /> : null}
      {receipts.map((r) => <SettlementReceipt key={r.reference} receipt={r} />)}
      {byCourier.map(([courierId, rows]) => (
        <CourierCount key={courierId} hubId={hub.id} courierId={courierId} name={driverName.get(courierId) ?? shortId(courierId)} rows={rows}
          onSettled={(receipt) => { setReceipts((all) => [receipt, ...all]); reload() }} />
      ))}
    </Page>
  )
}

function SettlementReceipt({ receipt }: { receipt: Receipt }) {
  const clean = receipt.lines.every((l) => Number(l.variance) === 0)
  return (
    <Section title={<>تسوية {receipt.name} · <Code>{receipt.reference}</Code></>}>
      <div className="space-y-2">
        <Notice tone={clean ? 'ok' : 'warn'} title={clean ? 'اتسوّى بدون فروق' : 'اتسوّى مع فروق ظاهرة للإدارة'} />
        <DataTable caption="نتيجة التسوية" head={['الطلب', 'متوقع', 'أعلن', 'اتعدّ', 'الفرق', 'الحالة']}>
          {receipt.lines.map((l) => (
            <tr key={l.orderId}>
              <td><Code>{receipt.orderNumbers[l.orderId] ?? shortId(l.orderId)}</Code></td>
              <td><Egp value={l.expectedAmount} /></td><td><Egp value={l.declaredAmount} /></td><td><Egp value={l.countedAmount} /></td>
              <td><Egp value={l.variance} /></td><td>{l.status}</td>
            </tr>
          ))}
        </DataTable>
      </div>
    </Section>
  )
}

function CourierCount({ hubId, courierId, name, rows, onSettled }: { hubId: string; courierId: string; name: string; rows: Collection[]; onSettled: (receipt: Receipt) => void }) {
  const [counted, setCounted] = React.useState<Record<string, string>>({})
  // A stable reference per count makes a retried submit replay the same settlement, never a second one.
  const reference = React.useRef(`CNT-${new Date().toISOString().slice(0, 10)}-${courierId.slice(0, 6)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase())
  const total = rows.reduce((sum, r) => sum + (Number(counted[r.orderId]) || 0), 0)
  const complete = rows.every((r) => counted[r.orderId] !== undefined && counted[r.orderId] !== '' && Number(counted[r.orderId]) >= 0)
  const settle = useCommand(() => api<{ lines: SettlementLine[] }>('/ordering/settlements/batch', { body: {
    courierId, locationId: hubId, reference: reference.current, currency: 'EGP', totalCollected: Math.round(total * 100) / 100,
    collections: rows.map((r) => ({ orderId: r.orderId, collectedAmount: Number(counted[r.orderId]) })),
  } }))

  return (
    <Section title={<>المندوب: {name}</>} aside={<span className="text-bw-small">مرجع العدّ <Code>{reference.current}</Code></span>}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault()
        if (!window.confirm(`تأكيد عدّ ${total.toLocaleString('en-US')} ج.م من ${name}؟ التسوية بتتسجل مرة واحدة.`)) return
        const done = await settle.execute()
        if (done) onSettled({ name, reference: reference.current, lines: done.lines, orderNumbers: Object.fromEntries(rows.map((r) => [r.orderId, r.orderNumber])) })
      }}>
        <DataTable caption="عدّ النقدية" head={['الطلب', 'متوقع', 'أعلن المندوب', 'المبلغ اللي اتعدّ فعلاً']}>
          {rows.map((r) => (
            <tr key={r.orderId}>
              <td><Code>{r.orderNumber}</Code></td>
              <td><Egp value={r.expectedAmount} /></td>
              <td><Egp value={r.declaredAmount} /></td>
              <td><Field label={`المعدود لطلب ${r.orderNumber}`} ltr inputMode="decimal" value={counted[r.orderId] ?? ''} onChange={(e) => setCounted({ ...counted, [r.orderId]: e.target.value })} /></td>
            </tr>
          ))}
        </DataTable>
        <p>إجمالي المعدود: <Egp value={total} /></p>
        <Button type="submit" loading={settle.pending} disabled={!complete}>تسجيل العدّ والتسوية</Button>
        <CommandError error={settle.error} />
      </form>
    </Section>
  )
}
