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
            className="inline-flex items-center gap-1.5 text-xs text-bw-ink-soft transition-colors hover:text-white"
          >
            <ArrowRight className="size-4" />
            <span>العودة إلى سجل التحديثات</span>
          </Link>

          <Link
            href="/supplier/updates"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
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
            <div className="rounded-2xl border border-white/[0.08] bg-bw-surface p-5 sm:p-6 space-y-4 shadow-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white text-base">
                      عملية استيراد #{shortId(job.id)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        job.status === 'completed' || job.status === 'published'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : job.status === 'review_required'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
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
                    <span className="text-white font-semibold">
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
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-semibold text-bw-ink-soft hover:bg-white/[0.06] hover:text-white"
                  >
                    <RefreshCw className="size-3.5" />
                    <span>تحديث</span>
                  </button>
                </div>
              </div>

              {/* Diff Counters Strip */}
              {diff ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 border-t border-white/[0.06] pt-4">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-emerald-400">تحديث أسعار</span>
                    <p className="font-mono text-xl font-extrabold text-white">{diff.counters.updated}</p>
                  </div>

                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.04] p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-blue-400">إضافة لأول مرة</span>
                    <p className="font-mono text-xl font-extrabold text-white">{diff.counters.created}</p>
                  </div>

                  <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-bw-ink-subtle">بدون تغيير</span>
                    <p className="font-mono text-xl font-extrabold text-white">{diff.counters.unchanged}</p>
                  </div>

                  <div className="rounded-xl border border-purple-500/30 bg-purple-500/[0.04] p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-purple-400">مرشحون جدد</span>
                    <p className="font-mono text-xl font-extrabold text-white">{diff.counters.skipped}</p>
                  </div>

                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-amber-400">قفزات سعرية</span>
                    <p className="font-mono text-xl font-extrabold text-white">{diff.counters.review}</p>
                  </div>

                  <div className="rounded-xl border border-red-500/30 bg-red-500/[0.04] p-3 text-center space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-red-400">أخطاء بالملف</span>
                    <p className="font-mono text-xl font-extrabold text-white">{diff.counters.error + (diff.sourceRows?.invalid ?? 0)}</p>
                  </div>
                </div>
              ) : null}
              {diff ? <SourceRowOutcomes summary={diff.sourceRows} /> : null}
            </div>

            {/* Commit Success Receipt if newly committed */}
            {commitResult ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5 text-center space-y-2">
                <div className="inline-flex size-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="size-6" />
                </div>
                <h3 className="font-bold text-white text-base">تم اعتماد هذه العملية وتطبيق الأسعار بنجاح!</h3>
                <p className="text-xs text-bw-ink-subtle">
                  تم تحديث {commitResult.committedCount} عرض، وبقاء {commitResult.unchangedCount} بدون تغيير.
                </p>
                <div className="pt-2">
                  <Link
                    href="/supplier/products"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#34d27b] px-4 text-xs font-bold text-black hover:bg-[#2eb96c]"
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
                  <div className="flex rounded-xl border border-white/[0.08] bg-bw-surface p-1 text-xs">
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
                            ? 'bg-[#34d27b] text-black shadow-xs'
                            : 'text-bw-ink-soft hover:text-white'
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
                      className="h-8.5 w-full rounded-xl border border-white/[0.08] bg-bw-surface pe-3 ps-8.5 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-[#34d27b] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-bw-surface shadow-md">
                  <div className="overflow-x-auto">
                    <table className="w-full text-start text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-white/[0.08] bg-black/30 text-bw-ink-subtle font-semibold text-[11px]">
                          <th className="py-3 px-4 text-start">المنتج وكود الصنف</th>
                          <th className="py-3 px-4 text-start">الإجراء</th>
                          <th className="py-3 px-4 text-end">السعر قبل</th>
                          <th className="py-3 px-4 text-end">السعر بعد</th>
                          <th className="py-3 px-4 text-center">نسبة التغير</th>
                          <th className="py-3 px-4 text-start">الأسباب والتفاصيل</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {filteredRows.slice(0, 100).map((row) => (
                          <tr key={row.itemId} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3.5 px-4 max-w-sm">
                              <div className="space-y-1">
                                <p className="font-bold text-white truncate text-xs leading-snug">{row.productName}</p>
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                  <span className="font-mono font-semibold px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-emerald-300">
                                    SKU: {row.supplierSkuCode}
                                  </span>
                                  {row.canonicalSkuCode ? (
                                    <span className="font-mono text-bw-ink-subtle">
                                      كتالوج: <Code className="text-[10px] text-white/80">{row.canonicalSkuCode}</Code>
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  row.action === 'UPDATE'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : row.action === 'CREATE'
                                    ? 'bg-blue-500/20 text-blue-300'
                                    : row.action === 'SKIP'
                                    ? 'bg-purple-500/20 text-purple-300'
                                    : row.action === 'ERROR'
                                    ? 'bg-red-500/20 text-red-300'
                                    : 'bg-white/[0.06] text-bw-ink-subtle'
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

                            <td className="py-3.5 px-4 text-end font-mono font-bold text-white whitespace-nowrap">
                              {row.after.costPrice ? <Egp value={row.after.costPrice} /> : '—'}
                            </td>

                            <td className="py-3.5 px-4 text-center font-mono whitespace-nowrap">
                              {row.priceChangePercent !== null ? (
                                <span
                                  className={`font-bold ${
                                    row.isLargePriceJump ? 'text-amber-400' : 'text-emerald-400'
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
                                <span className="text-emerald-400 text-[10px]">مطابق</span>
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
                  <div className="rounded-2xl border border-white/[0.1] bg-[#090b0e] p-4 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-white text-xs">هذه العملية بانتظار الاعتماد النهائي</p>
                      <p className="text-[11px] text-bw-ink-subtle">
                        يمكنك اعتماد وتطبيق العروض المحدثة فورياً.
                      </p>
                    </div>

                    <Button
                      type="button"
                      loading={commit.pending}
                      className="bg-[#34d27b] text-black font-bold h-10 px-5 text-xs hover:bg-[#2eb96c]"
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
