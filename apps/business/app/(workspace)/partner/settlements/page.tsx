'use client'

import * as React from 'react'
import { ChevronDown, Lock, TriangleAlert } from 'lucide-react'
import { PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { Amount, monthName, type Statement, type StatementDetail } from '../partner-ui'
import { PeriodSelect, SettlementChip, StackBar, usePeriod } from '../partner-kit'

/** One numbered line of the statement. */
function Line({ n, label, strong, children }: { n?: number; label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-4 py-2.5 text-bw-small', strong && 'bg-bw-sunken/60 font-semibold')}>
      <dt className="flex items-center gap-2 text-bw-ink-soft">{n ? <span aria-hidden className="w-5 text-[11px] text-bw-ink-subtle"><bdi className="bw-code">{n}</bdi></span> : null}<span className={strong ? 'text-bw-ink' : undefined}>{label}</span></dt>
      <dd className="text-bw-ink">{children}</dd>
    </div>
  )
}

function MonthDetail({ period }: { period: string }) {
  const detail = useApi<StatementDetail>(`/capital-partner/statements/${period}`)
  const d = detail.data
  if (detail.error) return <LoadError message={detail.error.message} onRetry={detail.reload} />
  if (!d) return <div className="p-4"><Skeleton className="h-40 w-full" /></div>
  const complete = d.status === 'COMPLETE'
  const income = d.sales.netSales + d.sales.deliveryRevenue
  const other = d.costs.confirmedDamages + d.costs.directCosts
  const orderCount = d.orders.length + d.endedOrders.length

  return (
    <div className="space-y-4 border-t border-bw-line pb-4">
      {!complete ? (
        <p role="status" className="mx-4 mt-4 flex items-center gap-2 rounded-bw-card border border-bw-amber/30 bg-bw-amber-soft px-3 py-2.5 text-bw-small text-bw-ink">
          <TriangleAlert className="size-4 shrink-0 text-bw-amber" aria-hidden />الشهر معلّق لحد ما تكتمل التكاليف. مفيش ربح ظاهر.
        </p>
      ) : (
        <div className="px-4 pt-4">
          <p className="mb-2 text-bw-small font-semibold text-bw-ink">الدخل راح فين</p>
          <StackBar
            label="توزيع دخل الشهر"
            total={income}
            slices={[
              { key: 'cost', label: 'تكلفة البضاعة', value: d.costs.products, color: 'bg-bw-cobalt' },
              { key: 'ops', label: 'توصيل وتغليف وتالف', value: d.costs.delivery + d.costs.packaging + other, color: 'bg-bw-amber' },
              { key: 'platform', label: 'حصة المنصة', value: d.split.platformShare ?? 0, color: 'bg-bw-violet' },
              { key: 'you', label: 'حصتك', value: d.split.partnerShare ?? 0, color: 'bg-bw-emerald' },
            ]}
          />
        </div>
      )}

      <dl className="divide-y divide-bw-line border-y border-bw-line">
        <Line n={1} label="المبيعات بعد الخصم"><Amount value={d.sales.netSales} /></Line>
        <Line n={2} label="رسوم التوصيل"><Amount value={d.sales.deliveryRevenue} /></Line>
        <Line n={3} label="تكلفة البضاعة"><Amount value={d.costs.products} /></Line>
        <Line n={4} label="التوصيل الفعلي"><Amount value={d.costs.delivery} /></Line>
        <Line n={5} label="التغليف"><Amount value={d.costs.packaging} /></Line>
        <Line n={6} label="التالف المعتمد"><Amount value={d.costs.confirmedDamages} /></Line>
        <Line n={7} label="مصروفات مباشرة معتمدة"><Amount value={d.costs.directCosts} /></Line>
        <Line n={8} label="الربح" strong><Amount value={d.distributableProfit} unknown="معلّق" /></Line>
        <Line n={9} label={`المنصة ${d.split.platformPercent}%`}><Amount value={d.split.platformShare} unknown="معلّق" /></Line>
        <Line n={10} label={`حصتك ${d.split.partnerPercent}%`} strong><Amount value={d.split.partnerShare} unknown="معلّق" /></Line>
        <Line n={11} label="اتدفع لك"><Amount value={d.profitPayout.paid} /></Line>
        <Line label="الباقي"><Amount value={d.profitPayout.remaining} unknown="معلّق" /></Line>
      </dl>

      <section aria-label="رأس المال" className="space-y-1">
        <h3 className="px-4 text-bw-small font-semibold text-bw-ink">12. رأس المال <span className="font-normal text-bw-ink-subtle">(مش من الربح)</span></h3>
        <dl className="divide-y divide-bw-line border-y border-bw-line">
          <Line label="رجع من طلبات اتسلّم كاشها"><Amount value={d.capital.recoveredFromSettledOrders} /></Line>
          <Line label="لسه مستني كاش"><Amount value={d.capital.tiedUpInUnsettledOrders} /></Line>
          <Line label="رجّعنا لك في الشهر"><Amount value={d.capital.returnedToPartnerInMonth} /></Line>
        </dl>
      </section>

      {orderCount > 0 ? (
        <details className="group mx-4 rounded-bw-card border border-bw-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-bw-small font-semibold text-bw-ink-soft hover:text-bw-ink [&::-webkit-details-marker]:hidden">
            الطلبات ({orderCount})<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y divide-bw-line border-t border-bw-line text-bw-small">
            {d.orders.map((order) => (
              <li key={order.orderNumber} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span><bdi className="bw-code font-semibold">{order.orderNumber}</bdi><span className="block text-[11px] text-bw-ink-subtle">{order.cash === 'SETTLED' ? 'كاشه اتسلّم' : 'كاشه مع المندوب'}</span></span>
                <Amount value={order.profit} unknown="تكلفة ناقصة" className="font-semibold" />
              </li>
            ))}
            {d.endedOrders.map((order) => (
              <li key={`e-${order.orderNumber}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-bw-ink-soft">
                <span><bdi className="bw-code font-semibold">{order.orderNumber}</bdi><span className="block text-[11px] text-bw-ink-subtle">ملغي أو مرتجع</span></span>
                <span>تكلفته بس: <Amount value={order.deliveryCost + order.packaging} /></span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {d.closed ? <p className="flex items-center gap-1.5 px-4 text-[12px] text-bw-ink-subtle"><Lock className="size-3.5 text-bw-emerald" aria-hidden />الشهر مقفول: أرقامه ثابتة.</p> : null}
    </div>
  )
}

function MonthCard({ statement, open, onToggle }: { statement: Statement; open: boolean; onToggle: () => void }) {
  return (
    <li className="bw-panel overflow-hidden">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-start">
        <span className="min-w-28 flex-1">
          <span className="flex items-center gap-2 font-semibold text-bw-ink">{monthName(statement.period)}{statement.closed ? <Lock className="size-3.5 text-bw-emerald" aria-label="شهر مقفول" /> : null}</span>
          <span className="mt-1 block"><SettlementChip state={statement.settlement} /></span>
        </span>
        <span className="flex flex-[2] justify-between gap-4 text-bw-small">
          <span><span className="block text-[11px] text-bw-ink-subtle">حصتك</span><Amount value={statement.split.partnerShare} unknown="معلّق" className="font-semibold text-bw-ink" /></span>
          <span><span className="block text-[11px] text-bw-ink-subtle">اتدفع</span><Amount value={statement.profitPayout.paid} /></span>
          <span><span className="block text-[11px] text-bw-ink-subtle">الباقي</span><Amount value={statement.profitPayout.remaining} unknown="معلّق" /></span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-bw-ink-subtle transition-transform duration-200', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? <MonthDetail period={statement.period} /> : null}
    </li>
  )
}

export default function PartnerSettlementsPage() {
  const period = usePeriod('6')
  const list = useApi<{ months: Statement[] }>(`/capital-partner/statements?from=${period.from}&to=${period.to}`)
  const [openPeriod, setOpenPeriod] = React.useState<string | null>(null)

  return (
    <RoleShell role="partner" active="settlements" mode="responsive">
      <Page>
        <PageHeader title="الأرباح والتسويات" actions={<PeriodSelect value={period.value} onChange={period.setValue} />} />
        {list.error ? <LoadError message={list.error.message} onRetry={list.reload} /> : null}
        {!list.data && list.loading ? <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div> : null}
        {list.data ? (
          list.data.months.filter(quiet => !(quiet.status === 'COMPLETE' && quiet.deliveredOrders === 0 && quiet.profitPayout.paid === 0 && quiet.capital.returnedToPartnerInMonth === 0)).length === 0 ? <StateBlock kind="empty" title="مفيش حركة في الفترة دي" /> : (
            <ul className="space-y-3">
              {list.data.months.filter((month) => !(month.status === 'COMPLETE' && month.deliveredOrders === 0 && month.profitPayout.paid === 0 && month.capital.returnedToPartnerInMonth === 0)).map((statement) => (
                <MonthCard key={statement.period} statement={statement} open={openPeriod === statement.period} onToggle={() => setOpenPeriod(openPeriod === statement.period ? null : statement.period)} />
              ))}
            </ul>
          )
        ) : null}
      </Page>
    </RoleShell>
  )
}
