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
 * Hub cashier count (owner decision 2026-10-25): a driver's whole round is counted as ONE total. The expected cash was fixed
 * when the round left the hub; the difference (short/over) shows on the round and goes to the admin queue. Never self-approved.
 */
export default function HubCash() {
  return (
    <HubShell active="cash">
      <CashBody />
    </HubShell>
  )
}

interface RoundTotals { expectedTotal: string; declaredTotal: string; countedTotal: string; variance: string }
interface Receipt { name: string; reference: string; round: RoundTotals; lines: SettlementLine[]; orderNumbers: Record<string, string> }

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
  const clean = Number(receipt.round.variance) === 0
  return (
    <Section title={<>تسوية {receipt.name} · <Code>{receipt.reference}</Code></>}>
      <div className="space-y-2">
        <Notice tone={clean ? 'ok' : 'warn'} title={clean ? 'الجولة اتسوّت بدون فروق' : `فرق في الجولة: ${Number(receipt.round.variance) > 0 ? 'زيادة' : 'عجز'} ${Math.abs(Number(receipt.round.variance)).toLocaleString('en-US')} ج.م — ظاهر للإدارة`} />
        <p className="text-bw-small">متوقع <Egp value={receipt.round.expectedTotal} /> · أعلن المندوب <Egp value={receipt.round.declaredTotal} /> · اتعدّ <Egp value={receipt.round.countedTotal} /></p>
        <DataTable caption="نتيجة التسوية" head={['الطلب', 'متوقع', 'أعلن المندوب', 'الفرق عن المتوقع', 'الحالة']}>
          {receipt.lines.map((l) => (
            <tr key={l.orderId}>
              <td><Code>{receipt.orderNumbers[l.orderId] ?? shortId(l.orderId)}</Code></td>
              <td><Egp value={l.expectedAmount} /></td><td><Egp value={l.declaredAmount} /></td>
              <td><Egp value={Number(l.declaredAmount) - Number(l.expectedAmount)} /></td><td>{l.status}</td>
            </tr>
          ))}
        </DataTable>
      </div>
    </Section>
  )
}

function CourierCount({ hubId, courierId, name, rows, onSettled }: { hubId: string; courierId: string; name: string; rows: Collection[]; onSettled: (receipt: Receipt) => void }) {
  const [counted, setCounted] = React.useState('')
  // A stable reference per count makes a retried submit replay the same settlement, never a second one.
  const reference = React.useRef(`CNT-${new Date().toISOString().slice(0, 10)}-${courierId.slice(0, 6)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase())
  const expectedTotal = rows.reduce((sum, r) => sum + Number(r.expectedAmount), 0)
  const declaredTotal = rows.reduce((sum, r) => sum + Number(r.declaredAmount ?? 0), 0)
  const amount = Number(counted)
  const valid = counted.trim() !== '' && Number.isFinite(amount) && amount >= 0
  const difference = valid ? Math.round((amount - expectedTotal) * 100) / 100 : null
  const settle = useCommand(() => api<RoundTotals & { lines: SettlementLine[] }>('/ordering/settlements/rounds', { body: {
    courierId, locationId: hubId, reference: reference.current, countedTotal: Math.round(amount * 100) / 100,
  } }))

  return (
    <Section title={<>المندوب: {name}</>} aside={<span className="text-bw-small">مرجع العدّ <Code>{reference.current}</Code></span>}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault()
        if (!window.confirm(`تأكيد عدّ ${amount.toLocaleString('en-US')} ج.م من ${name} للجولة كلها؟ التسوية بتتسجل مرة واحدة.`)) return
        const done = await settle.execute()
        if (done) {
          onSettled({ name, reference: reference.current, round: done, lines: done.lines, orderNumbers: Object.fromEntries(rows.map((r) => [r.orderId, r.orderNumber])) })
        }
      }}>
        <DataTable caption="طلبات الجولة" head={['الطلب', 'متوقع', 'أعلن المندوب']}>
          {rows.map((r) => (
            <tr key={r.orderId}>
              <td><Code>{r.orderNumber}</Code></td>
              <td><Egp value={r.expectedAmount} /></td>
              <td><Egp value={r.declaredAmount} /></td>
            </tr>
          ))}
        </DataTable>
        <p>إجمالي المتوقع للجولة: <Egp value={expectedTotal} /> · إجمالي اللي أعلنه المندوب: <Egp value={declaredTotal} /></p>
        <Field label="المبلغ اللي اتعدّ فعلاً للجولة كلها" ltr inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
        {difference !== null && difference !== 0 ? <Notice tone="warn" title={`${difference > 0 ? 'زيادة' : 'عجز'} ${Math.abs(difference).toLocaleString('en-US')} ج.م عن المتوقع — هيظهر للإدارة`} /> : null}
        <Button type="submit" loading={settle.pending} disabled={!valid}>تسجيل العدّ والتسوية</Button>
        <CommandError error={settle.error} />
      </form>
    </Section>
  )
}
