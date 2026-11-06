'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react'
import { Button, Notice, PageHeader } from '@/components/bw/primitives'
import { RoleShell } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import type { AdminOverviewData } from './overview-types'
import { OrdersActivityChart } from './overview-chart'
import {
  ActionRequiredPanel,
  FinancialSummarySection,
  KpiCard,
  OperationalStageBoard,
} from './overview-components'

function formatRelativeTime(dateString: string | undefined): string {
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

export function AdminOverview() {
  const [days, setDays] = React.useState<number>(7)
  const { data, error, loading, reload } = useApi<AdminOverviewData>(
    `/operations/dashboard/overview?days=${days}`,
    { pollMs: 30000 }
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

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-8 sm:py-9">
      <PageHeader
        eyebrow="مساحة الإدارة / نظرة عامة"
        title="نظرة عامة"
        meta={<>لوحة العمليات · آخر تحديث: {relativeTime}</>}
        actions={
          <Button variant="secondary" onClick={reload} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            تحديث
          </Button>
        }
      />

      {error ? (
        <Notice
          tone="danger"
          title="تعذر تحديث بعض بيانات لوحة العمليات"
          action={<Button variant="secondary" onClick={reload}>إعادة المحاولة</Button>}
        >
          {error.message}
        </Notice>
      ) : null}

      {(data || loading) ? <>
      {/* ── Row 1: Four Minimal KPI Cards ── */}
      <section aria-label="المؤشرات الرئيسية للعمليات" className="order-2 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: طلبات اليوم */}
        <KpiCard
          title="طلبات اليوم"
          icon={<ShoppingBag className="size-4.5" />}
          metric={data?.kpis.ordersToday}
          unit="طلب"
          comparison={{
            text: `مقارنة بالأمس: ${(data?.kpis.ordersToday.yesterdayCount ?? 0).toLocaleString()} طلب`,
            changePercent: data?.kpis.ordersToday.changePercent,
          }}
          loading={loading && !data}
        />

        {/* KPI 2: طلبات مفتوحة الآن */}
        <KpiCard
          title="طلبات مفتوحة الآن"
          icon={<Hourglass className="size-4.5" />}
          metric={data?.kpis.openOrders}
          unit="نشط"
          subtext="قيد المعالجة والتجهيز بالمستودع"
          badge={data?.kpis.openOrders.status}
          badgeTone="neutral"
          loading={loading && !data}
        />

        {/* KPI 3: تم التسليم اليوم */}
        <KpiCard
          title="تم التسليم اليوم"
          icon={<CheckCircle2 className="size-4.5 text-bw-ok" />}
          metric={data?.kpis.deliveredToday}
          unit="مكتمل"
          subtext="تم تسليمها للعملاء بنجاح"
          badge={
            data?.kpis.deliveredToday.deliveredRate !== null && data?.kpis.deliveredToday.deliveredRate !== undefined
              ? `${data.kpis.deliveredToday.deliveredRate}% نسبة التسليم`
              : undefined
          }
          badgeTone="ok"
          loading={loading && !data}
        />

        {/* KPI 4: تحتاج تدخلك */}
        <KpiCard
          title="تحتاج تدخلك"
          icon={
            <span className="relative flex items-center justify-center">
              <AlertTriangle className="size-4.5 text-bw-warn" />
            </span>
          }
          metric={data?.kpis.needsIntervention}
          unit="حرجة"
          subtext="حالات تتطلب إجراءً فورياً"
          badge={
            data?.kpis.needsIntervention.criticalCount !== undefined
              ? `${data.kpis.needsIntervention.criticalCount} معطلة`
              : undefined
          }
          badgeTone="warn"
          loading={loading && !data}
        />
      </section>

      {/* The action queue leads; trends and cash remain available on demand. */}
      <section aria-label="طابور التدخل" className="order-1">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-bw-small text-bw-ink-soft">الأولوية الآن</p>
            <h2 className="font-bw-display text-bw-heading font-semibold">قرارات تحتاج متابعة</h2>
          </div>
          <span className="rounded-bw-pill border border-bw-line px-3 py-1 text-xs text-bw-ink-soft">
            {data ? `${data.actionRequired.total} حالة مفتوحة` : 'جارٍ تحميل الحالات'}
          </span>
        </div>
        <div>
          <ActionRequiredPanel
            items={data?.actionRequired.items ?? []}
            total={data?.actionRequired.total ?? 0}
            criticalCount={data?.actionRequired.criticalCount ?? 0}
            loading={loading && !data}
          />
        </div>
      </section>

      {/* ── Row 3: Operational Stage Board (5 Cards) ── */}
      <section aria-label="لوحة مسار الطلبات" className="order-3">
        <OperationalStageBoard
          stageBoard={data?.stageBoard}
          loading={loading && !data}
        />
      </section>

      {/* ── Row 4: Financial & Cash Reconciliation Summary ── */}
      <section className="order-4" aria-label="تحليل إضافي">
        <details className="group rounded-xl border border-bw-line bg-bw-surface p-4 open:p-5">
          <summary className="cursor-pointer text-sm font-semibold text-bw-ink marker:text-bw-ok">حركة الطلبات والمالية</summary>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <OrdersActivityChart
              series={data?.activityChart.series ?? []}
              days={days}
              onDaysChange={setDays}
            />
            <FinancialSummarySection
              summary={data?.financialSummary}
              loading={loading && !data}
            />
          </div>
        </details>
      </section>
      </> : null}
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
