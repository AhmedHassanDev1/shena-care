'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  HelpCircle,
  Info,
  Layers,
  Lock,
  Package,
  Scale,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
  XCircle,
} from 'lucide-react'
import { Code, Money } from '@/components/bw/primitives'
import type {
  ActionItem,
  CodFinancialSummary,
  ContributionProfitKpi,
  CountKpiMetric,
  NetRealizedSalesKpi,
  OverviewDays,
  StageCardData,
} from './overview-types'
import { Sparkline } from './overview-chart'

/* ── Shared Helpers ──────────────────────────────────────────────────── */

function periodComparisonLabel(days: OverviewDays): string {
  if (days === 1) return 'مقارنة بالأمس'
  if (days === 7) return 'مقارنة بـ 7 أيام سابقة'
  return 'مقارنة بـ 30 يوم سابقة'
}

function TrendBadge({ changePercent }: { changePercent: number | null | undefined }) {
  if (changePercent === undefined || changePercent === null) return null
  const isUp = changePercent > 0
  const isDown = changePercent < 0
  return (
    <span
      dir="ltr"
      className={`inline-flex items-center gap-0.5 rounded-bw-pill border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
        isUp
          ? 'border-bw-emerald/30 bg-bw-emerald-soft text-bw-emerald'
          : isDown
          ? 'border-bw-rose/30 bg-bw-rose-soft text-bw-rose'
          : 'border-bw-line bg-bw-sunken text-bw-ink-subtle'
      }`}
    >
      {isUp ? `+${changePercent}%` : `${changePercent}%`}
      {isUp ? (
        <TrendingUp className="size-3" aria-hidden />
      ) : isDown ? (
        <TrendingDown className="size-3" aria-hidden />
      ) : null}
    </span>
  )
}

/* ── 4 Prioritized Business KPI Cards ────────────────────────────────── */

function KpiSkeleton() {
  return (
    <div className="flex min-h-[132px] flex-col justify-between rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-3.5 w-24 rounded bg-bw-sunken" />
        <div className="size-4 rounded bg-bw-sunken" />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="h-7 w-24 rounded bg-bw-sunken" />
        <div className="h-7 w-20 rounded bg-bw-sunken" />
      </div>
      <div className="mt-3 h-3 w-36 rounded bg-bw-sunken" />
    </div>
  )
}

export function BusinessKpiGrid({
  days,
  netRealizedSales,
  contributionProfit,
  newOrders,
  completedOrders,
  loading = false,
}: {
  days: OverviewDays
  netRealizedSales?: NetRealizedSalesKpi | null
  contributionProfit?: ContributionProfitKpi | null
  newOrders?: CountKpiMetric
  completedOrders?: CountKpiMetric
  loading?: boolean
}) {
  if (loading || !newOrders || !completedOrders) {
    return (
      <section
        aria-label="المؤشرات الرئيسية للأداء"
        className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </section>
    )
  }

  const prevLabel = periodComparisonLabel(days)

  const missingText = (() => {
    if (!contributionProfit || contributionProfit.status === 'no_data') {
      return 'لا توجد طلبات مسلمة في الفترة المختارة'
    }
    const missingInvoices = contributionProfit.missingComponents.includes('supplier_invoices')
    return missingInvoices
      ? 'ينقصه فواتير الموردين وتكاليف التغليف والتوصيل'
      : 'ينقصه تسجيل تكاليف التغليف ومصاريف التوصيل الفعلية'
  })()

  return (
    <section
      aria-label="المؤشرات الرئيسية للأداء"
      className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
    >
      {/* 1. المبيعات المحققة — Net Realized Sales (Emerald positive revenue) */}
      <article className="group flex flex-col justify-between rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors duration-150 hover:border-bw-emerald/35">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-bw-ink-soft">المبيعات المحققة</span>
          <span className="flex size-7 items-center justify-center rounded-bw-field border border-bw-emerald/20 bg-bw-emerald-soft text-bw-emerald transition-transform duration-150 group-hover:scale-105">
            <Banknote className="size-3.5" aria-hidden />
          </span>
        </div>

        {netRealizedSales === null || netRealizedSales === undefined ? (
          <>
            <div className="my-2 flex items-center gap-2 text-sm font-semibold text-bw-ink-subtle">
              <Lock className="size-4 shrink-0" aria-hidden />
              <span>متاح للإدارة فقط</span>
            </div>
            <div className="border-t border-bw-line pt-2 text-[11px] text-bw-ink-subtle">
              صلاحية الاطلاع المالي مقيدة على مستوى الخادم
            </div>
          </>
        ) : (
          <>
            <div className="my-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-2xl font-bold tracking-tight text-bw-ink">
                  <Money value={netRealizedSales.amount} />
                </div>
                <p className="mt-0.5 text-[11px] text-bw-ink-subtle">
                  صافي البضاعة المسلمة (بعد المرتجعات، دون الشحن)
                </p>
              </div>
              <Sparkline data={netRealizedSales.sparkline} tone="emerald" className="shrink-0" />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-bw-line pt-2 text-[11px] text-bw-ink-subtle">
              <span className="truncate">
                {prevLabel}: <Money value={netRealizedSales.previousAmount} className="text-bw-ink-soft" />
              </span>
              <TrendBadge changePercent={netRealizedSales.changePercent} />
            </div>
          </>
        )}
      </article>

      {/* 2. ربح المساهمة — Contribution Profit (Warm Amber incomplete/provisional guard) */}
      <article className="group flex flex-col justify-between rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors duration-150 hover:border-bw-amber/35">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-bw-ink-soft">ربح المساهمة</span>
          <span className="flex size-7 items-center justify-center rounded-bw-field border border-bw-amber/20 bg-bw-amber-soft text-bw-amber transition-transform duration-150 group-hover:scale-105">
            <Scale className="size-3.5" aria-hidden />
          </span>
        </div>

        {contributionProfit === null || contributionProfit === undefined ? (
          <>
            <div className="my-2 flex items-center gap-2 text-sm font-semibold text-bw-ink-subtle">
              <Lock className="size-4 shrink-0" aria-hidden />
              <span>متاح للإدارة فقط</span>
            </div>
            <div className="border-t border-bw-line pt-2 text-[11px] text-bw-ink-subtle">
              صلاحية الاطلاع المالي مقيدة على مستوى الخادم
            </div>
          </>
        ) : (
          <>
            <div className="my-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-bold text-bw-amber">
                  {contributionProfit.status === 'no_data' ? 'غير متاح حالياً' : 'غير مكتمل البيانات'}
                </span>
                <span className="inline-flex items-center gap-1 rounded-bw-pill border border-bw-amber/25 bg-bw-amber-soft px-2 py-0.5 text-[10px] font-semibold text-bw-amber">
                  <Info className="size-3" aria-hidden />
                  تكاليف ناقصة
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-bw-ink-soft">{missingText}</p>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-bw-line pt-2 text-[11px] text-bw-ink-subtle">
              <span>تغطية فواتير التوريد:</span>
              <span className="font-mono font-semibold text-bw-ink">
                <Code>{`${contributionProfit.coveredOrdersCount}/${contributionProfit.totalDeliveredOrdersCount}`}</Code> طلب
              </span>
            </div>
          </>
        )}
      </article>

      {/* 3. الطلبات الجديدة — New Orders (Cobalt Blue primary activity) */}
      <article className="group flex flex-col justify-between rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors duration-150 hover:border-bw-cobalt/35">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-bw-ink-soft">الطلبات الجديدة</span>
          <span className="flex size-7 items-center justify-center rounded-bw-field border border-bw-cobalt/20 bg-bw-cobalt-soft text-bw-cobalt transition-transform duration-150 group-hover:scale-105">
            <ShoppingBag className="size-3.5" aria-hidden />
          </span>
        </div>

        <div className="my-2 flex items-center justify-between gap-2">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-bold tracking-tight text-bw-ink">
                <Code>{newOrders.count.toLocaleString('en-US')}</Code>
              </span>
              <span className="text-xs text-bw-ink-subtle">طلب</span>
            </div>
            <p className="mt-0.5 text-[11px] text-bw-ink-subtle">الواردة خلال الفترة المختارة</p>
          </div>
          <Sparkline data={newOrders.sparkline} tone="cobalt" className="shrink-0" />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-bw-line pt-2 text-[11px] text-bw-ink-subtle">
          <span className="truncate">
            {prevLabel}: <Code className="text-bw-ink-soft">{newOrders.previousCount.toLocaleString('en-US')}</Code>
          </span>
          <TrendBadge changePercent={newOrders.changePercent} />
        </div>
      </article>

      {/* 4. الطلبات المكتملة — Completed Orders (Emerald verified fulfillment) */}
      <article className="group flex flex-col justify-between rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors duration-150 hover:border-bw-emerald/35">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-bw-ink-soft">الطلبات المكتملة</span>
          <span className="flex size-7 items-center justify-center rounded-bw-field border border-bw-emerald/20 bg-bw-emerald-soft text-bw-emerald transition-transform duration-150 group-hover:scale-105">
            <CheckCircle2 className="size-3.5" aria-hidden />
          </span>
        </div>

        <div className="my-2 flex items-center justify-between gap-2">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-bold tracking-tight text-bw-ink">
                <Code>{completedOrders.count.toLocaleString('en-US')}</Code>
              </span>
              <span className="text-xs text-bw-ink-subtle">مكتمل</span>
            </div>
            <p className="mt-0.5 text-[11px] text-bw-ink-subtle">
              {completedOrders.completionRate !== null && completedOrders.completionRate !== undefined ? (
                <>
                  نسبة الإتمام من المنتهية: <Code className="font-semibold text-bw-emerald">{completedOrders.completionRate}%</Code>
                </>
              ) : (
                'تم تسليمها بنجاح للعملاء'
              )}
            </p>
          </div>
          <Sparkline data={completedOrders.sparkline} tone="emerald" className="shrink-0" />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-bw-line pt-2 text-[11px] text-bw-ink-subtle">
          <span className="truncate">
            {prevLabel}: <Code className="text-bw-ink-soft">{completedOrders.previousCount.toLocaleString('en-US')}</Code>
          </span>
          <TrendBadge changePercent={completedOrders.changePercent} />
        </div>
      </article>
    </section>
  )
}

/* ── Compact Horizontal Operational Workflow ─────────────────────────── */

export function CompactWorkflowStrip({
  stageBoard,
  loading = false,
}: {
  stageBoard?: { totalActive: number; stages: StageCardData[] }
  loading?: boolean
}) {
  const stageMeta: Record<
    StageCardData['id'],
    { icon: React.ElementType; barClass: string; iconClass: string; hoverClass: string }
  > = {
    awaiting_sourcing: {
      icon: Clock,
      barClass: 'bg-bw-amber',
      iconClass: 'text-bw-amber',
      hoverClass: 'hover:border-bw-amber/35',
    },
    sourcing_receiving: {
      icon: Layers,
      barClass: 'bg-bw-cobalt',
      iconClass: 'text-bw-cobalt',
      hoverClass: 'hover:border-bw-cobalt/35',
    },
    packing_fulfillment: {
      icon: Package,
      barClass: 'bg-bw-violet/70',
      iconClass: 'text-bw-violet',
      hoverClass: 'hover:border-bw-violet/35',
    },
    out_for_delivery: {
      icon: Truck,
      barClass: 'bg-bw-violet',
      iconClass: 'text-bw-violet',
      hoverClass: 'hover:border-bw-violet/40',
    },
    exceptions_stalled: {
      icon: AlertTriangle,
      barClass: 'bg-bw-rose',
      iconClass: 'text-bw-rose',
      hoverClass: 'hover:border-bw-rose/35',
    },
  }

  if (loading || !stageBoard) {
    return (
      <section
        aria-label="مسار العمليات اللحظي"
        className="rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card animate-pulse space-y-3"
      >
        <div className="h-4 w-44 rounded bg-bw-sunken" />
        <div className="h-2 w-full rounded-full bg-bw-sunken" />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 rounded-bw-field bg-bw-sunken" />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section
      aria-label="مسار العمليات اللحظي"
      className="rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card transition-colors"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-bw-emerald animate-pulse" aria-hidden />
          <h2 className="text-sm font-semibold text-bw-ink">مسار العمليات اللحظي</h2>
          <span className="rounded-bw-pill border border-bw-cobalt/25 bg-bw-cobalt-soft px-2.5 py-0.5 text-[11px] font-semibold text-bw-cobalt">
            <Code>{stageBoard.totalActive.toLocaleString('en-US')}</Code> قيد التنفيذ
          </span>
        </div>
        <span className="text-[11px] text-bw-ink-subtle">اضغط على أي مرحلة لعرض السجلات المصفاة</span>
      </div>

      {/* Unified Horizontal Segmented Progress Bar */}
      <div
        className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-bw-sunken"
        aria-hidden
      >
        {stageBoard.totalActive === 0 ? (
          <div className="h-full w-full bg-bw-sunken" />
        ) : (
          stageBoard.stages
            .filter((s) => s.count > 0)
            .map((stg) => (
              <div
                key={stg.id}
                className={`${stageMeta[stg.id].barClass} h-full border-e border-bw-surface last:border-e-0 transition-all duration-300`}
                style={{ width: `${Math.max(stg.percentage, 2)}%` }}
              />
            ))
        )}
      </div>

      {/* 5 Compact Horizontal Stage Tiles */}
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {stageBoard.stages.map((stg) => {
          const meta = stageMeta[stg.id]
          const Icon = meta.icon
          const isException = stg.id === 'exceptions_stalled' && stg.count > 0

          return (
            <Link
              key={stg.id}
              href={stg.href}
              className={`group flex flex-col justify-between rounded-bw-field border p-3 transition-colors duration-150 ${
                isException
                  ? 'border-bw-line border-s-2 border-s-bw-rose bg-bw-sunken/70 hover:border-bw-rose/40 hover:bg-bw-sunken'
                  : `border-bw-line bg-bw-sunken/55 hover:bg-bw-sunken ${meta.hoverClass}`
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-bw-ink truncate">
                  <Icon
                    className={`size-3.5 shrink-0 transition-transform duration-150 group-hover:scale-105 ${meta.iconClass}`}
                    aria-hidden
                  />
                  <span className="truncate">{stg.title}</span>
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-bw-ink-subtle">
                  <span className={`size-1.5 rounded-full ${meta.barClass}`} aria-hidden />
                  <Code>{stg.percentage}%</Code>
                </span>
              </div>

              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span
                  className={`font-mono text-xl font-bold leading-none ${
                    isException ? 'text-bw-rose' : 'text-bw-ink'
                  }`}
                >
                  <Code>{stg.count.toLocaleString('en-US')}</Code>
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-bw-ink-subtle transition-colors group-hover:text-bw-ink">
                  <span className="truncate">{stg.footerText}</span>
                  <ArrowLeft className="size-3 shrink-0 transition-transform duration-150 group-hover:-translate-x-0.5" aria-hidden />
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

/* ── Action Required Panel (Top 3 Deduplicated Cases) ────────────────── */

function getTypeIcon(type: ActionItem['type'], severity: ActionItem['severity']) {
  const iconClass = 'size-3.5'
  const wrapCls = `flex size-6 shrink-0 items-center justify-center rounded-md ${
    severity === 'critical'
      ? 'bg-bw-rose-soft text-bw-rose'
      : severity === 'warning'
      ? 'bg-bw-amber-soft text-bw-amber'
      : 'bg-bw-cobalt-soft text-bw-cobalt'
  }`
  const icon = (() => {
    switch (type) {
      case 'supply_shortage':   return <Package className={iconClass} aria-hidden />
      case 'customer_decision': return <HelpCircle className={iconClass} aria-hidden />
      case 'failed_delivery':   return <XCircle className={iconClass} aria-hidden />
      case 'cash_variance':     return <Wallet className={iconClass} aria-hidden />
      case 'support_case':      return <AlertTriangle className={iconClass} aria-hidden />
      default:                  return <AlertTriangle className={iconClass} aria-hidden />
    }
  })()
  return <span className={wrapCls}>{icon}</span>
}

export function ActionRequiredPanel({
  items,
  totalIssues,
  affectedOrdersCount,
  standaloneCasesCount,
  criticalCount,
  loading = false,
}: {
  items: ActionItem[]
  totalIssues: number
  affectedOrdersCount: number
  standaloneCasesCount: number
  criticalCount: number
  loading?: boolean
}) {
  const getCategoryClass = (sev: ActionItem['severity']) => {
    switch (sev) {
      case 'critical': return 'text-bw-rose'
      case 'warning':  return 'text-bw-amber'
      default:         return 'text-bw-cobalt'
    }
  }

  return (
    <section
      aria-label="قرارات تحتاج متابعة"
      className="flex flex-col rounded-bw-card border border-bw-line bg-bw-surface p-5 shadow-bw-card transition-colors"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-bw-heading font-semibold text-bw-ink">قرارات تحتاج متابعة</h2>
          {criticalCount > 0 ? (
            <span className="rounded-bw-pill border border-bw-rose/25 bg-bw-rose-soft px-2 py-0.5 text-[11px] font-semibold text-bw-rose">
              <Code>{criticalCount}</Code> حرجة
            </span>
          ) : null}
        </div>
        <Link
          href="/admin/exceptions"
          className="group inline-flex items-center gap-1 text-xs font-semibold text-bw-cobalt transition-colors hover:text-bw-ink"
        >
          <span>عرض الكل (<Code>{totalIssues}</Code>)</span>
          <ArrowLeft className="size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" aria-hidden />
        </Link>
      </div>

      {/* Distinct counts: issues vs unique affected orders */}
      <p className="mt-1 text-xs text-bw-ink-subtle">
        {totalIssues === 0 ? (
          'لا توجد مشكلات مفتوحة حالياً'
        ) : (
          <>
            <Code className="font-semibold text-bw-ink">{totalIssues}</Code> تنبيه مفتوح عبر{' '}
            <Code className="font-semibold text-bw-ink">{affectedOrdersCount}</Code> طلب فريد
            {standaloneCasesCount > 0 ? (
              <> · <Code>{standaloneCasesCount}</Code> حالة عامة</>
            ) : null}
          </>
        )}
      </p>

      <div className="mt-3.5 space-y-2">
        {loading ? (
          <div className="space-y-2">
            <div className="h-14 rounded-bw-field bg-bw-sunken animate-pulse" />
            <div className="h-14 rounded-bw-field bg-bw-sunken animate-pulse" />
            <div className="h-14 rounded-bw-field bg-bw-sunken animate-pulse" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-bw-field border border-bw-line bg-bw-page px-4 py-6 text-center">
            <div className="mb-2 flex size-8 items-center justify-center rounded-full border border-bw-emerald/25 bg-bw-emerald-soft text-bw-emerald">
              <CheckCircle2 className="size-4" aria-hidden />
            </div>
            <p className="text-xs font-semibold text-bw-ink">كل شيء يسير بانتظام</p>
            <p className="mt-0.5 text-[11px] text-bw-ink-subtle">
              لا توجد استثناءات توريد أو توصيل أو تحصيل تستدعي التدخل
            </p>
          </div>
        ) : (
          items.slice(0, 3).map((item, idx) => (
            <div
              key={item.id}
              className={`flex items-center justify-between gap-3 rounded-bw-field border border-bw-line border-s-2 p-3 transition-colors duration-150 bg-bw-sunken/55 hover:bg-bw-sunken ${
                item.severity === 'critical'
                  ? 'border-s-bw-rose hover:border-bw-rose/35'
                  : item.severity === 'warning'
                  ? 'border-s-bw-amber hover:border-bw-amber/35'
                  : 'border-s-bw-cobalt hover:border-bw-cobalt/35'
              }`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {getTypeIcon(item.type, item.severity)}
                  {item.orderNumber ? (
                    <Code className="font-mono text-xs font-semibold text-bw-ink">
                      {item.orderNumber}
                    </Code>
                  ) : null}
                  <span className={`text-[11px] font-semibold ${getCategoryClass(item.severity)}`}>
                    {item.categoryLabel}
                  </span>
                  {item.relatedIssueCount && item.relatedIssueCount > 0 ? (
                    <span className="rounded-bw-pill border border-bw-line bg-bw-surface px-1.5 py-0.5 text-[10px] text-bw-ink-subtle">
                      +<Code>{item.relatedIssueCount}</Code> إضافي
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-bw-ink-soft" title={item.description}>
                  {item.description}
                </p>
              </div>
              <Link
                href={item.actionHref}
                className={`shrink-0 rounded-bw-field px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
                  idx === 0 && item.severity === 'critical'
                    ? 'bg-bw-cobalt text-bw-page hover:brightness-110'
                    : 'border border-bw-line bg-bw-surface text-bw-ink hover:border-bw-cobalt/40 hover:text-bw-cobalt'
                }`}
              >
                {item.actionLabel}
              </Link>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/* ── Simplified COD & Discrepancy Indicator ──────────────────────────── */

export function CodStatusCard({
  summary,
  loading = false,
}: {
  summary: CodFinancialSummary | null | undefined
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="rounded-bw-card border border-bw-line bg-bw-surface p-4 shadow-bw-card animate-pulse space-y-3">
        <div className="h-4 w-40 rounded bg-bw-sunken" />
        <div className="h-14 rounded-bw-field bg-bw-sunken" />
        <div className="h-10 rounded-bw-field bg-bw-sunken" />
      </div>
    )
  }

  if (!summary) return null

  const { unresolvedVariance, pendingCod } = summary
  const hasVariance = unresolvedVariance.caseCount > 0

  return (
    <section
      aria-label="حالة التحصيل والفروق النقدية"
      className="flex flex-col justify-between rounded-bw-card border border-bw-line bg-bw-surface p-5 shadow-bw-card transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-bw-field border border-bw-cobalt/20 bg-bw-cobalt-soft text-bw-cobalt">
            <Wallet className="size-3.5" aria-hidden />
          </span>
          <h3 className="text-sm font-semibold text-bw-ink">مراقبة التحصيل النقدي (COD)</h3>
        </div>
        <Link
          href="/admin/cash"
          className="group inline-flex items-center gap-1 text-xs font-semibold text-bw-cobalt transition-colors hover:text-bw-ink"
        >
          <span>المالية</span>
          <ArrowLeft className="size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" aria-hidden />
        </Link>
      </div>

      {/* Primary Signal: Unresolved Collection Discrepancies */}
      <div
        className={`mt-3 rounded-bw-field border border-bw-line p-3.5 bg-bw-sunken/55 ${
          hasVariance ? 'border-s-2 border-s-bw-rose' : 'border-s-2 border-s-bw-emerald'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-bw-ink-soft">فروق تحصيل غير محلولة</span>
          {hasVariance ? (
            <span className="rounded-bw-pill border border-bw-rose/25 bg-bw-rose-soft px-2 py-0.5 text-[11px] font-semibold text-bw-rose">
              <Code>{unresolvedVariance.caseCount}</Code> حالة
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-bw-pill border border-bw-emerald/25 bg-bw-emerald-soft px-2 py-0.5 text-[11px] font-semibold text-bw-emerald">
              <CheckCircle2 className="size-3" aria-hidden />
              متطابق
            </span>
          )}
        </div>

        <div
          className={`mt-1.5 font-mono text-xl font-bold ${
            hasVariance ? 'text-bw-rose' : 'text-bw-ink'
          }`}
        >
          <span dir="ltr">
            {unresolvedVariance.amount === 0
              ? '0'
              : unresolvedVariance.amount > 0
              ? `+${unresolvedVariance.amount.toLocaleString('en-US')}`
              : unresolvedVariance.amount.toLocaleString('en-US')}
          </span>{' '}
          <span className="text-xs font-normal text-bw-ink-subtle">ج.م</span>
        </div>

        <p className={`mt-1 truncate text-[11px] ${hasVariance ? 'text-bw-rose' : 'text-bw-ink-subtle'}`}>
          {unresolvedVariance.details ?? 'لا توجد فروق نقدية معلقة بين المندوب والخزينة'}
        </p>
      </div>

      {/* Secondary Context: COD Awaiting Settlement (explicitly distinct from sales/profit) */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-bw-line pt-3 text-xs">
        <div className="min-w-0">
          <p className="font-medium text-bw-ink-soft">نقدية قيد التحصيل مع المناديب</p>
          <p className="text-[11px] text-bw-ink-subtle">
            عهدة تحصيل (<Code>{pendingCod.shipmentCount}</Code> شحنة) · ليست ربحاً
          </p>
        </div>
        <div className="shrink-0 font-mono font-semibold text-bw-ink">
          <Money value={pendingCod.amount} />
        </div>
      </div>
    </section>
  )
}
