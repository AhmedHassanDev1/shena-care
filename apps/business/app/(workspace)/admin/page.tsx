'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button, Code, Notice, PageHeader } from '@/components/bw/primitives'
import { RoleShell } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import type { AdminOverviewData, OverviewDays } from './overview-types'
import { OrderDistributionBar, SalesPerformanceChart } from './overview-chart'
import {
  ActionRequiredPanel,
  BusinessKpiGrid,
  CodStatusCard,
  CompactWorkflowStrip,
} from './overview-components'

export function formatRelativeTime(dateString: string | undefined): string {
  if (!dateString) return 'منذ لحظات'
  const then = new Date(dateString).getTime()
  const now = Date.now()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 60) return 'منذ لحظات'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin === 1) return 'منذ دقيقة'
  if (diffMin === 2) return 'منذ دقيقتين'
  if (diffMin >= 3 && diffMin <= 10) return `منذ ${diffMin} دقائق`
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours === 1) return 'منذ ساعة'
  if (diffHours === 2) return 'منذ ساعتين'
  if (diffHours >= 3 && diffHours <= 10) return `منذ ${diffHours} ساعات`
  return `منذ ${diffHours} ساعة`
}

const RANGE_OPTIONS: Array<{ value: OverviewDays; label: string }> = [
  { value: 1, label: 'اليوم' },
  { value: 7, label: '7 أيام' },
  { value: 30, label: '30 يوم' },
]

export function AdminOverview() {
  const [days, setDays] = React.useState<OverviewDays>(7)
  const { data, error, loading, reload } = useApi<AdminOverviewData>(
    `/operations/dashboard/overview?days=${days}`,
    { pollMs: 30000 },
  )

  const [relativeTime, setRelativeTime] = React.useState<string>('منذ لحظات')

  React.useEffect(() => {
    if (data?.lastUpdated) {
      setRelativeTime(formatRelativeTime(data.lastUpdated))
      const interval = setInterval(() => {
        setRelativeTime(formatRelativeTime(data.lastUpdated))
      }, 30000)
      return () => clearInterval(interval)
    }
  }, [data?.lastUpdated])

  const criticalCount = data?.actionRequired.criticalCount ?? 0
  const affectedOrdersCount = data?.actionRequired.affectedOrdersCount ?? 0
  const isInitialLoading = loading && !data

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-8 sm:py-7">
      {/* Page Header */}
      <PageHeader
        eyebrow="مساحة الإدارة / نظرة عامة"
        title="نظرة عامة"
        meta={<>لوحة العمليات والمبيعات · آخر تحديث: {relativeTime}</>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="نطاق التقرير الزمني"
              className="inline-flex h-bw-control items-center gap-0.5 rounded-bw-field border border-bw-line bg-bw-surface p-1 text-xs"
            >
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={days === opt.value}
                  onClick={() => setDays(opt.value)}
                  className={`rounded-md border px-3 py-1 font-medium transition-colors duration-150 ${
                    days === opt.value
                      ? 'border-bw-cobalt/35 bg-bw-cobalt-soft font-semibold text-bw-cobalt'
                      : 'border-transparent text-bw-ink-subtle hover:bg-bw-sunken/70 hover:text-bw-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <Button variant="secondary" onClick={reload} disabled={loading} className="hover:border-bw-cobalt/35">
              <RefreshCw className={`size-4 text-bw-cobalt ${loading ? 'animate-spin' : ''}`} aria-hidden />
              تحديث
            </Button>
          </div>
        }
      />

      {/* Compact Critical Alert Strip */}
      {data && criticalCount > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-bw-field border border-bw-line border-s-2 border-s-bw-rose bg-bw-surface px-4 py-2.5 shadow-bw-card"
        >
          <div className="flex items-center gap-2.5 text-xs sm:text-sm">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-bw-field bg-bw-rose-soft text-bw-rose">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            </span>
            <span className="font-semibold text-bw-ink">
              <Code className="text-bw-rose">{criticalCount}</Code> تنبيه حرج يحتاج تدخلاً فورياً
              {affectedOrdersCount > 0 ? (
                <span className="font-normal text-bw-ink-soft">
                  {' '}
                  (ضمن <Code>{affectedOrdersCount}</Code> طلب متأثر)
                </span>
              ) : null}
            </span>
          </div>
          <Link
            href="/admin/exceptions"
            className="shrink-0 rounded-bw-field border border-bw-rose/25 bg-bw-rose-soft px-3 py-1 text-xs font-semibold text-bw-rose transition-colors hover:border-bw-rose/50 hover:text-bw-ink"
          >
            فتح مركز الاستثناءات
          </Link>
        </div>
      ) : null}

      {/* API Error Notice */}
      {error ? (
        <Notice
          tone="danger"
          title="تعذر تحديث بيانات لوحة العمليات"
          action={<Button variant="secondary" onClick={reload}>إعادة المحاولة</Button>}
        >
          {error.message}
        </Notice>
      ) : null}

      {data || loading ? (
        <>
          {/* Row 1: 4 Prioritized Business KPIs */}
          <BusinessKpiGrid
            days={days}
            netRealizedSales={data?.kpis.netRealizedSales}
            contributionProfit={data?.kpis.contributionProfit}
            newOrders={data?.kpis.newOrders}
            completedOrders={data?.kpis.completedOrders}
            loading={isInitialLoading}
          />

          {/* Row 2: Compact Horizontal Operational Workflow */}
          <CompactWorkflowStrip
            stageBoard={data?.stageBoard}
            loading={isInitialLoading}
          />

          {/* Row 3: Balanced 2-Column Analytical & Attention Grid */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
            <div className="flex flex-col gap-5 lg:col-span-7">
              <SalesPerformanceChart
                series={data?.salesChart.series ?? []}
                days={days}
                granularity={data?.salesChart.granularity ?? (days === 1 ? 'hourly' : 'daily')}
                hasFinancialAccess={data?.salesChart.hasFinancialAccess ?? true}
                hasPreviousComparison={data?.salesChart.hasPreviousComparison ?? false}
                onDaysChange={setDays}
                loading={isInitialLoading}
              />

              <OrderDistributionBar
                total={data?.orderDistribution.total ?? 0}
                items={data?.orderDistribution.items ?? []}
                loading={isInitialLoading}
              />
            </div>

            <div className="flex flex-col gap-5 lg:col-span-5">
              <ActionRequiredPanel
                items={data?.actionRequired.items ?? []}
                totalIssues={data?.actionRequired.totalIssues ?? 0}
                affectedOrdersCount={data?.actionRequired.affectedOrdersCount ?? 0}
                standaloneCasesCount={data?.actionRequired.standaloneCasesCount ?? 0}
                criticalCount={data?.actionRequired.criticalCount ?? 0}
                loading={isInitialLoading}
              />

              <CodStatusCard
                summary={data?.financialSummary}
                loading={isInitialLoading}
              />
            </div>
          </div>
        </>
      ) : null}
    </main>
  )
}

export default function AdminOverviewPage() {
  return (
    <RoleShell role="admin" active="attention" mode="desktop">
      <AdminOverview />
    </RoleShell>
  )
}
