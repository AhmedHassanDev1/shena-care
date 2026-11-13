'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Download, FileUp } from 'lucide-react'
import { Button, Code, Notice, PageHeader, Section, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Page, Status } from '@/components/workspace/kit'
import { RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { PRODUCT_STATE, timingLabel, type Issue, type ProductView, type RoutineView } from '@/lib/routines'
import { useCommand } from '@/lib/use-api'

interface Preview {
  valid: boolean; issues: Issue[]; skipped: Array<{ path: string; reason: string }>; fingerprint: string | null; duplicateOf: string | null
  preview: { title: string; titleEn: string | null; concernSlug: string; careArea: string; description: string | null
    steps: Array<{ index: number; timing: string; title: string; usage: string | null; optional: boolean; product: ProductView | null; alternatives: ProductView[] }> } | null
}

const MAX_BYTES = 64 * 1024

/** Import a Ready Routine from a JSON file: validate → preview → confirm → DRAFT. Never published, never touches the catalog. */
export default function ImportRoutinePage() {
  const router = useRouter()
  const [document, setDocument] = React.useState<unknown>(null)
  const [fileName, setFileName] = React.useState('')
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<Preview | null>(null)

  const check = useCommand((doc: unknown) => api<Preview>('/care/admin/studio/import/preview', { body: { document: doc } }))
  const create = useCommand(() => api<RoutineView>('/care/admin/studio/import', { body: { document, confirm: true } }))
  const sample = useCommand(() => api<{ example: unknown }>('/care/admin/studio/import/schema'))

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setPreview(null); setDocument(null); setFileError(null)
    if (!file) return
    setFileName(file.name)
    if (!/\.json$/i.test(file.name)) { setFileError('الملف لازم يكون بصيغة .json'); return }
    if (file.size > MAX_BYTES) { setFileError(`الملف أكبر من ${MAX_BYTES / 1024} كيلوبايت`); return }
    let parsed: unknown
    try { parsed = JSON.parse(await file.text()) } catch { setFileError('الملف مش JSON صالح'); return }
    setDocument(parsed)
    const result = await check.execute(parsed)
    if (result) setPreview(result)
  }

  const downloadExample = async () => {
    const result = await sample.execute()
    if (!result) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.example, null, 2)], { type: 'application/json' }))
    const link = window.document.createElement('a')
    link.href = url; link.download = 'routine-example.json'; link.click()
    URL.revokeObjectURL(url)
  }

  const confirm = async () => {
    const created = await create.execute()
    if (created) router.push(`/admin/routines/${created.id}`)
  }
  const errors = preview?.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = preview?.issues.filter((i) => i.severity === 'warning') ?? []

  return (
    <RoleShell role="admin" active="routines" mode="desktop">
      <Page>
        <PageHeader eyebrow="استوديو الروتين" title="استيراد روتين من JSON" meta="الاستيراد بيعمل مسودة فقط. بعدها بتراجع وتعدّل وتنشر بنفسك."
          actions={<Link href="/admin/routines" className="inline-flex"><Button variant="secondary" type="button"><ArrowRight className="size-4" aria-hidden />كل الروتينات</Button></Link>} />
        <Section title="١. اختر الملف" aside={<Button variant="ghost" loading={sample.pending} onClick={downloadExample}><Download className="size-4" aria-hidden />تحميل ملف مثال</Button>}>
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-bw-field border-[1.5px] border-dashed border-bw-line-field p-4 text-center">
            <FileUp className="size-5" aria-hidden />
            <span className="font-semibold">{fileName || 'اضغط لاختيار ملف .json'}</span>
            <span className="text-bw-small text-bw-ink-soft">الصيغة <Code>shinacare.routine/v1</Code> · حتى {MAX_BYTES / 1024} ك.ب · بدون روابط تتفتح ولا تعديل في الكتالوج</span>
            <input type="file" accept="application/json,.json" className="sr-only" onChange={onFile} />
          </label>
          {fileError ? <Notice tone="danger" title={fileError} /> : null}
          <CommandError error={check.error ?? sample.error} />
        </Section>

        {preview ? (
          <Section title="٢. المعاينة">
            <div className="space-y-4">
              {errors.length ? (
                <Notice tone="danger" title={`${errors.length} خطأ لازم يتصلّح قبل الإنشاء`}>
                  <ul className="mt-1 space-y-1">{errors.map((issue, i) => <li key={i}>{issue.message} <Code>{issue.path}</Code> <Code>{issue.code}</Code></li>)}</ul>
                </Notice>
              ) : <Notice tone="ok" title="الملف سليم" />}
              {preview.duplicateOf ? <Notice tone="warn" title="الروتين ده اتستورد قبل كده"><Link className="underline" href={`/admin/routines/${preview.duplicateOf}`}>افتح المسودة الموجودة</Link></Notice> : null}
              {warnings.length ? (
                <Notice tone="warn" title={`${warnings.length} تنبيه`}>
                  <ul className="mt-1 space-y-1">{warnings.map((issue, i) => <li key={i}>{issue.message} <Code>{issue.path}</Code></li>)}</ul>
                </Notice>
              ) : null}
              {preview.skipped.length ? (
                <Notice tone="info" title="عناصر اتخطّت (مش هتتضاف للمسودة)">
                  <ul className="mt-1 space-y-1">{preview.skipped.map((item, i) => <li key={i}>{item.reason} <Code>{item.path}</Code></li>)}</ul>
                </Notice>
              ) : null}
              {preview.preview ? (
                <div className="space-y-3">
                  <p className="font-semibold"><bdi>{preview.preview.title}</bdi> <span className="text-bw-small font-normal text-bw-ink-soft"><Code>{preview.preview.concernSlug}</Code></span></p>
                  {preview.preview.description ? <p className="text-bw-small text-bw-ink-soft">{preview.preview.description}</p> : null}
                  <ol className="space-y-2">
                    {preview.preview.steps.map((step) => (
                      <li key={step.index} className="space-y-1 rounded-bw-field border border-bw-line p-3 text-bw-small">
                        <p className="font-semibold">{step.index + 1}. {step.title} <span className="font-normal text-bw-ink-soft">· {timingLabel(step.timing)}{step.optional ? ' · اختياري' : ''}</span></p>
                        {step.usage ? <p className="text-bw-ink-soft">{step.usage}</p> : null}
                        {step.product ? <PreviewProduct product={step.product} /> : <StatusLabel tone="danger">المنتج مش متعرّف</StatusLabel>}
                        {step.alternatives.map((alt, i) => <PreviewProduct key={i} product={alt} alternative />)}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              <CommandError error={create.error} />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={confirm} loading={create.pending} disabled={!preview.valid}>إنشاء مسودة</Button>
                <span className="text-bw-small text-bw-ink-soft">مش هتتنشر تلقائيًا.</span>
              </div>
            </div>
          </Section>
        ) : null}
      </Page>
    </RoleShell>
  )
}

function PreviewProduct({ product, alternative = false }: { product: ProductView; alternative?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-bw-ink-soft">{alternative ? 'بديل' : 'المنتج'}</span>
      <bdi className="font-semibold">{product.productName}</bdi>
      <span>{product.variantName}{product.size ? ` · ${product.size} ${product.sizeUnit ?? ''}` : ''}</span>
      {product.skuCode ? <Code>{product.skuCode}</Code> : null}
      <Status map={PRODUCT_STATE} value={product.state} />
    </div>
  )
}
