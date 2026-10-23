'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  FileSpreadsheet,
  History,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Tag,
} from 'lucide-react'
import { Button, Code, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

export interface IngestionJobItem {
  id: string
  supplierId: string
  mode: 'FULL_SNAPSHOT' | 'PARTIAL_UPDATE'
  status: string
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
    price: number
    status: string
  }>
}

export default function SupplierUpdatesHistoryPage() {
  const { data, error, loading, reload } = useApi<IngestionJobItem[]>('/ingestion/jobs', {
    pollMs: 30000,
  })

  const [modeFilter, setModeFilter] = React.useState<'all' | 'PARTIAL_UPDATE' | 'FULL_SNAPSHOT'>('all')
  const [searchQuery, setSearchQuery] = React.useState('')

  const jobs = data ?? []

  const filteredJobs = React.useMemo(() => {
    return jobs.filter((job) => {
      if (modeFilter !== 'all' && job.mode !== modeFilter) return false

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const matchesId = job.id.toLowerCase().includes(q) || shortId(job.id).toLowerCase().includes(q)
        const matchesFingerprint = job.formatFingerprint?.toLowerCase().includes(q)
        if (!matchesId && !matchesFingerprint) return false
      }
      return true
    })
  }, [jobs, modeFilter, searchQuery])

  return (
    <RoleShell role="supplier" active="updates" mode="responsive">
      <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <PageHeader
            title="سجل تحديثات المخزون والأسعار"
            meta="أرشيف عمليات رفع ملفات Excel/CSV السابقة وتفاصيل نتائج المطابقة والفروقات السعرية"
          />

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => reload()}
              disabled={loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-bw-surface px-3 text-xs font-semibold text-bw-ink-soft hover:bg-white/[0.04] hover:text-white transition-all shadow-xs"
            >
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث السجل</span>
            </button>

            <Link
              href="/supplier/updates"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#34d27b] px-4 text-xs font-bold text-black hover:bg-[#2eb96c] transition-all shadow-[0_2px_12px_rgba(52,210,123,0.3)]"
            >
              <Plus className="size-3.5" />
              <span>رفع ملف جديد</span>
            </Link>
          </div>
        </div>

        {/* Toolbar & Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex rounded-xl border border-white/[0.08] bg-bw-surface p-1 text-xs">
            {(
              [
                ['all', `كل العمليات (${jobs.length})`],
                ['PARTIAL_UPDATE', 'تحديث جزئي'],
                ['FULL_SNAPSHOT', 'لقطة كاملة'],
              ] as const
            ).map(([mKey, mLabel]) => (
              <button
                key={mKey}
                type="button"
                onClick={() => setModeFilter(mKey)}
                className={`rounded-lg px-3 py-1 font-semibold transition-all ${
                  modeFilter === mKey
                    ? 'bg-[#34d27b] text-black shadow-xs'
                    : 'text-bw-ink-soft hover:text-white'
                }`}
              >
                {mLabel}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute start-3 top-2.5 size-3.5 text-bw-ink-subtle" />
            <input
              type="text"
              placeholder="بحث برقم العملية..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8.5 w-full rounded-xl border border-white/[0.08] bg-bw-surface pe-3 ps-8.5 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-[#34d27b] focus:outline-none"
            />
          </div>
        </div>

        {/* Content Section */}
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}

        {loading && !data ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        ) : null}

        {!loading && filteredJobs.length === 0 ? (
          <StateBlock
            kind="empty"
            title="لا توجد عمليات مسجلة بالسجل"
            body={
              searchQuery.trim()
                ? 'لم يتم العثور على أي عملية تطابق معايير البحث.'
                : 'لم تقم برفع أي ملفات أسعار ومخزون سابقة حتى الآن.'
            }
            action={
              <Link
                href="/supplier/updates"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#34d27b] px-4 text-xs font-bold text-black hover:bg-[#2eb96c]"
              >
                <FileSpreadsheet className="size-3.5" />
                <span>رفع أول ملف تحديث</span>
              </Link>
            }
          />
        ) : null}

        {/* History Table (Desktop & Tablet) */}
        {filteredJobs.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-bw-surface shadow-md">
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-black/30 text-bw-ink-subtle font-semibold text-[11px]">
                    <th className="py-3 px-4 text-start">رقم العملية</th>
                    <th className="py-3 px-4 text-start">تاريخ الرفع</th>
                    <th className="py-3 px-4 text-start">النمط</th>
                    <th className="py-3 px-4 text-center">عدد الأصناف</th>
                    <th className="py-3 px-4 text-start">الحالة</th>
                    <th className="py-3 px-4 text-center">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-white/[0.02] transition-colors">
                      {/* Job ID */}
                      <td className="py-3.5 px-4 font-mono font-bold text-white whitespace-nowrap">
                        <span className="text-white hover:text-[#34d27b] transition-colors">
                          #{shortId(job.id)}
                        </span>
                      </td>

                      {/* Created At */}
                      <td className="py-3.5 px-4 text-bw-ink-soft whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <Clock className="size-3.5 text-bw-ink-subtle shrink-0" />
                          <span className="font-mono">{formatDateTime(job.createdAt)}</span>
                        </div>
                      </td>

                      {/* Mode Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {job.mode === 'FULL_SNAPSHOT' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 px-2 py-0.5 text-[10px] font-bold">
                            <Layers className="size-3" />
                            لقطة كاملة
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-2 py-0.5 text-[10px] font-bold">
                            <Tag className="size-3" />
                            تحديث جزئي
                          </span>
                        )}
                      </td>

                      {/* Total Rows */}
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-white whitespace-nowrap">
                        {job.items?.length ?? 0}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
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
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <Link
                          href={`/supplier/updates/${job.id}`}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/[0.08] transition-all"
                        >
                          <Eye className="size-3.5" />
                          <span>معاينة الفروقات</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </RoleShell>
  )
}
