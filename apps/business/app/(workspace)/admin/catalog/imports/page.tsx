'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Page, Select } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

type Outcome = 'PENDING' | 'LINKED_EXISTING' | 'NEW_CANDIDATE' | 'HOLD' | 'REJECTED'
type ImportJob = { id: string; sourceFileName: string; status: string; totals: Record<string, number> | null; createdAt: string; completedAt: string | null; lastError?: string | null }
type Decision = 'AUTO_ACCEPT' | 'AUTO_LINK' | 'SKIP' | 'HOLD_CRITICAL' | 'RETRY_AUTOMATIC'
type ImportRow = { id: string; rowNumber: number; name: string; brand: string | null; size: string | null; sizeUnit: string | null; barcode: string | null; outcome: Outcome; reasonCode: string | null; reason: string | null; matchedSkuId: string | null; sourceUrl: string | null; decision: Decision | null; nextAttemptAt: string | null }
type Receipt = { jobId: string; reused: boolean; totalRows: number; matching?: { status: string; error?: string } }

const outcomes: Record<Outcome, { label: string; tone: 'ok' | 'warn' | 'danger' | 'pending' }> = {
  PENDING: { label: 'قيد الفحص', tone: 'pending' },
  LINKED_EXISTING: { label: 'مرتبط بمنتج', tone: 'ok' },
  NEW_CANDIDATE: { label: 'منتج جديد للمراجعة', tone: 'warn' },
  HOLD: { label: 'يحتاج مراجعة', tone: 'warn' },
  REJECTED: { label: 'مرفوض', tone: 'danger' },
}
/** The automatic pipeline's five ends. Only HOLD_CRITICAL needs a person, in the workbench's exception queue. */
const decisions: Record<Decision, { label: string; tone: 'ok' | 'warn' | 'danger' | 'pending' }> = {
  AUTO_ACCEPT: { label: 'اتضاف تلقائيًا', tone: 'ok' },
  AUTO_LINK: { label: 'اترَبط بمنتج موجود', tone: 'ok' },
  SKIP: { label: 'متجاهَل حسب السياسة', tone: 'pending' },
  HOLD_CRITICAL: { label: 'استثناء حرج', tone: 'danger' },
  RETRY_AUTOMATIC: { label: 'إعادة محاولة تلقائية', tone: 'warn' },
}
const PAGE_SIZE = 50

export default function CatalogImportsPage() {
  const jobs = useApi<ImportJob[]>('/admin/catalog-imports')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [receipt, setReceipt] = React.useState<Receipt | null>(null)
  const [outcome, setOutcome] = React.useState('')
  const [offset, setOffset] = React.useState(0)
  const selected = selectedId ?? jobs.data?.[0]?.id ?? null
  const job = useApi<ImportJob>(selected ? `/admin/catalog-imports/${selected}` : null)
  const rows = useApi<{ total: number; rows: ImportRow[] }>(selected ? `/admin/catalog-imports/${selected}/rows?offset=${offset}&limit=${PAGE_SIZE}${outcome ? `&outcome=${outcome}` : ''}` : null)
  const upload = useCommand(async () => {
    const body = new FormData()
    body.append('file', file!)
    return api<Receipt>('/admin/catalog-imports', { body })
  })
  const rematch = useCommand((jobId?: string) => api<{ totals: Record<string, number> }>(`/catalog/workbench/imports/${jobId ?? selected}/autopilot`, { body: {} }))

  return (
    <RoleShell role="admin" active="catalog" mode="desktop">
      <Page>
        <PageHeader title="استيراد قائمة المنتجات" meta="قائمة الكتالوج تضيف معلومات للمراجعة فقط. لا تنشئ عروض موردين أو أسعارًا أو مخزونًا." actions={<Link className="text-bw-action-ink underline underline-offset-4" href="/admin/catalog/workbench">المنتجات المخزنة وتجهيز النشر</Link>} />
        <Section title="رفع قائمة جديدة">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={async (event) => {
            event.preventDefault()
            if (!file) return
            const result = await upload.execute()
            if (result) {
              setReceipt(result); setSelectedId(result.jobId); setOffset(0); setOutcome('')
              // Decisions are automatic: the list is processed right after upload, no per-row approval.
              await rematch.execute(result.jobId)
              jobs.reload(); job.reload(); rows.reload()
            }
          }}>
            <Field className="flex-1" label="ملف CSV أو Excel" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <Button type="submit" loading={upload.pending || rematch.pending} disabled={!file}>رفع وفحص القائمة</Button>
          </form>
          <p className="mt-3 text-bw-small text-bw-ink-soft">الأعمدة المطلوبة: اسم المنتج. الماركة والحجم والقسم ورابط صفحة المنتج الرسمية بيخلوا القرار تلقائي. المنتجات العادية بتتضاف أو تترَبط أو تتجاهَل من غير مراجعة؛ الحالات الحرجة بس بتروح لقائمة الاستثناءات. مفيش أسعار أو مخزون أو نشر من هنا.</p>
          <CommandError error={upload.error} />
          {receipt ? <div className="mt-3"><Notice tone="info" title={receipt.reused ? 'هذا الملف رُفع من قبل؛ عُرضت نتيجته السابقة' : `استُقبل ${receipt.totalRows} صف`}>{receipt.matching?.status === 'FAILED_RETRYABLE' ? `تعذر إكمال المطابقة: ${receipt.matching.error ?? 'حاول إعادة الفحص'}` : 'يمكنك متابعة نتائج كل صف أدناه.'}</Notice></div> : null}
        </Section>

        <Section title="سجل الاستيراد">
          {jobs.error ? <LoadError message={jobs.error.message} onRetry={jobs.reload} /> : null}
          {!jobs.data && jobs.loading ? <Skeleton className="h-24 w-full" /> : null}
          {jobs.data?.length === 0 ? <StateBlock kind="empty" title="لا توجد قوائم بعد" body="ارفع أول قائمة منتجات من النموذج أعلاه." /> : null}
          {jobs.data && jobs.data.length > 0 ? <Select label="اختر قائمة" value={selected ?? ''} onChange={(id) => { setSelectedId(id); setOffset(0); setOutcome('') }} options={jobs.data.map((item) => [item.id, `${item.sourceFileName} · ${formatDateTime(item.createdAt)}`])} /> : null}
        </Section>

        {selected ? <Section title="نتائج الصفوف" aside={<Button type="button" variant="secondary" loading={rematch.pending} onClick={async () => { if (await rematch.execute()) { job.reload(); rows.reload(); jobs.reload() } }}>تشغيل القرار الآلي مرة تانية</Button>}>
          {job.error ? <LoadError message={job.error.message} onRetry={job.reload} /> : null}
          {job.data ? <div className="mb-4 space-y-2 text-bw-small"><p>الحالة: <strong>{job.data.status}</strong> · <Code>{job.data.sourceFileName}</Code></p>
            {job.data.lastError ? <Notice tone="danger" title="تعذر إكمال الفحص">{job.data.lastError}</Notice> : null}
            <div className="flex flex-wrap gap-2">{(Object.keys(decisions) as Decision[]).map((key) => <span key={key} className="inline-flex items-center gap-1"><StatusLabel tone={decisions[key].tone}>{decisions[key].label}</StatusLabel><Code>{job.data?.totals?.[key] ?? 0}</Code></span>)}</div>
            {job.data.totals?.HOLD_CRITICAL ? <Notice tone="warn" title="فيه حالات محتاجة قرارك">{'افتح '}<Link className="text-bw-action-ink underline underline-offset-4" href="/admin/catalog/workbench">قائمة الاستثناءات الحرجة</Link>.</Notice> : null}
          </div> : null}
          <CommandError error={rematch.error} />
          <div className="mb-3 max-w-xs"><Select label="تصفية النتائج" value={outcome} onChange={(value) => { setOutcome(value); setOffset(0) }} options={[['', 'كل الصفوف'], ...(Object.keys(outcomes) as Outcome[]).map((key) => [key, outcomes[key].label] as [string, string])]} /></div>
          {rows.error ? <LoadError message={rows.error.message} onRetry={rows.reload} /> : null}
          {!rows.data && rows.loading ? <Skeleton className="h-32 w-full" /> : null}
          {rows.data?.total === 0 ? <StateBlock kind="empty" title="لا توجد صفوف بهذه الحالة" body="اختر حالة أخرى لعرض النتائج." /> : null}
          {rows.data && rows.data.total > 0 ? <div className="divide-y divide-bw-line">{rows.data.rows.map((row) => <div key={row.id} className="py-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="font-semibold"><Code>{row.rowNumber}</Code> · <bdi>{row.brand ? `${row.brand} — ` : ''}{row.name}</bdi></p><p className="text-bw-small text-bw-ink-soft"><bdi>{row.size ? `${row.size} ${row.sizeUnit ?? ''}` : 'حجم غير محدد'}</bdi>{row.barcode ? <> · <Code>{row.barcode}</Code></> : null}</p>{row.reason ? <p className="text-bw-small text-bw-ink-soft" dir="auto">{row.reasonCode ? `${row.reasonCode}: ` : ''}{row.reason}</p> : null}</div><div className="flex flex-wrap items-center gap-2">{row.decision ? <StatusLabel tone={decisions[row.decision].tone}>{decisions[row.decision].label}</StatusLabel> : <StatusLabel tone={outcomes[row.outcome].tone}>{outcomes[row.outcome].label}</StatusLabel>}{row.matchedSkuId ? <Code>{row.matchedSkuId.slice(0, 8)}</Code> : null}{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="text-bw-action-ink underline underline-offset-4">المصدر</a> : null}</div></div></div>)}</div> : null}
          {rows.data && rows.data.total > PAGE_SIZE ? <div className="mt-4 flex items-center gap-3 text-bw-small"><Button type="button" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>السابق</Button><Code>{offset + 1}–{Math.min(offset + PAGE_SIZE, rows.data.total)} / {rows.data.total}</Code><Button type="button" variant="secondary" disabled={offset + PAGE_SIZE >= rows.data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>التالي</Button></div> : null}
        </Section> : null}
      </Page>
    </RoleShell>
  )
}

