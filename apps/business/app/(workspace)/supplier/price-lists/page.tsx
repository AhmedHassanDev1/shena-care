'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Code, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { ColumnProblem, FilePicker, RowsTable, TotalsBar } from '@/components/workspace/intake'
import { api, ApiError } from '@/lib/api'
import { type IntakeJob, type IntakeOutcome, type IntakeRow, type IntakeTotals, jobStatus, SUPPLIER_OUTCOMES } from '@/lib/intake'
import { formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

type SupplierRow = { id: string; rowNumber: number; name: string; purchasePrice: string | null; consumerPrice: string | null; quantity: number | null; outcome: IntakeOutcome; reasonCode: string | null; reason: string | null }

export default function SupplierPriceLists() {
  const [file, setFile] = React.useState<File | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const jobs = useApi<IntakeJob[]>('/supplier/intake/jobs', { pollMs: 15000 })
  const upload = useCommand(async (mapping?: Record<string, number>) => {
    const form = new FormData()
    form.append('file', file!)
    if (mapping) form.append('mapping', JSON.stringify(mapping))
    return api<{ jobId: string }>('/supplier/intake/files', { body: form })
  })
  const error = upload.error as ApiError | null
  const done = (result: { jobId: string } | undefined) => { if (result) { setFile(null); setSelected(result.jobId); jobs.reload() } }
  const current = selected ?? jobs.data?.[0]?.id ?? null

  return <RoleShell role="supplier" active="price-lists">
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-9" dir="rtl">
      <PageHeader eyebrow="بوابة المورد" title="قوائم الأسعار"
        meta="ارفع قائمة أسعارك زي ما هي: اسم الصنف وسعر الشراء أو سعر الجمهور والخصم. بنربطها بمنتجات شيناكير ونحدّث عروضك بس." />

      <Section title="رفع قائمة جديدة">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <FilePicker file={file} onFile={(next) => { setFile(next); upload.clearError() }} disabled={upload.pending} />
          <Button disabled={!file} loading={upload.pending} onClick={async () => done(await upload.execute())}>ارفع</Button>
        </div>
        <div className="mt-3">
          {error?.details?.headers ? <ColumnProblem error={{ message: error.message, code: error.code, headers: error.details.headers as string[] }} onMap={async (mapping) => done(await upload.execute(mapping))} />
            : error ? <Notice tone="danger" title="الملف ما اتقريش">{error.message}</Notice> : null}
        </div>
      </Section>

      <section className="space-y-4" aria-label="القوائم المرفوعة">
        <div className="flex items-center justify-between"><h2 className="text-bw-heading font-semibold">القوائم المرفوعة</h2>
          <Button variant="ghost" onClick={jobs.reload} aria-label="تحديث القوائم"><RefreshCw className="size-4" /></Button></div>
        {jobs.error ? <LoadError message={jobs.error.message} onRetry={jobs.reload} /> : null}
        {jobs.loading && !jobs.data ? <Skeleton className="h-40 w-full rounded-bw-card" /> : null}
        {jobs.data && !jobs.data.length ? <StateBlock kind="empty" title="لسه ما رفعتش أي قائمة" body="أول ما ترفع ملف هتلاقي نتيجة كل سطر هنا." /> : null}
        {jobs.data?.length ? <div className="flex flex-wrap gap-2" role="group" aria-label="اختار قائمة">
          {jobs.data.map((job) => <button key={job.id} type="button" aria-pressed={job.id === current} onClick={() => setSelected(job.id)}
            className={`space-y-1 rounded-bw-field border px-3 py-2 text-start text-bw-small ${job.id === current ? 'border-bw-action bg-bw-action-soft' : 'border-bw-line hover:bg-bw-sunken'}`}>
            <span className="block font-semibold"><bdi>{job.sourceFileName}</bdi></span>
            <span className="flex items-center gap-2"><StatusLabel tone={jobStatus[job.status].tone}>{jobStatus[job.status].text}</StatusLabel><span className="text-bw-ink-subtle">{formatDateTime(job.createdAt)}</span></span>
          </button>)}
        </div> : null}
        {current ? <JobResults key={current} jobId={current} /> : null}
      </section>
    </main>
  </RoleShell>
}

function JobResults({ jobId }: { jobId: string }) {
  const [filter, setFilter] = React.useState<IntakeOutcome | null>(null)
  const detail = useApi<{ job: IntakeJob; totals: IntakeTotals }>(`/supplier/intake/jobs/${jobId}`, { pollMs: 5000 })
  const finished = detail.data?.job.status === 'COMPLETED' || detail.data?.job.status === 'FAILED'
  const rows = useApi<{ items: SupplierRow[]; total: number }>(`/supplier/intake/jobs/${jobId}/rows?take=500${filter ? `&outcome=${filter}` : ''}`, { pollMs: finished ? undefined : 5000 })
  if (detail.error) return <LoadError message={detail.error.message} onRetry={detail.reload} />
  if (!detail.data) return <Skeleton className="h-40 w-full rounded-bw-card" />
  const metrics = detail.data.job.metrics ?? {}
  const asRows: IntakeRow[] = (rows.data?.items ?? []).map((row) => ({ ...row, rawName: row.name, jobId, matchedSkuId: null, candidates: null, readiness: null, processingMs: null, cost: null }))
  return <div className="space-y-4">
    {detail.data.job.status === 'PROCESSING' ? <Notice tone="info" title="جاري المعالجة">النتائج بتتحدّث لوحدها.</Notice> : null}
    {detail.data.job.lastError ? <Notice tone="danger" title="المعالجة وقفت">{detail.data.job.lastError}</Notice> : null}
    {metrics.durationMs ? <p className="text-bw-small text-bw-ink-soft">اتعالج <Code>{metrics.rowsProcessed ?? detail.data.totals.total}</Code> سطر في <Code>{(metrics.durationMs / 1000).toFixed(1)}</Code> ثانية.</p> : null}
    <TotalsBar totals={detail.data.totals} order={SUPPLIER_OUTCOMES} active={filter} onSelect={setFilter} />
    {rows.error ? <LoadError message={rows.error.message} onRetry={rows.reload} /> : null}
    {rows.loading && !rows.data ? <Skeleton className="h-40 w-full rounded-bw-card" /> : null}
    {rows.data && !rows.data.items.length ? <StateBlock kind="empty" title="مفيش أسطر بالفلتر ده" /> : null}
    {asRows.length ? <div className="overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface"><RowsTable rows={asRows} view="supplier" /></div> : null}
  </div>
}
