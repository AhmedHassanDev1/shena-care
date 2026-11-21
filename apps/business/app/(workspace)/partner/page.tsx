'use client'

import Link from 'next/link'
import { HandCoins, Landmark, TrendingUp, TriangleAlert, Truck, Wallet } from 'lucide-react'
import { PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { PanelHead } from '@/components/bw/ops'
import { Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import { Amount, dayLabel, type Overview } from './partner-ui'
import { Kpi, MonthBars, PeriodSelect, StackBar, StatusChip, TypeIcon, shortMonth, typeName, usePeriod } from './partner-kit'

const egp = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })} ج.م`)

export default function PartnerOverviewPage() {
  const period = usePeriod('3')
  const overview = useApi<Overview>(`/capital-partner/overview?from=${period.from}&to=${period.to}`)
  const o = overview.data

  return (
    <RoleShell role="partner" active="overview" mode="responsive">
      <Page>
        <PageHeader title="نظرة عامة" actions={<PeriodSelect value={period.value} onChange={period.setValue} />} />
        {overview.error ? <LoadError message={overview.error.message} onRetry={overview.reload} /> : null}
        {!o && overview.loading ? <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div> : null}

        {o ? <>
          {o.profit.status === 'INCOMPLETE' ? (
            <p role="status" className="flex items-center gap-2 rounded-bw-card border border-bw-amber/30 bg-bw-amber-soft px-4 py-3 text-bw-small text-bw-ink">
              <TriangleAlert className="size-4 shrink-0 text-bw-amber" aria-hidden />
              أرباح بعض الشهور لسه بتستنى تكاليف، ومش ظاهرة في الأرقام.
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Wallet} label="رأس مالك" value={egp(o.capital.funded.total)} tone="cobalt" />
            <Kpi icon={Landmark} label="لسه ماترجعش لك" value={egp(o.capital.notReturnedYet)} tone="amber" />
            <Kpi icon={TrendingUp} label="أرباحك" value={egp(o.profit.partnerShare)} tone="emerald" note={`${o.split.partnerPercent}% من الربح`} />
            <Kpi icon={HandCoins} label="باقي لك من الأرباح" value={egp(o.profit.remaining)} tone="violet" note={o.profit.payableNow > 0 ? `جاهز للصرف ${egp(o.profit.payableNow)}` : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-label="أرباحك كل شهر" className="bw-panel">
              <PanelHead title="أرباحك كل شهر" />
              <div className="p-4">
                <MonthBars
                  months={[...o.months].reverse().map((month) => ({ key: month.period, label: shortMonth(month.period), a: month.partnerShare, b: month.paid }))}
                  aLabel="حصتك" bLabel="اللي اتدفع لك" pendingLabel="لسه معلّق"
                />
              </div>
            </section>

            <section aria-label="فلوسك راحت فين" className="bw-panel">
              <PanelHead title="فلوسك راحت فين" />
              <div className="p-4">
                <StackBar
                  label="توزيع رأس المال الممول"
                  total={o.capital.funded.total}
                  slices={[
                    { key: 'p', label: 'بضاعة', value: o.capital.funded.products, color: 'bg-bw-cobalt' },
                    { key: 'd', label: 'توصيل', value: o.capital.funded.directCosts.delivery, color: 'bg-bw-emerald' },
                    { key: 'k', label: 'تغليف', value: o.capital.funded.directCosts.packaging, color: 'bg-bw-amber' },
                    { key: 'e', label: 'مصروفات', value: o.capital.funded.directCosts.approvedExpenses, color: 'bg-bw-violet' },
                  ]}
                />
              </div>
            </section>
          </div>

          <Kpi icon={Truck} label="كاش لسه مع المناديب" value={egp(o.cash.inCourierCustody.amount)} tone="amber" note={o.cash.inCourierCustody.orders ? `${o.cash.inCourierCustody.orders} طلب` : 'مفيش كاش معلّق'} />

          <section aria-label="آخر الحركات" className="bw-panel">
            <PanelHead title="آخر الحركات" aside={<Link href="/partner/ledger" className="text-bw-small font-semibold text-bw-cobalt underline-offset-4 hover:underline">كل الحركات</Link>} />
            {o.recent.length === 0 ? <StateBlock kind="empty" title="مفيش حركات في الفترة دي" /> : (
              <ul className="divide-y divide-bw-line">
                {o.recent.slice(0, 5).map((movement) => (
                  <li key={movement.id} className="flex items-center gap-3 px-4 py-3">
                    <TypeIcon type={movement.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-bw-small font-semibold text-bw-ink">{typeName(movement.type)}</p>
                      <p className="text-[12px] text-bw-ink-subtle">{dayLabel(movement.date)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Amount value={movement.amount} unknown="—" className="text-bw-small font-semibold text-bw-ink" />
                      <StatusChip status={movement.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </> : null}
      </Page>
    </RoleShell>
  )
}
