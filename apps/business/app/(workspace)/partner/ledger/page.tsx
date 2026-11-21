'use client'

import * as React from 'react'
import { Landmark, ShoppingBag, TrendingUp } from 'lucide-react'
import { Button, Dialog, PageHeader, Skeleton, StateBlock, useDialog } from '@/components/bw/primitives'
import { SearchField, Segmented } from '@/components/bw/ops'
import { KeyValues, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { Amount, cairoToday, dayLabel, type Movement } from '../partner-ui'
import { GROUPS, Kpi, PeriodSelect, StatusChip, TypeIcon, typeName, usePeriod } from '../partner-kit'

interface Result { total: number; limit: number; offset: number; totals: { funded: number; capitalReturned: number; profitPaid: number }; items: Movement[] }
const PAGE = 30
const egp = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })} ج.م`

/** Only the facts a person can read: no field names. */
const FACTS: Record<string, string> = {
  product: 'المنتج', variant: 'النوع', quantity: 'الكمية', unitCost: 'سعر الوحدة', finalUnitCost: 'سعر الوحدة', invoiceRef: 'رقم الفاتورة', batchNumber: 'رقم الدفعة', description: 'البيان',
  reason: 'السبب', counted: 'اتعدّ', declared: 'قال المندوب', variance: 'الفرق', orders: 'عدد الطلبات', period: 'عن شهر',
}

function Detail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const dialog = useDialog()
  const [movement, setMovement] = React.useState<Movement | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!id) return
    setMovement(null); setError(null); dialog.open()
    api<Movement>(`/capital-partner/movements/${encodeURIComponent(id)}`).then(setMovement).catch((e: Error) => setError(e.message))
    // opens once per id
  }, [id])
  const facts = movement ? Object.entries(movement.details).filter(([key, value]) => FACTS[key] && value !== null && value !== '').map(([key, value]): [string, React.ReactNode] => [FACTS[key], typeof value === 'number' ? <bdi className="bw-code">{value.toLocaleString('en-US')}</bdi> : String(value)]) : []
  const note = movement ? (movement.details.note ?? movement.details.kind) : null
  return (
    <Dialog dialogRef={dialog.ref} title="تفاصيل الحركة" variant="drawer" onClose={onClose}>
      {error ? <LoadError message={error} /> : null}
      {!movement && !error ? <Skeleton className="h-32 w-full" /> : null}
      {movement ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3"><TypeIcon type={movement.type} className="size-11" /><div><p className="font-semibold text-bw-ink">{typeName(movement.type)}</p><p className="text-bw-small text-bw-ink-soft">{dayLabel(movement.date)}</p></div></div>
          <KeyValues rows={[
            ['المبلغ', <Amount key="a" value={movement.amount} unknown="التكلفة لسه مسجّلتش" />],
            ['الحالة', <StatusChip key="s" status={movement.status} />],
            ['المرجع', <bdi key="r" className="bw-code">{movement.reference}</bdi>],
            ...(movement.orderNumber ? [['رقم الطلب', <bdi key="o" className="bw-code">{movement.orderNumber}</bdi>] as [string, React.ReactNode]] : []),
            ...facts,
          ]} />
          {note ? <p className="rounded-bw-field bg-bw-sunken p-3 text-bw-small text-bw-ink-soft">{String(note)}</p> : null}
        </div>
      ) : null}
    </Dialog>
  )
}

export default function PartnerLedgerPage() {
  const period = usePeriod('3')
  const [group, setGroup] = React.useState('')
  const [q, setQ] = React.useState('')
  const [limit, setLimit] = React.useState(PAGE)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const types = GROUPS.find((item) => item.value === group)?.types ?? []
  // The API filters one type at a time and a group is several: the list is read for the period and grouped here.
  const list = useApi<Result>(`/capital-partner/movements?from=${period.from}-01&to=${cairoToday()}&limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  const data = list.data
  const rows = (data?.items ?? []).filter((movement) => !types.length || types.includes(movement.type))
  const shown = rows.slice(0, limit)

  return (
    <RoleShell role="partner" active="ledger" mode="responsive">
      <Page>
        <PageHeader title="رأس المال والحركات" actions={<PeriodSelect value={period.value} onChange={(value) => { period.setValue(value); setLimit(PAGE) }} />} />

        {data ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi icon={ShoppingBag} label="اللي دفعته" value={egp(data.totals.funded)} tone="cobalt" />
            <Kpi icon={Landmark} label="رأس مال رجع لك" value={egp(data.totals.capitalReturned)} tone="amber" />
            <Kpi icon={TrendingUp} label="أرباح اتدفعت لك" value={egp(data.totals.profitPaid)} tone="emerald" />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented items={GROUPS.map((item) => ({ value: item.value, label: item.label }))} value={group} onChange={(value) => { setGroup(value); setLimit(PAGE) }} label="نوع الحركة" />
          <SearchField value={q} onChange={(value) => { setQ(value); setLimit(PAGE) }} label="بحث برقم الطلب" placeholder="رقم الطلب أو المرجع" />
        </div>

        {list.error ? <LoadError message={list.error.message} onRetry={list.reload} /> : null}
        {!data && list.loading ? <Skeleton className="h-64 w-full" /> : null}
        {data ? (
          <section aria-label="الحركات" className="bw-panel">
            {shown.length === 0 ? <StateBlock kind="empty" title="مفيش حركات" body="جرّب فترة أو نوع تاني." /> : (
              <ul className="divide-y divide-bw-line">
                {shown.map((movement) => {
                  const incoming = movement.effect === 'RETURNED'
                  return (
                    <li key={movement.id}>
                      <button type="button" onClick={() => setOpenId(movement.id)} className="bw-row flex w-full items-center gap-3 px-4 py-3 text-start" aria-label={`${typeName(movement.type)} ${movement.reference}`}>
                        <TypeIcon type={movement.type} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-bw-small font-semibold text-bw-ink">{typeName(movement.type)}</span>
                          <span className="block truncate text-[12px] text-bw-ink-subtle">{dayLabel(movement.date)} · <bdi className="bw-code">{movement.orderNumber ?? movement.reference}</bdi></span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className={cn('text-bw-small font-semibold tabular-nums', incoming ? 'text-bw-emerald' : 'text-bw-ink')}>{incoming ? '+ ' : ''}<Amount value={movement.amount} unknown="التكلفة ناقصة" /></span>
                          <StatusChip status={movement.status} />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {rows.length > limit ? <div className="border-t border-bw-line p-3 text-center"><Button variant="secondary" size="sm" onClick={() => setLimit(limit + PAGE)}>عرض المزيد</Button></div> : null}
          </section>
        ) : null}
        <Detail id={openId} onClose={() => setOpenId(null)} />
      </Page>
    </RoleShell>
  )
}
