'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  HelpCircle,
  Hourglass,
  Layers,
  Package,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
  XCircle,
} from 'lucide-react'
import type { ActionItem, FinancialMetric, OverviewKpiMetric, StageCardData } from './overview-types'
import { Sparkline } from './overview-chart'

/* ── KPI Card Component ──────────────────────────────────────────────── */

export function KpiCard({
  title,
  icon,
  metric,
  unit,
  comparison,
  subtext,
  badge,
  badgeTone = 'neutral',
  loading = false,
}: {
  title: string
  icon: React.ReactNode
  metric?: OverviewKpiMetric
  unit: string
  comparison?: { text: string; changePercent?: number | null }
  subtext?: string
  badge?: string
  badgeTone?: 'neutral' | 'ok' | 'warn' | 'danger'
  loading?: boolean
}) {
  if (loading || !metric) {
    return (
      <div className="flex flex-col justify-between rounded-xl border border-bw-line bg-bw-surface p-4.5 shadow-sm min-h-[136px] animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-4 w-20 rounded bg-bw-sunken" />
          <div className="size-5 rounded bg-bw-sunken" />
        </div>
        <div className="flex items-baseline justify-between mt-3">
          <div className="h-8 w-16 rounded bg-bw-sunken" />
          <div className="h-7 w-20 rounded bg-bw-surface" />
        </div>
        <div className="h-3 w-32 rounded bg-bw-sunken mt-3" />
      </div>
    )
  }

  const toneClasses = {
    neutral: 'bg-bw-sunken text-bw-ink-soft border-bw-line',
    ok: 'bg-bw-ok-soft text-bw-ok border-bw-ok/40',
    warn: 'bg-bw-warn-soft text-bw-warn border-bw-warn/40',
    danger: 'bg-bw-danger-soft text-bw-danger border-bw-danger/40',
  }

  return (
    <div className="group relative flex flex-col justify-between rounded-xl border border-bw-line bg-bw-surface p-4.5 shadow-sm transition-all duration-200 hover:border-bw-line-field hover:bg-bw-sunken">
      {/* Card Header */}
      <div className="flex items-center justify-between text-bw-ink-subtle mb-1">
        <span className="text-xs font-medium text-bw-ink-soft">{title}</span>
        <div className="text-bw-ink-subtle transition-colors group-hover:text-bw-ink">
          {icon}
        </div>
      </div>

      {/* Main Metric & Sparkline */}
      <div className="flex items-baseline justify-between mt-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-3xl font-bold tracking-tight text-bw-ink">
            {metric.count.toLocaleString()}
          </span>
          <span className="text-xs text-bw-ink-subtle font-medium">{unit}</span>
        </div>
        <Sparkline data={metric.sparkline} />
      </div>

      {/* Footer Comparison or Context */}
      <div className="mt-2.5 flex items-center justify-between text-xs text-bw-ink-subtle pt-1.5 border-t border-bw-line">
        {comparison ? (
          <>
            <span className="truncate">{comparison.text}</span>
            {comparison.changePercent !== undefined && comparison.changePercent !== null ? (
              <span
                dir="ltr"
                className={`flex items-center gap-0.5 font-mono text-[11px] font-semibold ${
                  comparison.changePercent > 0
                    ? 'text-bw-ok'
                    : comparison.changePercent < 0
                    ? 'text-bw-danger'
                    : 'text-bw-ink-subtle'
                }`}
              >
                {comparison.changePercent > 0 ? `+${comparison.changePercent}%` : `${comparison.changePercent}%`}
                {comparison.changePercent > 0 ? (
                  <TrendingUp className="size-3" />
                ) : comparison.changePercent < 0 ? (
                  <TrendingDown className="size-3" />
                ) : null}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="truncate text-bw-ink-subtle">{subtext}</span>
            {badge ? (
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                  toneClasses[badgeTone]
                }`}
              >
                {badge}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/* ── Action Required Panel ───────────────────────────────────────────── */

export function ActionRequiredPanel({
  items,
  total,
  criticalCount,
  loading = false,
}: {
  items: ActionItem[]
  total: number
  criticalCount: number
  loading?: boolean
}) {
  const getSeverityDot = (sev: ActionItem['severity']) => {
    switch (sev) {
      case 'critical':
        return <span className="size-1.5 rounded-full bg-bw-danger shrink-0" />
      case 'warning':
        return <span className="size-1.5 rounded-full bg-bw-warn shrink-0" />
      default:
        return <span className="size-1.5 rounded-full bg-bw-info shrink-0" />
    }
  }

  const getCategoryClass = (sev: ActionItem['severity']) => {
    switch (sev) {
      case 'critical':
        return 'text-bw-danger'
      case 'warning':
        return 'text-bw-warn'
      default:
        return 'text-bw-info'
    }
  }

  return (
    <div className="flex flex-col justify-between rounded-xl border border-bw-line bg-bw-surface p-5 shadow-sm transition-all hover:border-bw-line-field">
      {/* Panel Header */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-bw-ink tracking-tight">تحتاج تدخلك</h2>
            <span className="rounded-md border border-bw-line bg-bw-sunken px-2 py-0.5 font-mono text-xs text-bw-ink-soft font-semibold">
              {criticalCount} حرجة
            </span>
          </div>
          <Link
            href="/admin/exceptions"
            className="text-xs text-bw-ink-subtle hover:text-bw-ink transition-colors flex items-center gap-1"
          >
            <span>عرض الكل ({total})</span>
            <ArrowLeft className="size-3.5" />
          </Link>
        </div>
        <p className="text-xs text-bw-ink-subtle mt-1">حالات معطلة تتطلب قراراً تشغيلياً مباشراً</p>
      </div>

      {/* Action Items List */}
      <div className="mt-3.5 space-y-2">
        {loading ? (
          <div className="space-y-2">
            <div className="h-16 rounded-lg bg-bw-surface animate-pulse" />
            <div className="h-16 rounded-lg bg-bw-surface animate-pulse" />
            <div className="h-16 rounded-lg bg-bw-surface animate-pulse" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-bw-line bg-bw-page p-6 text-center">
            <div className="size-8 rounded-full bg-bw-ok-soft flex items-center justify-center text-bw-ok mb-2">
              <CheckCircle2 className="size-4.5" />
            </div>
            <p className="text-xs font-semibold text-bw-ink">لا توجد حالات معطلة تتطلب التدخل حالياً</p>
            <p className="text-[11px] text-bw-ink-subtle mt-0.5">جميع العمليات التشغيلية والتوريد تسير بانتظام</p>
          </div>
        ) : (
          items.map((item, idx) => (
            <div
              key={item.id}
              className="group flex items-center justify-between gap-3 rounded-lg border border-bw-line bg-bw-sunken p-3 transition-colors hover:border-bw-line-field"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  {getSeverityDot(item.severity)}
                  {item.orderNumber ? (
                    <span className="font-mono text-xs font-semibold text-bw-ink">
                      {item.orderNumber}
                    </span>
                  ) : null}
                  <span className={`text-[11px] font-semibold ${getCategoryClass(item.severity)}`}>
                    {item.categoryLabel}
                  </span>
                </div>
                <div className="text-xs text-bw-ink-soft truncate" title={item.description}>
                  {item.description}
                </div>
              </div>
              <Link
                href={item.actionHref}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all active:scale-[0.98] ${
                  idx === 0 && item.severity === 'critical'
                    ? 'bg-bw-action text-bw-on-action hover:bg-bw-action-hover shadow-xs'
                    : 'bg-bw-sunken text-bw-ink hover:bg-bw-sunken hover:text-bw-ink'
                }`}
              >
                {item.actionLabel}
              </Link>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ── Operational Stage Board (5 Cards) ───────────────────────────────── */

export function OperationalStageBoard({
  stageBoard,
  loading = false,
}: {
  stageBoard?: { totalActive: number; stages: StageCardData[] }
  loading?: boolean
}) {
  const stageIcons = {
    awaiting_sourcing: Clock,
    sourcing_receiving: Truck,
    packing_fulfillment: Package,
    out_for_delivery: Truck,
    exceptions_stalled: AlertTriangle,
  }

  if (loading || !stageBoard) {
    return (
      <div className="rounded-xl border border-bw-line bg-bw-surface p-5 shadow-sm space-y-4">
        <div className="h-5 w-48 rounded bg-bw-sunken animate-pulse" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-bw-surface animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-bw-line bg-bw-surface p-5 shadow-sm transition-all hover:border-bw-line-field">
      {/* Header */}
      <div className="flex items-center justify-between pb-3.5 border-b border-bw-line">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-bw-action inline-block" />
          <h3 className="text-base font-semibold text-bw-ink tracking-tight">
            لوحة مسار الطلبات اللحظية
          </h3>
          <span className="rounded-md border border-bw-line bg-bw-sunken px-2 py-0.5 font-mono text-xs text-bw-ink-soft font-semibold">
            {stageBoard.totalActive} طلب نشط في العمليات
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-bw-ink-subtle">
          <span>تحديث لحظي</span>
          <span className="size-1.5 rounded-full bg-bw-ok animate-pulse " />
        </div>
      </div>

      {/* 5 Stage Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-4">
        {stageBoard.stages.map((stg) => {
          const Icon = stageIcons[stg.id] || Layers
          const isFulfillment = stg.id === 'packing_fulfillment'
          const isException = stg.id === 'exceptions_stalled'

          return (
            <Link
              key={stg.id}
              href={stg.href}
              className={`group flex flex-col justify-between rounded-xl border p-3.5 transition-all duration-200 cursor-pointer ${
                isException
                  ? 'border-bw-danger/40 bg-bw-danger-soft hover:border-bw-danger/40 hover:bg-bw-danger-soft'
                  : isFulfillment
                  ? 'border-bw-line bg-bw-surface ring-1 ring-bw-line hover:border-bw-line-field'
                  : 'border-bw-line bg-bw-sunken hover:border-bw-line-field hover:bg-bw-sunken'
              }`}
            >
              {/* Card Top: Icon & Percentage */}
              <div className="flex items-center justify-between mb-2.5">
                <div
                  className={`size-7 rounded-lg flex items-center justify-center transition-colors ${
                    isException
                      ? 'bg-bw-danger-soft text-bw-danger'
                      : isFulfillment
                      ? 'bg-bw-sunken text-bw-ink'
                      : 'bg-bw-sunken text-bw-ink-subtle group-hover:text-bw-ink'
                  }`}
                >
                  <Icon className="size-4" />
                </div>
                <span
                  className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                    isException
                      ? 'bg-bw-danger-soft text-bw-danger border border-bw-danger/40'
                      : isFulfillment
                      ? 'bg-bw-sunken text-bw-ink border border-bw-line'
                      : 'bg-bw-sunken text-bw-ink-subtle border border-bw-line'
                  }`}
                >
                  {stg.percentage}%
                </span>
              </div>

              {/* Card Middle: Count & Labels */}
              <div>
                <div
                  className={`font-mono text-2xl font-bold leading-tight ${
                    isException ? 'text-bw-danger' : 'text-bw-ink'
                  }`}
                >
                  {stg.count.toLocaleString()}
                </div>
                <div
                  className={`text-xs font-semibold mt-0.5 ${
                    isException ? 'text-bw-danger' : 'text-bw-ink'
                  }`}
                >
                  {stg.title}
                </div>
                <div className="text-[11px] text-bw-ink-subtle mt-0.5 truncate">
                  {stg.subtitle}
                </div>
              </div>

              {/* Card Footer: Metadata */}
              <div
                className={`mt-3 pt-2 border-t flex items-center justify-between text-[11px] ${
                  isException
                    ? 'border-bw-danger/40 text-bw-danger'
                    : 'border-bw-line text-bw-ink-subtle'
                }`}
              >
                <span>{stg.footerText}</span>
                <span
                  className={`size-1.5 rounded-full ${
                    isException
                      ? 'bg-bw-danger animate-pulse'
                      : isFulfillment
                      ? 'bg-bw-action'
                      : 'bg-bw-sunken'
                  }`}
                />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

/* ── Financial Summary Section ───────────────────────────────────────── */

export function FinancialSummarySection({
  summary,
  loading = false,
}: {
  summary?: {
    pendingCod: FinancialMetric
    collectedToday: FinancialMetric
    unresolvedVariance: FinancialMetric
    totalReceivedToday: FinancialMetric
  }
  loading?: boolean
}) {
  if (loading || !summary) {
    return (
      <div className="rounded-xl border border-bw-line bg-bw-surface p-5 shadow-sm space-y-4">
        <div className="h-5 w-48 rounded bg-bw-sunken animate-pulse" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="h-24 rounded-xl bg-bw-surface animate-pulse" />
          <div className="h-24 rounded-xl bg-bw-surface animate-pulse" />
          <div className="h-24 rounded-xl bg-bw-surface animate-pulse" />
        </div>
      </div>
    )
  }

  const { pendingCod, collectedToday, unresolvedVariance, totalReceivedToday } = summary

  return (
    <div className="rounded-xl border border-bw-line bg-bw-surface p-5 shadow-sm transition-all hover:border-bw-line-field">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-bw-line">
        <div className="flex items-center gap-2">
          <Wallet className="size-4.5 text-bw-ink-subtle" />
          <h3 className="text-base font-semibold text-bw-ink tracking-tight">المالية والتحصيل</h3>
          <span className="rounded-md border border-bw-line bg-bw-sunken px-2 py-0.5 font-mono text-xs text-bw-ink-soft font-semibold">
            تسوية الصناديق والتحصيل اليومي
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-bw-ink-subtle">
          <span className="size-2 rounded-full bg-bw-ok" />
          <span>تدفقات نقدية مطابقة</span>
        </div>
      </div>

      {/* 3 Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 py-4">
        {/* Metric 1: Pending COD */}
        <div className="rounded-lg border border-bw-line bg-bw-sunken p-3.5 space-y-1 hover:border-bw-line-field transition-colors">
          <div className="flex items-center justify-between text-bw-ink-subtle">
            <span className="text-xs font-medium">COD منتظر التحصيل</span>
            <Clock className="size-3.5 text-bw-ink-subtle" />
          </div>
          <div className="flex items-baseline gap-1 text-2xl font-bold font-mono text-bw-ink">
            <span>{pendingCod.amount.toLocaleString()}</span>
            <span className="text-xs text-bw-ink-subtle font-normal">ج.م</span>
          </div>
          <div className="text-[11px] text-bw-ink-subtle">
            مع المناديب • {pendingCod.shipmentCount ?? 0} شحنة دفع عند الاستلام
          </div>
        </div>

        {/* Metric 2: Collected & Counted Today */}
        <div className="rounded-lg border border-bw-line bg-bw-sunken p-3.5 space-y-1 hover:border-bw-line-field transition-colors">
          <div className="flex items-center justify-between text-bw-ink-subtle">
            <span className="text-xs font-medium">نقد تم استلامه وعدّه</span>
            <CheckCircle2 className="size-3.5 text-bw-ok" />
          </div>
          <div className="flex items-baseline gap-1 text-2xl font-bold font-mono text-bw-ok">
            <span>{collectedToday.amount.toLocaleString()}</span>
            <span className="text-xs text-bw-ink-subtle font-normal">ج.م</span>
          </div>
          <div className="text-[11px] text-bw-ok flex items-center gap-1">
            <span className="size-1 rounded-full bg-bw-ok" />
            تم التوريد لحساب الخزينة ({collectedToday.transactionCount ?? 0} حركة)
          </div>
        </div>

        {/* Metric 3: Unresolved Cash Variances */}
        <div
          className={`rounded-lg border p-3.5 space-y-1 transition-colors ${
            unresolvedVariance.caseCount && unresolvedVariance.caseCount > 0
              ? 'border-bw-danger/40 bg-bw-danger-soft hover:border-bw-danger/40'
              : 'border-bw-line bg-bw-sunken hover:border-bw-line-field'
          }`}
        >
          <div className="flex items-center justify-between text-bw-ink-subtle">
            <span className="text-xs font-medium">فروق نقدية غير محلولة</span>
            {unresolvedVariance.caseCount && unresolvedVariance.caseCount > 0 ? (
              <span className="size-1.5 rounded-full bg-bw-danger animate-pulse" />
            ) : (
              <CheckCircle2 className="size-3.5 text-bw-ink-subtle" />
            )}
          </div>
          <div
            className={`flex items-baseline gap-1 text-2xl font-bold font-mono ${
              unresolvedVariance.caseCount && unresolvedVariance.caseCount > 0
                ? 'text-bw-danger'
                : 'text-bw-ink-soft'
            }`}
          >
            <span dir="ltr">
              {unresolvedVariance.amount === 0
                ? '0'
                : unresolvedVariance.amount > 0
                ? `+${unresolvedVariance.amount.toLocaleString()}`
                : unresolvedVariance.amount.toLocaleString()}
            </span>
            <span className="text-xs text-bw-ink-subtle font-normal">ج.م</span>
          </div>
          <div
            className={`text-[11px] truncate ${
              unresolvedVariance.caseCount && unresolvedVariance.caseCount > 0
                ? 'text-bw-danger'
                : 'text-bw-ink-subtle'
            }`}
          >
            {unresolvedVariance.details ||
              (unresolvedVariance.caseCount && unresolvedVariance.caseCount > 0
                ? `${unresolvedVariance.caseCount} حالات تسوية غير محلولة`
                : 'لا توجد فروق نقدية معلقة')}
          </div>
        </div>
      </div>

      {/* Footer Bar */}
      <div className="pt-2 border-t border-bw-line flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="text-bw-ink-subtle">
          إجمالي الدفعات المقبوضة اليوم: {totalReceivedToday.amount.toLocaleString()} ج.م عبر{' '}
          {totalReceivedToday.transactionCount ?? 0} حركة نقدية وإلكترونية
        </span>
        <Link
          href="/admin/cash"
          className="inline-flex items-center gap-1.5 rounded-lg border border-bw-line bg-bw-surface px-3 py-1.5 font-medium text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink transition-colors"
        >
          <span>الانتقال للمالية والتحصيل</span>
          <ArrowLeft className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}
