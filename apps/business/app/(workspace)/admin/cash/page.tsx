'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Filter,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react'
import { Code, DataTable, PageHeader, Section, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Egp, Page, Select, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell, useMe } from '@/components/workspace/role-shell'
import { COLLECTION_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

interface Collection {
  orderId: string
  orderNumber: string
  orderStatus: string
  locationId: string | null
  courierId: string | null
  status: string
  expectedAmount: string
  declaredAmount: string | null
  countedAmount: string | null
  variance: string | null
  settlementBatchId: string | null
  updatedAt: string
}

interface Batch {
  id: string
  reference: string
  courierId: string
  locationId: string | null
  totalExpected: string
  totalCollected: string
  netSettled: string
  settledAt: string
  actorId: string
}

export default function AdminCash() {
  return (
    <RoleShell role="admin" active="cod" mode="desktop">
      <CashBody />
    </RoleShell>
  )
}

function CashBody() {
  const me = useMe()
  const [status, setStatus] = React.useState('')
  const [financialPrivacy, setFinancialPrivacy] = React.useState(false)
  const [isExporting, setIsExporting] = React.useState(false)

  const collections = useApi<{ total: number; items: Collection[] }>(
    `/ordering/settlements/collections?take=100${status ? `&status=${status}` : ''}`,
    { pollMs: 30000 }
  )
  const batches = useApi<{ total: number; items: Batch[] }>('/ordering/settlements/batches?take=50')
  const drivers = useApi<Array<{ id: string; name: string }>>('/workspace/drivers')
  const driverName = new Map((drivers.data ?? []).map((d) => [d.id, d.name]))
  const hubName = new Map(me.hubLocations.map((h) => [h.id, h.name]))

  // Computed summary totals
  const totalExpected = (collections.data?.items ?? []).reduce(
    (acc, c) => acc + (Number(c.expectedAmount) || 0),
    0
  )
  const totalCounted = (collections.data?.items ?? []).reduce(
    (acc, c) => acc + (Number(c.countedAmount) || 0),
    0
  )
  const varianceItems = (collections.data?.items ?? []).filter(
    (c) => c.variance && Number(c.variance) !== 0
  )

  const handleExportCsv = () => {
    setIsExporting(true)
    setTimeout(() => {
      const items = collections.data?.items ?? []
      const headers = ['OrderNumber', 'Driver', 'Expected', 'Declared', 'Counted', 'Variance', 'Status', 'UpdatedAt']
      const rows = items.map((c) => [
        c.orderNumber,
        driverName.get(c.courierId ?? '') ?? c.courierId ?? '',
        c.expectedAmount,
        c.declaredAmount ?? '',
        c.countedAmount ?? '',
        c.variance ?? '0',
        c.status,
        c.updatedAt,
      ])
      const csvContent =
        'data:text/csv;charset=utf-8,\uFEFF' +
        [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
      const encodedUri = encodeURI(csvContent)
      const link = document.createElement('a')
      link.setAttribute('href', encodedUri)
      link.setAttribute('download', `shinacare-cod-settlements-${new Date().toISOString().slice(0, 10)}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setIsExporting(false)
    }, 400)
  }

  return (
    <Page>
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="sc-badge t-success flex items-center gap-1.5">
              <Wallet className="size-3.5" />
              الرقابة المالية والتسويات النقدية
            </span>
            <span className="text-xs text-bw-ink-soft">
              تسوية نقدية طلبات الدفع عند الاستلام (COD)
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            المالية والتحصيل
            {collections.data && (
              <span className="sc-badge font-mono text-sm bg-white/[0.06] text-emerald-400 border-white/10">
                {collections.data.total} تحصيل مسجل
              </span>
            )}
          </h1>
          <p className="text-xs text-bw-ink-soft mt-1 leading-relaxed max-w-3xl">
            متابعة حركة النقدية المحصلة من المناديب: التحصيل المتوقع ← إقرار المندوب في التطبيق ← العدّ الفعلي في خزينة مخزن المعادي ← الإيداع والتسوية النهائية.
          </p>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2">
          {/* Privacy Toggle */}
          <button
            type="button"
            onClick={() => setFinancialPrivacy((p) => !p)}
            className="sc-btn md secondary flex items-center gap-2 cursor-pointer"
            title={financialPrivacy ? 'إظهار المبالغ المالية' : 'إخفاء المبالغ المالية (وضع الخصوصية)'}
          >
            {financialPrivacy ? (
              <>
                <EyeOff className="size-4 text-bw-ink-muted" />
                <span className="text-xs">المبالغ مخفية</span>
              </>
            ) : (
              <>
                <Eye className="size-4 text-emerald-400" />
                <span className="text-xs">وضع الخصوصية</span>
              </>
            )}
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={isExporting || !collections.data?.items.length}
            className="sc-btn md secondary flex items-center gap-2 cursor-pointer disabled:opacity-40"
          >
            <Download className="size-4 text-emerald-400" />
            <span className="text-xs">تصدير للمحاسبة (CSV)</span>
          </button>

          {/* Reload */}
          <button
            type="button"
            onClick={() => {
              collections.reload()
              batches.reload()
            }}
            disabled={collections.loading}
            className="sc-btn md secondary flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className={cn('size-4 text-emerald-400', collections.loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Financial Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 my-4">
        {/* Total Expected */}
        <div className="sc-card p-4 space-y-1 border-white/[0.08] bg-bw-surface">
          <div className="text-xs text-bw-ink-soft">إجمالي التحصيل المتوقع</div>
          <div
            className={cn(
              'text-2xl font-bold font-mono text-white transition-all',
              financialPrivacy && 'blur-md select-none'
            )}
          >
            <Egp value={totalExpected} />
          </div>
          <div className="text-[11px] text-bw-ink-muted">عن إجمالي الشحنات الموزعة</div>
        </div>

        {/* Counted at Hub */}
        <div className="sc-card p-4 space-y-1 border-emerald-500/20 bg-emerald-500/[0.03]">
          <div className="text-xs text-emerald-400">النقد المعتمد والمعدود</div>
          <div
            className={cn(
              'text-2xl font-bold font-mono text-emerald-400 transition-all',
              financialPrivacy && 'blur-md select-none'
            )}
          >
            <Egp value={totalCounted} />
          </div>
          <div className="text-[11px] text-bw-ink-muted">تم استلامه في خزينة المعادي</div>
        </div>

        {/* Variances */}
        <div
          className={cn(
            'sc-card p-4 space-y-1 transition-all',
            varianceItems.length > 0
              ? 'border-red-500/20 bg-red-500/[0.04]'
              : 'border-white/[0.08] bg-bw-surface'
          )}
        >
          <div className="flex items-center justify-between text-xs text-bw-ink-soft">
            <span>فروق وعجز التحصيل</span>
            {varianceItems.length > 0 && <AlertTriangle className="size-3.5 text-[#fb7185]" />}
          </div>
          <div className="text-2xl font-bold font-mono text-[#fb7185]">
            {varianceItems.length}
          </div>
          <div className="text-[11px] text-bw-ink-muted">
            {varianceItems.length > 0 ? (
              <Link href="/admin/exceptions" className="text-amber-400 hover:underline">
                تتطلب تحقيقاً في مركز الاستثناءات ←
              </Link>
            ) : (
              'تطابق تام بدون فروق'
            )}
          </div>
        </div>

        {/* Settled Batches */}
        <div className="sc-card p-4 space-y-1 border-white/[0.08] bg-bw-surface">
          <div className="text-xs text-bw-ink-soft">دفعات التسوية المقفلة</div>
          <div className="text-2xl font-bold font-mono text-white">
            {batches.data?.total ?? 0}
          </div>
          <div className="text-[11px] text-bw-ink-muted">أقفلت بالخزينة وإيصال التسليم</div>
        </div>
      </div>

      {/* Discrepancy Warning Callout if needed */}
      {varianceItems.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-red-500/25 bg-red-500/[0.05]">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-red-500/15 text-[#fb7185] flex items-center justify-center shrink-0">
              <ShieldAlert className="size-4.5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white">يوجد {varianceItems.length} حالات عدم تطابق في نقدية المندوب</h4>
              <p className="text-[11px] text-bw-ink-soft">
                الفروق المالية بين إقرار المندوب والعدّ الفعلي تتطلب مراجعة إدارية وتدوين تسوية استثنائية.
              </p>
            </div>
          </div>
          <Link
            href="/admin/exceptions"
            className="sc-btn sm secondary shrink-0 flex items-center gap-1.5 text-xs text-[#fb7185]"
          >
            <span>مراجعة الاستثناءات المالية</span>
          </Link>
        </div>
      )}

      {/* Collections Section */}
      <Section
        title="حركة التحصيلات النقدية"
        aside={
          <Select
            className="w-56"
            label="الحالة"
            value={status}
            onChange={setStatus}
            options={[
              ['', 'كافة الحالات'],
              ...Object.entries(COLLECTION_STATUS).map(([k, [t]]) => [k, t] as [string, string]),
            ]}
          />
        }
      >
        {collections.error ? <LoadError message={collections.error.message} onRetry={collections.reload} /> : null}
        {!collections.data && collections.loading ? <Skeleton className="h-40 w-full rounded-xl" /> : null}
        {collections.data && collections.data.items.length === 0 ? (
          <StateBlock
            kind="empty"
            title="لا توجد تحصيلات مسجلة"
            body="يتم تسجيل حركة التحصيل المتوقعة تلقائياً بمجرد خروج شحنة الطلب مع المندوب من المخزن."
          />
        ) : null}

        {collections.data?.items.length ? (
          <div
            className={cn(
              'sc-card overflow-hidden border-white/[0.08] bg-bw-surface shadow-xl transition-all',
              financialPrivacy && '[&_td:nth-child(4)]:blur-md [&_td:nth-child(5)]:blur-md [&_td:nth-child(6)]:blur-md [&_td:nth-child(7)]:blur-md'
            )}
          >
            <DataTable
              caption="التحصيلات"
              head={['الطلب', 'المخزن', 'المندوب', 'متوقع', 'إقرار المندوب', 'العدّ بالخزينة', 'الفرق', 'الحالة', 'آخر تحديث']}
            >
              {collections.data.items.map((c) => {
                const hasVariance = c.variance && Number(c.variance) !== 0

                return (
                  <tr key={c.orderId} className="hover:bg-white/[0.02] transition-colors">
                    <td>
                      <Link className="font-mono font-bold text-emerald-400 underline" href={`/admin/orders/${c.orderId}`}>
                        <Code>{c.orderNumber}</Code>
                      </Link>
                    </td>
                    <td>{c.locationId ? hubName.get(c.locationId) ?? shortId(c.locationId) : 'المعادي'}</td>
                    <td>{c.courierId ? driverName.get(c.courierId) ?? shortId(c.courierId) : '—'}</td>
                    <td className="font-mono font-semibold text-white">
                      <Egp value={c.expectedAmount} />
                    </td>
                    <td className="font-mono text-bw-ink-soft">
                      <Egp value={c.declaredAmount} />
                    </td>
                    <td className="font-mono text-white">
                      <Egp value={c.countedAmount} />
                    </td>
                    <td>
                      {hasVariance ? (
                        <span className="font-mono font-bold text-[#fb7185] bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                          <Egp value={c.variance} />
                        </span>
                      ) : (
                        <span className="font-mono text-bw-ink-soft">
                          <Egp value={c.variance ?? 0} />
                        </span>
                      )}
                    </td>
                    <td>
                      <Status map={COLLECTION_STATUS} value={c.status} />
                    </td>
                    <td className="text-bw-small text-bw-ink-soft">{formatDateTime(c.updatedAt)}</td>
                  </tr>
                )
              })}
            </DataTable>
          </div>
        ) : null}
      </Section>

      {/* Settlement Batches Section */}
      <Section title="دفعات التسوية وإغلاق الخزينة">
        {batches.data && batches.data.items.length === 0 ? (
          <p className="text-bw-small text-bw-ink-soft">لا توجد دفعات تسوية مقفلة بعد.</p>
        ) : null}
        {batches.data?.items.length ? (
          <div
            className={cn(
              'sc-card overflow-hidden border-white/[0.08] bg-bw-surface shadow-xl transition-all',
              financialPrivacy && '[&_td:nth-child(4)]:blur-md [&_td:nth-child(5)]:blur-md [&_td:nth-child(6)]:blur-md'
            )}
          >
            <DataTable
              caption="التسويات"
              head={['رقم المرجع', 'المخزن', 'المندوب', 'المتوقع', 'المعدود الفعلي', 'الصافي المسوى', 'وقت التسوية']}
            >
              {batches.data.items.map((b) => (
                <tr key={b.id} className="hover:bg-white/[0.02] transition-colors">
                  <td>
                    <Code>{b.reference}</Code>
                  </td>
                  <td>{b.locationId ? hubName.get(b.locationId) ?? shortId(b.locationId) : 'المعادي'}</td>
                  <td>{driverName.get(b.courierId) ?? shortId(b.courierId)}</td>
                  <td className="font-mono text-bw-ink-soft">
                    <Egp value={b.totalExpected} />
                  </td>
                  <td className="font-mono text-white">
                    <Egp value={b.totalCollected} />
                  </td>
                  <td className="font-mono font-bold text-emerald-400">
                    <Egp value={b.netSettled} />
                  </td>
                  <td className="text-bw-small text-bw-ink-soft">{formatDateTime(b.settledAt)}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        ) : null}
      </Section>
    </Page>
  )
}
