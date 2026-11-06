'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Store,
  Tag,
  X,
  XCircle,
} from 'lucide-react'
import { Button, Code, Notice, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { CommandError, Egp } from '@/components/workspace/kit'
import { SourceRowOutcomes } from '@/components/workspace/source-rows'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import type { CommitJobResult, JobDiffSummary } from '../page'

export interface IngestionJobDetail {
  id: string
  supplierId: string
  status: string
  mode: string
  sourceKey: string | null
  sourceChecksum: string | null
  formatFingerprint: string | null
  profileId: string | null
  createdAt: string
  updatedAt: string
  items: Array<{
    id: string
    supplierSkuCode: string
    name: string
    brand: string
    barcode: string | null
    price: number
    priceType: string | null
    reportedQuantity: number | null
    currency: string
    status: string
    rejectionReason: string | null
  }>
}

export default function SupplierJobDetailPage() {
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : ''

  // Fetch job metadata
  const jobApi = useApi<IngestionJobDetail>(id ? `/ingestion/jobs/${id}` : null)

  // Fetch job diff
  const diffApi = useApi<JobDiffSummary>(id ? `/ingestion/jobs/${id}/diff` : null)

  const [filterAction, setFilterAction] = React.useState<'all' | 'changes' | 'candidates' | 'errors'>('all')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [commitResult, setCommitResult] = React.useState<CommitJobResult | null>(null)

  const diff = diffApi.data
  const job = jobApi.data

  // Commit Command
  const commit = useCommand(async () => {
    if (!id) return null
    const res = await api<CommitJobResult>(`/ingestion/jobs/${id}/commit-offers`, {
      method: 'POST',
      body: {
        autoApplyLowRisk: true,
        declaredCompleteAssortment: job?.mode === 'FULL_SNAPSHOT',
      },
    })
    setCommitResult(res)
    jobApi.reload()
    diffApi.reload()
    return res
  })

  // Filtered diff rows
  const filteredRows = React.useMemo(() => {
    if (!diff) return []
    return diff.rows.filter((row) => {
      if (filterAction === 'changes' && !['UPDATE', 'CREATE'].includes(row.action)) return false
      if (filterAction === 'candidates' && row.action !== 'SKIP') return false
      if (filterAction === 'errors' && row.action !== 'ERROR') return false

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const matchesName = row.productName.toLowerCase().includes(q)
        const matchesSku = row.supplierSkuCode.toLowerCase().includes(q)
        const matchesCanonical = row.canonicalSkuCode?.toLowerCase().includes(q)
        if (!matchesName && !matchesSku && !matchesCanonical) return false
      }
      return true
    })
  }, [diff, filterAction, searchQuery])

  return (
    <RoleShell role="supplier" active="updates" mode="responsive">
      <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <Link
            href="/supplier/updates/history"
            className="inline-flex items-center gap-1.5 text-xs text-bw-ink-soft transition-colors hover:text-bw-ink"
          >
            <ArrowRight className="size-4" />
            <span>العودة إلى سجل التحديثات</span>
          </Link>

          <Link
            href="/supplier/updates"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-bw-ok hover:text-bw-ok"
          >
            <span>رفع ملف جديد</span>
          </Link>
        </div>

        {jobApi.error ? <LoadError message={jobApi.error.message} onRetry={jobApi.reload} /> : null}

        {jobApi.loading && !job ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : null}

        {job ? (
          <div className="space-y-6">
            {/* Job Header */}
            <div className="rounded-2xl border border-bw-line bg-bw-surface p-5 sm:p-6 space-y-4 shadow-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-bw-ink text-base">
                      عملية استيراد #{shortId(job.id)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        job.status === 'completed' || job.status === 'published'
                          ? 'bg-bw-ok-soft text-bw-ok border border-bw-ok/40'
                          : job.status === 'review_required'
                          ? 'bg-bw-warn-soft text-bw-warn border border-bw-warn/40'
                          : 'bg-bw-info-soft text-bw-info border border-bw-info/40'
                      }`}
                    >
                      {job.status === 'completed' || job.status === 'published'
                        ? 'مكتمل ومعتمد'
                        : job.status === 'review_required'
                        ? 'بانتظار المراجعة'
                        : 'قيد المعالجة'}
                    </span>
                  </div>
                  <p className="text-xs text-bw-ink-subtle">
                    نمط العملية:{' '}
                    <span className="text-bw-ink font-semibold">
                      {job.mode === 'FULL_SNAPSHOT' ? 'لقطة كاملة للتشكيلة' : 'تحديث جزئي'}
                    </span>{' '}
                    · تم الرفع: <span className="font-mono">{formatDateTime(job.createdAt)}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      jobApi.reload()
                      diffApi.reload()
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-bw-line bg-bw-surface px-3 text-xs font-semibold text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink"
                  >
                    <RefreshCw className="size-3.5" />
                    <span>تحديث</span>
                  </button>
                </div>
              </div>

              {/* Diff Counters Strip */}
              {diff ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 border-t border-bw-line pt-4">
                  <div className="rounded-xl border border-bw-ok/40 bg-bw-ok-soft p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-bw-ok">تحديث أسعار</span>
                    <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.updated}</p>
                  </div>

                  <div className="rounded-xl border border-bw-info/40 bg-bw-info-soft p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-bw-info">إضافة لأول مرة</span>
                    <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.created}</p>
                  </div>

                  <div className="rounded-xl border border-bw-line bg-bw-page p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-bw-ink-subtle">بدون تغيير</span>
                    <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.unchanged}</p>
                  </div>

                  <div className="rounded-xl border border-bw-info/40 bg-bw-info-soft p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-bw-info">مرشحون جدد</span>
                    <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.skipped}</p>
                  </div>

                  <div className="rounded-xl border border-bw-warn/40 bg-bw-warn-soft p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-bw-warn">قفزات سعرية</span>
                    <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.review}</p>
                  </div>

                  <div className="rounded-xl border border-bw-danger/40 bg-bw-danger-soft p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-bw-danger">أخطاء بالملف</span>
                    <p className="font-mono text-xl font-extrabold text-bw-ink">{diff.counters.error + (diff.sourceRows?.invalid ?? 0)}</p>
                  </div>
                </div>
              ) : null}
              {diff ? <SourceRowOutcomes summary={diff.sourceRows} /> : null}
            </div>

            {/* Commit Success Receipt if newly committed */}
            {commitResult ? (
              <div className="rounded-2xl border border-bw-ok/40 bg-bw-ok-soft p-5 text-center space-y-2">
                <div className="inline-flex size-12 items-center justify-center rounded-xl bg-bw-ok-soft text-bw-ok">
                  <CheckCircle2 className="size-6" />
                </div>
                <h3 className="font-bold text-bw-ink text-base">تم اعتماد هذه العملية وتطبيق الأسعار بنجاح!</h3>
                <p className="text-xs text-bw-ink-subtle">
                  تم تحديث {commitResult.committedCount} عرض، وبقاء {commitResult.unchangedCount} بدون تغيير.
                </p>
                <div className="pt-2">
                  <Link
                    href="/supplier/products"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-bw-action px-4 text-xs font-bold text-bw-on-action hover:bg-bw-action-hover"
                  >
                    <Store className="size-3.5" />
                    <span>عرض قائمة المنتجات</span>
                  </Link>
                </div>
              </div>
            ) : null}

            {/* Diff Rows Table */}
            {diff ? (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="flex rounded-xl border border-bw-line bg-bw-surface p-1 text-xs">
                    {(
                      [
                        ['all', `الكل (${diff.rows.length})`],
                        ['changes', `تحديثات (${diff.counters.updated + diff.counters.created})`],
                        ['candidates', `مرشحون (${diff.counters.skipped})`],
                        ['errors', `أخطاء (${diff.counters.error})`],
                      ] as const
                    ).map(([fKey, fLabel]) => (
                      <button
                        key={fKey}
                        type="button"
                        onClick={() => setFilterAction(fKey)}
                        className={`rounded-lg px-3 py-1 font-semibold transition-all ${
                          filterAction === fKey
                            ? 'bg-bw-action text-bw-on-action shadow-xs'
                            : 'text-bw-ink-soft hover:text-bw-ink'
                        }`}
                      >
                        {fLabel}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute start-3 top-2.5 size-3.5 text-bw-ink-subtle" />
                    <input
                      type="text"
                      placeholder="بحث في تفاصيل العملية..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8.5 w-full rounded-xl border border-bw-line bg-bw-surface pe-3 ps-8.5 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-ok focus:outline-none"
                    />
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-bw-line bg-bw-surface shadow-md">
                  <div className="overflow-x-auto">
                    <table className="w-full text-start text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-bw-line bg-bw-page text-bw-ink-subtle font-semibold text-[11px]">
                          <th className="py-3 px-4 text-start">المنتج وكود الصنف</th>
                          <th className="py-3 px-4 text-start">الإجراء</th>
                          <th className="py-3 px-4 text-end">السعر قبل</th>
                          <th className="py-3 px-4 text-end">السعر بعد</th>
                          <th className="py-3 px-4 text-center">نسبة التغير</th>
                          <th className="py-3 px-4 text-start">الأسباب والتفاصيل</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-bw-line">
                        {filteredRows.slice(0, 100).map((row) => (
                          <tr key={row.itemId} className="hover:bg-bw-sunken transition-colors">
                            <td className="py-3.5 px-4 max-w-sm">
                              <div className="space-y-1">
                                <p className="font-bold text-bw-ink truncate text-xs leading-snug">{row.productName}</p>
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                  <span className="font-mono font-semibold px-1.5 py-0.5 rounded-md bg-bw-sunken border border-bw-line text-bw-ok">
                                    SKU: {row.supplierSkuCode}
                                  </span>
                                  {row.canonicalSkuCode ? (
                                    <span className="font-mono text-bw-ink-subtle">
                                      كتالوج: <Code className="text-[10px] text-bw-ink-soft">{row.canonicalSkuCode}</Code>
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  row.action === 'UPDATE'
                                    ? 'bg-bw-ok-soft text-bw-ok'
                                    : row.action === 'CREATE'
                                    ? 'bg-bw-info-soft text-bw-info'
                                    : row.action === 'SKIP'
                                    ? 'bg-bw-info-soft text-bw-info'
                                    : row.action === 'ERROR'
                                    ? 'bg-bw-danger-soft text-bw-danger'
                                    : 'bg-bw-sunken text-bw-ink-subtle'
                                }`}
                              >
                                {row.action === 'UPDATE'
                                  ? 'تحديث سعر'
                                  : row.action === 'CREATE'
                                  ? 'إضافة جديدة'
                                  : row.action === 'SKIP'
                                  ? 'مرشح جديد'
                                  : row.action === 'ERROR'
                                  ? 'خطأ'
                                  : 'مطابق'}
                              </span>
                            </td>

                            <td className="py-3.5 px-4 text-end font-mono text-bw-ink-soft whitespace-nowrap">
                              {row.before?.costPrice ? <Egp value={row.before.costPrice} /> : '—'}
                            </td>

                            <td className="py-3.5 px-4 text-end font-mono font-bold text-bw-ink whitespace-nowrap">
                              {row.after.costPrice ? <Egp value={row.after.costPrice} /> : '—'}
                            </td>

                            <td className="py-3.5 px-4 text-center font-mono whitespace-nowrap">
                              {row.priceChangePercent !== null ? (
                                <span
                                  className={`font-bold ${
                                    row.isLargePriceJump ? 'text-bw-warn' : 'text-bw-ok'
                                  }`}
                                >
                                  {row.priceChangePercent > 0 ? '+' : ''}
                                  {row.priceChangePercent.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-bw-ink-subtle text-[10px]">—</span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-bw-ink-soft text-[11px]">
                              {row.reasons.length > 0 ? (
                                <p className="text-[10px] text-bw-ink-subtle truncate max-w-xs">
                                  {row.reasons[0] === 'unmatched_candidate_requires_catalog_admission'
                                    ? 'صنف جديد: غير موجود بالكتالوج'
                                    : row.reasons[0].replace(/_/g, ' ')}
                                </p>
                              ) : (
                                <span className="text-bw-ok text-[10px]">مطابق</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* If job not committed yet, offer commit button */}
                {job.status === 'pending' && !commitResult ? (
                  <div className="rounded-2xl border border-bw-line bg-bw-page p-4 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-bw-ink text-xs">هذه العملية بانتظار الاعتماد النهائي</p>
                      <p className="text-[11px] text-bw-ink-subtle">
                        يمكنك اعتماد وتطبيق العروض المحدثة فورياً.
                      </p>
                    </div>

                    <Button
                      type="button"
                      loading={commit.pending}
                      className="bg-bw-action text-bw-on-action font-bold h-10 px-5 text-xs hover:bg-bw-action-hover"
                      onClick={async () => {
                        await commit.execute()
                      }}
                    >
                      اعتماد وتطبيق التحديثات الآن
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </RoleShell>
  )
}
