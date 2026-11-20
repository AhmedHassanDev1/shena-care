'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Banknote, CircleCheck, Clock, LifeBuoy, MessageCircleWarning, PackageX, RefreshCw, Truck, TriangleAlert } from 'lucide-react'
import { Button, Notice, PageHeader, Skeleton } from '@/components/bw/primitives'
import { PanelHead, Segmented, Stat, StatStrip, type OpsTone } from '@/components/bw/ops'
import { TrendChart } from '@/components/bw/trend-chart'
import { OrderStatusHorizontalBarChart } from '@/components/bw/order-status-chart'
import { RoleShell } from '@/components/workspace/role-shell'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import type { ActionItem, AdminOverviewData, OverviewDays } from './overview-types'

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
  if (diffHours < 24) return `منذ ${diffHours} ساعة`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'منذ يوم'
  if (diffDays === 2) return 'منذ يومين'
  if (diffDays >= 3 && diffDays <= 10) return `منذ ${diffDays} أيام`
  return `منذ ${diffDays} يوم`
}

const RANGE_OPTIONS: Array<{ value: `${OverviewDays}`; label: string }> = [
  { value: '1', label: 'اليوم' },
  { value: '7', label: '7 أيام' },
  { value: '30', label: '30 يوم' },
]

const ACTION_ICON: Record<ActionItem['type'], React.ElementType> = {
  supply_shortage: PackageX,
  customer_decision: MessageCircleWarning,
  failed_delivery: Truck,
  cash_variance: Banknote,
  support_case: LifeBuoy,
}

const SEVERITY_ORDER: Record<ActionItem['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

const SEVERITY_BOX: Record<ActionItem['severity'], string> = {
  critical: 'border-bw-rose/25 bg-bw-rose-soft text-bw-rose',
  warning: 'border-bw-amber/25 bg-bw-amber-soft text-bw-amber',
  info: 'border-bw-cobalt/25 bg-bw-cobalt-soft text-bw-cobalt',
}

const SEVERITY_BADGE: Record<ActionItem['severity'], { label: string; className: string }> = {
  critical: { label: 'حرجة', className: 'border-bw-rose/30 bg-bw-rose-soft text-bw-rose' },
  warning: { label: 'متوسطة', className: 'border-bw-amber/30 bg-bw-amber-soft text-bw-amber' },
  info: { label: 'عادية', className: 'border-bw-cobalt/30 bg-bw-cobalt-soft text-bw-cobalt' },
}

const egp = (value: number) => `${value.toLocaleString('en-US')} ج.م`
const stageCount = (data: AdminOverviewData | undefined, id: string) => data?.stageBoard.stages.find((stage) => stage.id === id)?.count ?? 0
const stageHref = (data: AdminOverviewData | undefined, id: string, fallback: string) => data?.stageBoard.stages.find((stage) => stage.id === id)?.href ?? fallback

function AdminOverview() {
  const [days, setDays] = React.useState<OverviewDays>(7)
  const [metric, setMetric] = React.useState<'orders' | 'sales'>('orders')
  const { data, error, loading, reload } = useApi<AdminOverviewData>(`/operations/dashboard/overview?days=${days}`, { pollMs: 30000 })

  const [relativeTime, setRelativeTime] = React.useState('منذ لحظات')
  React.useEffect(() => {
    if (!data?.lastUpdated) return
    setRelativeTime(formatRelativeTime(data.lastUpdated))
    const interval = setInterval(() => setRelativeTime(formatRelativeTime(data.lastUpdated)), 30000)
    return () => clearInterval(interval)
  }, [data?.lastUpdated])

  const initial = loading && !data
  const canSeeSales = data?.salesChart.hasFinancialAccess ?? false
  const mode = canSeeSales ? metric : 'orders'
  const series = data?.salesChart.series ?? []
  const westernDigits = (text: string) => text.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  const points = series.map((p) => ({ key: p.key, label: p.label, short: westernDigits(p.shortLabel), value: mode === 'orders' ? p.orders : p.sales ?? 0 }))
  const chartTotal = points.reduce((sum, p) => sum + p.value, 0)
  const hourly = (data?.salesChart.granularity ?? (days === 1 ? 'hourly' : 'daily')) === 'hourly'
  const rangeLabel = days === 1 ? 'اليوم' : days === 7 ? 'آخر 7 أيام' : 'آخر 30 يوم'

  const cod = data?.financialSummary
  const actions = data?.actionRequired

  // Sort action items by priority first (critical > warning > info), then by age (oldest first)
  const sortedActions = React.useMemo(() => {
    if (!actions?.items) return []
    return [...actions.items].sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (sevDiff !== 0) return sevDiff
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
  }, [actions?.items])

  const shown = sortedActions.slice(0, 5)
  const distribution = data?.orderDistribution

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <PageHeader
        title="نظرة عامة"
        meta={<>آخر تحديث {relativeTime}</>}
        actions={
          <>
            <Segmented
              label="الفترة الزمنية"
              items={RANGE_OPTIONS}
              value={`${days}` as `${OverviewDays}`}
              onChange={(value) => setDays(Number(value) as OverviewDays)}
              className="rounded-bw-field border border-bw-line bg-bw-surface p-0.5"
            />
            <Button variant="secondary" size="sm" onClick={reload} loading={loading && !!data} aria-label="تحديث البيانات">
              {!(loading && !!data) ? <RefreshCw className="size-4" aria-hidden /> : null}
              تحديث
            </Button>
          </>
        }
      />

      {error ? (
        <Notice tone="danger" title="تعذر تحديث بيانات النظرة العامة" action={<Button variant="secondary" size="sm" onClick={reload}>إعادة المحاولة</Button>}>
          {error.message}
        </Notice>
      ) : null}

      {/* The five numbers that decide the day. Clear distinction between period metric & live pipeline. */}
      <StatStrip>
        <Stat
          label="طلبات جديدة"
          value={data?.kpis.newOrders.count ?? 0}
          tone="cobalt"
          href="/admin/orders"
          loading={initial}
          periodTag={<span className="rounded bg-bw-cobalt-soft px-1.5 py-0.5 text-[10px] font-semibold text-bw-cobalt border border-bw-cobalt/25">خلال {rangeLabel}</span>}
          hint={`إجمالي الوارد في ${rangeLabel}`}
        />
        <Stat
          label="بانتظار الشراء"
          value={stageCount(data, 'awaiting_sourcing')}
          tone="amber"
          href="/hub/buy-list"
          loading={initial}
          periodTag={<span className="rounded bg-bw-veil-3 px-1.5 py-0.5 text-[10px] font-medium text-bw-ink-subtle">تشغيلي حالي</span>}
          hint="طلبات لسه ماتشتراش لها"
        />
        <Stat
          label="قيد التجهيز"
          value={stageCount(data, 'packing_fulfillment')}
          tone="violet"
          href={stageHref(data, 'packing_fulfillment', '/admin/hub')}
          loading={initial}
          periodTag={<span className="rounded bg-bw-veil-3 px-1.5 py-0.5 text-[10px] font-medium text-bw-ink-subtle">تشغيلي حالي</span>}
          hint="فحص وتغليف بالمخزن"
        />
        <Stat
          label="مع المندوب"
          value={stageCount(data, 'out_for_delivery')}
          tone="cobalt"
          href={stageHref(data, 'out_for_delivery', '/admin/delivery')}
          loading={initial}
          periodTag={<span className="rounded bg-bw-veil-3 px-1.5 py-0.5 text-[10px] font-medium text-bw-ink-subtle">تشغيلي حالي</span>}
          hint="في الطريق للعميل"
        />
        <Stat
          label="تحصيل لم يُسوَّ"
          value={cod ? cod.pendingCod.amount.toLocaleString('en-US') : 0}
          unit="ج.م"
          tone="amber"
          href="/admin/cash"
          loading={initial}
          className="col-span-2 lg:col-span-1"
          periodTag={<span className="rounded bg-bw-veil-3 px-1.5 py-0.5 text-[10px] font-medium text-bw-ink-subtle">تشغيلي حالي</span>}
          hint={cod ? (cod.unresolvedVariance.caseCount > 0 ? `فروق عدّ: ${cod.unresolvedVariance.caseCount} حالة` : <><bdi className="bw-code">{cod.pendingCod.shipmentCount}</bdi> شحنة عند المناديب</>) : undefined}
        />
      </StatStrip>

      {/* Main operational grid: Daily Orders Chart (7 cols) side-by-side with Action Required (5 cols) on desktop */}
      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        {/* Daily Orders Line Chart */}
        <section aria-label="اتجاه الطلبات" className="bw-panel lg:col-span-7">
          <PanelHead
            title={
              <span className="flex flex-wrap items-baseline gap-x-3">
                {mode === 'orders' ? (hourly ? 'الطلبات بالساعة' : 'الطلبات اليومية') : 'إيراد مسلّم'}
                {!initial ? (
                  <span className="text-bw-small font-normal text-bw-ink-soft tabular-nums">
                    {mode === 'orders' ? <><bdi className="bw-code">{chartTotal}</bdi> طلب</> : egp(chartTotal)} · {rangeLabel}
                  </span>
                ) : null}
              </span>
            }
            aside={canSeeSales ? (
              <Segmented
                label="مقياس الرسم"
                items={[{ value: 'orders', label: 'طلبات' }, { value: 'sales', label: 'إيراد' }]}
                value={mode}
                onChange={setMetric}
                className="rounded-bw-field border border-bw-line bg-bw-page/50 p-0.5"
              />
            ) : undefined}
          />
          <div className="p-4 pb-3">
            {initial ? (
              <Skeleton className="h-[160px] w-full" />
            ) : (
              <TrendChart
                points={points}
                tone={mode === 'sales' ? 'emerald' : 'cobalt'}
                formatValue={(value) => (mode === 'orders' ? `${value} طلب` : egp(value))}
                formatAxis={(value) => (value >= 1000 ? `${Number.isInteger(value / 1000) ? value / 1000 : (value / 1000).toFixed(1)}k` : String(Math.round(value)))}
                ariaLabel={mode === 'orders' ? 'عدد الطلبات حسب الفترة' : 'الإيراد المسلّم حسب الفترة'}
                emptyLabel={mode === 'orders' ? 'مفيش طلبات في الفترة دي' : 'مفيش إيراد مسلّم في الفترة دي'}
              />
            )}
            {mode === 'sales' ? <p className="mt-2 text-[11px] text-bw-ink-subtle">صافي مبيعات البضاعة المسلّمة، بدون رسوم الشحن.</p> : null}
          </div>
        </section>

        {/* Needs action now: sorted by priority and age, refined ticket rows */}
        <section aria-label="تحتاج إجراء الآن" className="bw-panel flex flex-col lg:col-span-5">
          <PanelHead
            title={
              <span className="flex items-center gap-2">
                تحتاج إجراء الآن
                {actions && actions.criticalCount > 0 ? (
                  <span className="rounded-full border border-bw-rose/25 bg-bw-rose-soft px-2 py-0.5 text-[11px] font-semibold text-bw-rose">
                    <bdi className="bw-code">{actions.criticalCount}</bdi> حرجة
                  </span>
                ) : null}
              </span>
            }
            aside={actions && actions.totalIssues > shown.length ? (
              <Link href="/admin/exceptions" className="group inline-flex items-center gap-1 text-bw-small font-semibold text-bw-cobalt hover:text-bw-ink">
                عرض الكل (<bdi className="bw-code">{actions.totalIssues}</bdi>)
                <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden />
              </Link>
            ) : undefined}
          />
          {initial ? (
            <div className="space-y-2 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : shown.length === 0 ? (
            <div className="bw-arrive flex flex-col items-center gap-2 px-4 py-12 text-center">
              <span className="grid size-11 place-items-center rounded-full border border-bw-emerald/25 bg-bw-emerald-soft text-bw-emerald"><CircleCheck className="size-5" aria-hidden /></span>
              <p className="font-semibold text-bw-ink">مفيش حاجة محتاجة تدخّل دلوقتي</p>
              <p className="max-w-xs text-bw-small text-bw-ink-soft">أي نقص توريد أو قرار عميل أو فرق نقدي هيظهر هنا فورًا.</p>
            </div>
          ) : (
            <ul className="divide-y divide-bw-line">
              {shown.map((item) => {
                const Icon = ACTION_ICON[item.type] ?? TriangleAlert
                return (
                  <li key={item.id} className="bw-row flex flex-col gap-2 p-3.5 sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className={cn('grid size-7 shrink-0 place-items-center rounded-bw-field border', SEVERITY_BOX[item.severity])}>
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <span className="font-semibold text-bw-small text-bw-ink truncate">{item.categoryLabel}</span>
                        {item.orderNumber ? (
                          <span className="inline-flex items-center rounded bg-bw-veil-3 px-1.5 py-0.5 text-[11px] font-mono text-bw-ink">
                            <bdi className="bw-code">{item.orderNumber.replace(/^ORD-/, '#')}</bdi>
                          </span>
                        ) : null}
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', SEVERITY_BADGE[item.severity].className)}>
                          {SEVERITY_BADGE[item.severity].label}
                        </span>
                      </div>
                      <Link
                        href={item.actionHref}
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-bw-field border border-bw-line bg-bw-surface px-2.5 text-[11px] font-semibold text-bw-ink shadow-bw-sheen transition-colors hover:border-bw-line-field hover:bg-bw-sunken ms-auto sm:ms-0"
                      >
                        <span>{item.actionLabel}</span>
                        <ArrowLeft className="size-3 text-bw-ink-subtle" aria-hidden />
                      </Link>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 ps-9">
                      <p className="text-[12px] text-bw-ink-soft line-clamp-2">{item.description}</p>
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-bw-ink-subtle">
                        <Clock className="size-3" aria-hidden />
                        <span>{formatRelativeTime(item.createdAt)}</span>
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Horizontal Bar Chart for Order Status Distribution */}
      <section aria-label="توزيع الطلبات حسب الحالة" className="bw-panel p-4 sm:p-5">
        <OrderStatusHorizontalBarChart
          items={distribution?.items ?? []}
          total={distribution?.total ?? 0}
          rangeLabel={rangeLabel}
          loading={initial}
        />
      </section>
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
