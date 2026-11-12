'use client'

import * as React from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { Button, Checkbox, Code, Dialog, Field, Notice, PageHeader, Section, Select, Skeleton, StateBlock, StatusLabel, Tabs, useDialog } from '@/components/bw/primitives'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { ColumnProblem, FilePicker, RowsTable, TotalsBar } from '@/components/workspace/intake'
import { api, ApiError } from '@/lib/api'
import { ADMIN_OUTCOMES, type IntakeJob, type IntakeOutcome, type IntakeRow, type IntakeTotals, jobStatus, outcomeLabel, reasonOf, SUPPLIER_OUTCOMES, vetoLabel } from '@/lib/intake'
import { formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

type Tab = 'add' | 'jobs' | 'review'
type JobDetail = { job: IntakeJob; totals: IntakeTotals }
type Supplier = { id: string; name: string; isActive: boolean }

export default function AdminCatalogIntake() {
  const [tab, setTab] = React.useState<Tab>('add')
  const [jobId, setJobId] = React.useState<string | null>(null)
  const open = (id: string) => { setJobId(id); setTab('jobs') }
  return <RoleShell role="admin" active="intake">
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-9" dir="rtl">
      <PageHeader eyebrow="مساحة الإدارة / الكتالوج" title="إدخال المنتجات"
        meta="أسماء منتجات من الإدارة تتحول لمسودات موثّقة من الصفحة الرسمية، وقوائم أسعار الموردين تتربط بالمنتجات الموجودة بس."
        actions={<Link href="/admin/catalog" className="text-bw-small font-semibold text-bw-action-ink underline">رجوع للكتالوج</Link>} />
      <Tabs id="intake" label="أقسام الإدخال" value={tab} onChange={(value) => setTab(value as Tab)}
        items={[{ value: 'add', label: 'إضافة' }, { value: 'jobs', label: 'المهام والنتائج' }, { value: 'review', label: 'محتاج مراجعة' }]} />
      <div id="intake-panel" role="tabpanel" aria-labelledby={`intake-${tab}`}>
        {tab === 'add' ? <AddPanel onCreated={open} /> : null}
        {tab === 'jobs' ? <JobsPanel jobId={jobId} onOpen={setJobId} /> : null}
        {tab === 'review' ? <ReviewPanel /> : null}
      </div>
    </main>
  </RoleShell>
}

function AddPanel({ onCreated }: { onCreated: (jobId: string) => void }) {
  const [text, setText] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  const [prices, setPrices] = React.useState(true)
  const [supplierId, setSupplierId] = React.useState('')
  const [supplierFile, setSupplierFile] = React.useState<File | null>(null)
  const suppliers = useApi<Supplier[]>('/sourcing/suppliers')
  const names = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  const submitNames = useCommand(async () => api<{ jobId: string }>('/catalog/intake/names', { body: { names, researchPrices: prices } }))
  const submitFile = useCommand(async () => {
    const form = new FormData()
    form.append('file', file!)
    form.append('researchPrices', String(prices))
    return api<{ jobId: string }>('/catalog/intake/names/file', { body: form })
  })
  const submitSupplier = useCommand(async (mapping?: Record<string, number>) => {
    const form = new FormData()
    form.append('file', supplierFile!)
    if (mapping) form.append('mapping', JSON.stringify(mapping))
    return api<{ jobId: string }>(`/catalog/intake/suppliers/${supplierId}/files`, { body: form })
  })
  const supplierError = submitSupplier.error as ApiError | null

  return <div className="grid gap-6 lg:grid-cols-2">
    <Section title="أسماء منتجات جديدة">
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="block text-bw-small font-semibold text-bw-ink">اسم في كل سطر</span>
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} dir="auto"
            placeholder={'CeraVe Hydrating Facial Cleanser 236ml\nThe Ordinary Niacinamide 10% + Zinc 1% 30ml'}
            className="w-full rounded-bw-field border border-bw-line-field bg-bw-surface p-3 text-bw-body text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-action focus:outline-none" />
          <span className="block text-bw-small text-bw-ink-soft">اكتب البراند والاسم والحجم. المنتج ما بيتعملش إلا بعد ما صفحة رسمية تأكد الاسم والحجم.</span>
        </label>
        <Checkbox label="ابحث عن أسعار السوق للمنتجات الموثّقة (استرشادي فقط)" checked={prices} onChange={(event) => setPrices(event.target.checked)} />
        {submitNames.error ? <Notice tone="danger" title="ما اتبعتش">{submitNames.error.message}</Notice> : null}
        <Button disabled={!names.length} loading={submitNames.pending}
          onClick={async () => { const result = await submitNames.execute(); if (result) { setText(''); onCreated(result.jobId) } }}>
          ابدأ (<Code>{names.length}</Code> اسم)
        </Button>
        <div className="border-t border-bw-line pt-4 space-y-3">
          <FilePicker file={file} onFile={setFile} disabled={submitFile.pending} />
          {submitFile.error ? <Notice tone="danger" title="الملف ما اتقريش">{submitFile.error.message}</Notice> : null}
          <Button variant="secondary" disabled={!file} loading={submitFile.pending}
            onClick={async () => { const result = await submitFile.execute(); if (result) { setFile(null); onCreated(result.jobId) } }}>ارفع ملف الأسماء</Button>
        </div>
      </div>
    </Section>

    <Section title="قائمة أسعار مورد (نيابة عنه)">
      <div className="space-y-4">
        <p className="text-bw-small text-bw-ink-soft">الأسطر بتتربط بمنتجات الكتالوج الموجودة بس؛ عمرها ما بتعمل منتج جديد. اللي خارج النطاق بيتخطى تلقائيًا، واللي مش واضح بيروح للمراجعة.</p>
        {suppliers.error ? <LoadError message={suppliers.error.message} onRetry={suppliers.reload} /> : null}
        {suppliers.loading && !suppliers.data ? <Skeleton className="h-bw-control w-full" /> : null}
        {suppliers.data ? <Select label="المورد" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}
          options={[{ value: '', label: 'اختار المورد' }, ...suppliers.data.filter((item) => item.isActive).map((item) => ({ value: item.id, label: item.name }))]} /> : null}
        <FilePicker file={supplierFile} onFile={(next) => { setSupplierFile(next); submitSupplier.clearError() }} disabled={submitSupplier.pending} />
        {supplierError?.details?.headers ? <ColumnProblem error={{ message: supplierError.message, code: supplierError.code, headers: supplierError.details.headers as string[] }}
          onMap={async (mapping) => { const result = await submitSupplier.execute(mapping); if (result) onCreated(result.jobId) }} />
          : supplierError ? <Notice tone="danger" title="الملف ما اتقريش">{supplierError.message}</Notice> : null}
        <Button disabled={!supplierId || !supplierFile} loading={submitSupplier.pending}
          onClick={async () => { const result = await submitSupplier.execute(); if (result) { setSupplierFile(null); onCreated(result.jobId) } }}>ارفع قائمة الأسعار</Button>
      </div>
    </Section>
  </div>
}

function JobsPanel({ jobId, onOpen }: { jobId: string | null; onOpen: (id: string) => void }) {
  const jobs = useApi<IntakeJob[]>('/catalog/intake/jobs', { pollMs: 15000 })
  if (jobs.error) return <LoadError message={jobs.error.message} onRetry={jobs.reload} />
  if (jobs.loading && !jobs.data) return <Skeleton className="h-64 w-full rounded-bw-card" />
  if (!jobs.data?.length) return <StateBlock kind="empty" title="مفيش مهام لسه" body="ابدأ من تبويب الإضافة." />
  const current = jobId ?? jobs.data[0].id
  return <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
    <ul className="divide-y divide-bw-line overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface" aria-label="المهام">
      {jobs.data.map((job) => <li key={job.id}>
        <button type="button" onClick={() => onOpen(job.id)} aria-current={job.id === current}
          className={`block w-full space-y-1 p-3 text-start hover:bg-bw-sunken ${job.id === current ? 'bg-bw-action-soft' : ''}`}>
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold">{job.source === 'ADMIN' ? 'أسماء الإدارة' : 'قائمة مورد'}</span>
            <StatusLabel tone={jobStatus[job.status].tone}>{jobStatus[job.status].text}</StatusLabel>
          </span>
          <span className="block truncate text-bw-small text-bw-ink-soft"><bdi>{job.sourceFileName ?? `${job.totals?.total ?? '…'} سطر`}</bdi></span>
          <span className="block text-[11px] text-bw-ink-subtle">{formatDateTime(job.createdAt)}</span>
        </button>
      </li>)}
    </ul>
    <JobDetailView key={current} jobId={current} />
  </div>
}

function JobDetailView({ jobId }: { jobId: string }) {
  const [filter, setFilter] = React.useState<IntakeOutcome | null>(null)
  const detail = useApi<JobDetail>(`/catalog/intake/jobs/${jobId}`, { pollMs: 8000 })
  const rows = useApi<{ items: IntakeRow[]; total: number }>(`/catalog/intake/jobs/${jobId}/rows?take=500${filter ? `&outcome=${filter}` : ''}`, { pollMs: detail.data?.job.status === 'COMPLETED' ? undefined : 8000 })
  const resume = useCommand(() => api(`/catalog/intake/jobs/${jobId}/resume`, { method: 'POST' }))
  if (detail.error) return <LoadError message={detail.error.message} onRetry={detail.reload} />
  if (!detail.data) return <Skeleton className="h-64 w-full rounded-bw-card" />
  const { job, totals } = detail.data
  const metrics = job.metrics ?? {}
  return <section className="space-y-4" aria-label="نتائج المهمة">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <h2 className="text-bw-heading font-semibold">{job.source === 'ADMIN' ? 'أسماء الإدارة' : <bdi>{job.sourceFileName}</bdi>}</h2>
        <p className="text-bw-small text-bw-ink-soft">
          {metrics.durationMs ? <>المدة <Code>{Math.round(metrics.durationMs / 1000)}</Code> ث · </> : null}
          {metrics.rowsPerSecond ? <><Code>{metrics.rowsPerSecond}</Code> سطر/ث · </> : null}
          {metrics.searches !== undefined ? <><Code>{metrics.searches}</Code> بحث مدفوع · <Code>{metrics.pageFetches}</Code> صفحة</> : null}
        </p>
      </div>
      <div className="flex gap-2">
        {job.status !== 'COMPLETED' ? <Button variant="secondary" loading={resume.pending} onClick={() => resume.execute().then(() => detail.reload())}>كمّل المعالجة</Button> : null}
        <Button variant="ghost" onClick={() => { detail.reload(); rows.reload() }} aria-label="تحديث"><RefreshCw className="size-4" /></Button>
      </div>
    </div>
    {job.lastError ? <Notice tone="danger" title="المهمة وقفت">{job.lastError}</Notice> : null}
    <TotalsBar totals={totals} order={job.source === 'ADMIN' ? ADMIN_OUTCOMES : SUPPLIER_OUTCOMES} active={filter} onSelect={setFilter} />
    {rows.error ? <LoadError message={rows.error.message} onRetry={rows.reload} /> : null}
    {rows.loading && !rows.data ? <Skeleton className="h-64 w-full rounded-bw-card" /> : null}
    {rows.data && !rows.data.items.length ? <StateBlock kind="empty" title="مفيش أسطر بالفلتر ده" /> : null}
    {rows.data?.items.length ? <div className="overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface">
      <RowsTable rows={rows.data.items} view={job.source === 'ADMIN' ? 'admin' : 'supplier-file'}
        action={job.source === 'ADMIN' ? (row) => row.matchedSkuId ? <Link className="text-bw-small font-semibold text-bw-action-ink underline" href={`/admin/catalog?sku=${row.matchedSkuId}`}>افتح</Link> : null : undefined} />
    </div> : null}
  </section>
}

function ReviewPanel() {
  const queue = useApi<IntakeRow[]>('/catalog/intake/review', { pollMs: 30000 })
  const [selected, setSelected] = React.useState<IntakeRow | null>(null)
  const dialog = useDialog()
  if (queue.error) return <LoadError message={queue.error.message} onRetry={queue.reload} />
  if (queue.loading && !queue.data) return <Skeleton className="h-64 w-full rounded-bw-card" />
  if (!queue.data?.length) return <StateBlock kind="empty" title="مفيش حاجة محتاجة مراجعة" body="كل الأسطر اتحسمت تلقائيًا." />
  return <>
    <ul className="divide-y divide-bw-line overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface">
      {queue.data.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-3 p-4">
        <StatusLabel tone={outcomeLabel[row.outcome].tone}>{row.job?.source === 'SUPPLIER' ? 'قائمة مورد' : 'اسم إدارة'}</StatusLabel>
        <div className="min-w-0 flex-1"><p className="font-semibold"><bdi>{row.rawName}</bdi></p><p className="text-bw-small text-bw-ink-soft">{reasonOf(row)}</p></div>
        <Button variant="secondary" onClick={() => { setSelected(row); dialog.open() }}>احسم</Button>
      </li>)}
    </ul>
    <Dialog dialogRef={dialog.ref} title="حسم السطر" variant="drawer" onClose={() => setSelected(null)}>
      {selected ? <Resolve row={selected} onDone={() => { dialog.close(); queue.reload() }} /> : null}
    </Dialog>
  </>
}

function Resolve({ row, onDone }: { row: IntakeRow; onDone: () => void }) {
  const [note, setNote] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [name, setName] = React.useState(row.rawName)
  const supplierRow = row.job?.source === 'SUPPLIER'
  const resolve = useCommand((body: Record<string, unknown>) => api(`/catalog/intake/rows/${row.id}/${supplierRow ? 'supplier' : 'admin'}-resolution`, { body }))
  const run = async (body: Record<string, unknown>) => { if (await resolve.execute(body)) onDone() }
  return <div dir="rtl" className="space-y-5">
    <div><p className="font-semibold"><bdi>{row.rawName}</bdi></p><p className="mt-1 text-bw-small text-bw-ink-soft">{reasonOf(row)}</p>{row.reason ? <p className="mt-1 text-[11px] text-bw-ink-subtle" dir="ltr">{row.reason}</p> : null}</div>
    {supplierRow ? <div className="space-y-2">
      <h3 className="text-bw-small font-semibold">المرشحين من الكتالوج</h3>
      {(row.candidates ?? []).length ? <ul className="space-y-2">{row.candidates!.map((candidate) => <li key={candidate.skuId} className="flex items-center gap-2 rounded-bw-field border border-bw-line p-2">
        <span className="min-w-0 flex-1 text-bw-small"><bdi>{candidate.label}</bdi> <span className="text-bw-ink-subtle">· تطابق <Code>{Math.round(candidate.score * 100)}%</Code>{candidate.vetoes.length ? ` · ${candidate.vetoes.map(vetoLabel).join('، ')}` : ''}</span></span>
        <Button variant="secondary" disabled={candidate.vetoes.length > 0} loading={resolve.pending} onClick={() => run({ action: 'LINK', skuId: candidate.skuId })}>اربط</Button>
      </li>)}</ul> : <p className="text-bw-small text-bw-ink-soft">مفيش مرشحين.</p>}
    </div> : <div className="space-y-3">
      <Field label="رابط الصفحة الرسمية للمنتج" ltr placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} hint="صفحة البراند نفسه أو موزع معتمد — مش متجر." />
      <Field label="الاسم بعد التصحيح (اختياري)" value={name} onChange={(event) => setName(event.target.value)} dir="auto" />
      <Button loading={resolve.pending} onClick={() => run({ action: 'RETRY', ...(url && { url }), ...(name !== row.rawName && { name }) })}>أعد المحاولة</Button>
    </div>}
    <div className="space-y-2 border-t border-bw-line pt-4">
      <Field label="سبب القفل" value={note} onChange={(event) => setNote(event.target.value)} hint="مثلاً: منتج مش هنبيعه" />
      <Button variant="ghost" disabled={note.trim().length < 3} loading={resolve.pending} onClick={() => run({ action: 'DISMISS', note })}>اقفل من غير ربط</Button>
    </div>
    {resolve.error ? <Notice tone="danger" title="ما اتنفذش">{resolve.error.message}</Notice> : null}
  </div>
}
