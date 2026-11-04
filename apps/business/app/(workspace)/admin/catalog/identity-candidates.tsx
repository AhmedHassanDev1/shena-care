'use client'

import * as React from 'react'
import { CheckCircle2, Clock, FilePlus2, XCircle } from 'lucide-react'
import { Button, Code, Field, Notice, Skeleton, StateBlock, StatusLabel, type Tone } from '@/components/bw/primitives'
import { LoadError } from '@/components/workspace/role-shell'
import { api, type ApiError } from '@/lib/api'
import {
  BARCODE_STATE_LABELS,
  candidateRows,
  conflictReason,
  DECISION_LABELS,
  emptyCandidatesText,
  evidenceIsEnough,
  packagingText,
  refusalReasons,
  ROUTE_LABELS,
  samePackagingLabel,
  type Bilingual,
  type IdentityRoute,
  type Reason,
  type ReviewRecord,
} from '@/lib/candidate-review'
import { formatDateTime } from '@/lib/labels'
import { useCommand } from '@/lib/use-api'

const ROUTE_TONE: Record<IdentityRoute, Tone> = { VERIFIED: 'ok', CONFLICT: 'danger', AMBIGUOUS: 'warn', NEW: 'info' }

/** Arabic first, its English beside it; the English is an LTR isolate so RTL never reorders it. */
function Both({ text, className }: { text: Bilingual; className?: string }) {
  return (
    <span className={className}>
      {text.ar} <span aria-hidden className="text-bw-ink-subtle">·</span>{' '}
      <bdi lang="en" dir="ltr" className="text-bw-ink-soft">{text.en}</bdi>
    </span>
  )
}

function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="space-y-1 text-bw-small">
      {reasons.map((reason, index) => (
        <li key={index}>
          <Both text={reason} />
          {reason.detail ? <p><Code className="break-all whitespace-normal">{reason.detail}</Code></p> : null}
        </li>
      ))}
    </ul>
  )
}

function Words({ label, words }: { label: Bilingual; words?: string[] }) {
  if (!words?.length) return null
  return (
    <p className="text-bw-small text-bw-ink-soft">
      <Both text={label} />: <bdi className="text-bw-ink">{words.join('، ')}</bdi>
    </p>
  )
}

function Fact({ label, children }: { label: Bilingual; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-bw-small text-bw-ink-soft"><Both text={label} /></dt>
      <dd className="break-words text-bw-small font-semibold text-bw-ink">{children}</dd>
    </div>
  )
}

/** The supplier row as stated, how matching read it, and what stays unknown. */
function SupplierRow({ record }: { record: ReviewRecord }) {
  const row = record.originalSupplierRow
  const read = record.identityMatch.interpretation
  return (
    <div className="space-y-3 rounded-bw-field border border-bw-line/70 bg-bw-sunken/40 p-3">
      <p className="text-bw-small font-semibold text-bw-ink"><Both text={{ ar: 'صف المورد', en: 'Supplier row' }} /></p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <Fact label={{ ar: 'الاسم زي ما المورد كتبه', en: 'Name as stated' }}><bdi>{row.statedName}</bdi></Fact>
        <Fact label={{ ar: 'البراند', en: 'Brand' }}><bdi>{record.normalizedIdentity.brand}</bdi></Fact>
        <Fact label={{ ar: 'المورد', en: 'Supplier' }}><bdi>{row.supplierName ?? '—'}</bdi></Fact>
        <Fact label={{ ar: 'كود المورد', en: 'Supplier code' }}><Code>{row.supplierSkuCode}</Code></Fact>
        <Fact label={{ ar: 'الباركود', en: 'Barcode' }}>
          {row.barcode ? <Code>{row.barcode}</Code> : row.invalidBarcode ? <Code className="break-all whitespace-normal">{row.invalidBarcode}</Code> : '—'}{' '}
          <StatusLabel tone={read.barcodeState === 'VALID' ? 'ok' : read.barcodeState === 'INVALID' ? 'danger' : 'pending'}><Both text={BARCODE_STATE_LABELS[read.barcodeState]} /></StatusLabel>
        </Fact>
        <Fact label={{ ar: 'المصدر', en: 'Source' }}>
          <bdi>{row.sourceFile?.fileName ?? '—'}</bdi>{row.sourceFile?.row ? <> · <Code>#{row.sourceFile.row}</Code></> : null}
        </Fact>
      </dl>
      <div className="space-y-1 border-t border-bw-line/70 pt-2">
        <p className="text-bw-small font-semibold text-bw-ink"><Both text={{ ar: 'قراءة النظام', en: 'How matching read it' }} /></p>
        <p className="text-bw-small text-bw-ink"><Both text={packagingText(read)} /></p>
        <Words label={{ ar: 'حقائق مذكورة', en: 'Stated facts' }} words={[...read.facts, ...read.formula]} />
        <Words label={{ ar: 'كلام غير مفهوم', en: 'Unread wording' }} words={read.unreadWords} />
        {read.unresolved.length ? <Reasons reasons={read.unresolved.map(conflictReason)} /> : null}
      </div>
    </div>
  )
}

/** Identity route and Top-K candidates. Every decision goes to an existing endpoint, which alone decides. */
export function IdentityCandidates({
  candidateId,
  record,
  loading,
  error,
  onRetry,
  onConfirmed,
}: {
  candidateId: string
  record: ReviewRecord | undefined
  loading: boolean
  error: ApiError | null
  onRetry: () => void
  onConfirmed: () => void
}) {
  const [pickedSkuId, setPickedSkuId] = React.useState<string | null>(null)
  const [evidence, setEvidence] = React.useState('')
  const confirm = useCommand(async (skuId: string) => {
    setPickedSkuId(skuId)
    await api(`/ingestion/candidates/${candidateId}/approve`, { method: 'PATCH', body: { matchedSkuId: skuId, identityEvidence: evidence.trim() } })
    return skuId
  })
  // These endpoints may answer with no body, so success is stated here rather than read from the response.
  const differentProduct = useCommand(async () => {
    await api(`/ingestion/candidates/${candidateId}/approve`, { method: 'PATCH', body: { createNewProduct: true, identityEvidence: evidence.trim() } })
    return true
  })
  const hold = useCommand(async () => {
    await api(`/ingestion/candidates/${candidateId}/request-more`, { method: 'POST', body: { requestedInfo: evidence.trim() } })
    return true
  })
  const reject = useCommand(async () => {
    await api(`/ingestion/candidates/${candidateId}/reject`, { method: 'PATCH', body: { reason: evidence.trim() } })
    return true
  })
  const anyPending = confirm.pending || differentProduct.pending || hold.pending || reject.pending
  const refusal = confirm.error ?? differentProduct.error ?? hold.error ?? reject.error
  const settled = async (run: () => Promise<unknown>) => {
    if (await run()) {
      setEvidence('')
      onConfirmed()
    }
  }

  if (error) return <LoadError message={error.message} onRetry={onRetry} />
  if (!record) {
    return loading ? (
      <div role="status" className="space-y-2">
        <p className="text-bw-small text-bw-ink-soft"><Both text={{ ar: 'جاري تحميل مرشحي الهوية', en: 'Loading identity candidates' }} /></p>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    ) : null
  }

  const match = record.identityMatch
  const rows = candidateRows(match)
  const linkedSkuId = record.normalizedIdentity.matchedSkuId
  const empty = emptyCandidatesText(match.route)
  // A row already decided as new continues in the candidate flow below; it can still be rejected there.
  const open = !linkedSkuId && record.status === 'review_required'

  return (
    <section aria-labelledby="identity-candidates-title" className="sc-card space-y-3 border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="identity-candidates-title" className="text-bw-small font-bold text-bw-ink">
          <Both text={{ ar: 'مطابقة الهوية', en: 'Identity match' }} />
        </h4>
        {/* Two languages rarely fit one line on a phone; the label wraps instead of pushing the panel wider. */}
        <div className="max-w-full min-w-0 [&_*]:whitespace-normal">
          {linkedSkuId ? (
            <StatusLabel tone="ok"><Both text={{ ar: 'مربوط بمنتج', en: 'Linked to a SKU' }} /></StatusLabel>
          ) : match.route ? (
            <StatusLabel tone={ROUTE_TONE[match.route]}><Both text={ROUTE_LABELS[match.route]} /></StatusLabel>
          ) : null}
        </div>
      </div>

      <SupplierRow record={record} />

      {match.review ? (
        <Notice tone="info" title={`${DECISION_LABELS[match.review.decision]?.ar ?? match.review.decision} · ${DECISION_LABELS[match.review.decision]?.en ?? match.review.decision}`}>
          {match.review.evidence ? <p><bdi>{match.review.evidence}</bdi></p> : null}
          <p className="text-bw-small text-bw-ink-soft">{formatDateTime(match.review.reviewedAt)}</p>
        </Notice>
      ) : null}

      {!linkedSkuId && match.conflicts.length > 0 ? (
        <div className="space-y-1">
          <p className="text-bw-small font-semibold text-bw-ink"><Both text={{ ar: 'الأسباب', en: 'Reasons' }} /></p>
          <Reasons reasons={match.conflicts.map(conflictReason)} />
        </div>
      ) : null}

      {open ? (
        <Field
          label="الدليل أو السبب · Evidence or reason"
          hint="مطلوب لأي قرار، وبيتسجل باسمك · Required for every decision, recorded under your name"
          value={evidence}
          onChange={event => setEvidence(event.target.value)}
          maxLength={500}
        />
      ) : null}

      {rows.length === 0 ? (
        <StateBlock kind="empty" title={`${empty.title.ar} · ${empty.title.en}`} body={`${empty.body.ar} ${empty.body.en}`} />
      ) : (
        <ol className="space-y-2">
          {rows.map((row, index) => {
            const packaging = samePackagingLabel(row.samePackaging)
            return (
              <li key={row.skuId} className="flex flex-wrap items-center justify-between gap-3 rounded-bw-field border border-bw-line/70 bg-bw-sunken/40 p-3">
                {row.imageUrl ? (
                  // A verified catalog image only; nothing is shown when the catalog has none.
                  <img src={row.imageUrl} alt={row.productName} className="size-16 shrink-0 rounded-bw-field border border-bw-line/70 object-cover" />
                ) : null}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Code>#{index + 1}</Code>
                    <bdi className="font-semibold text-bw-ink">{row.productName}</bdi>
                    {row.suggested ? <StatusLabel tone="info"><Both text={{ ar: 'مقترح', en: 'Suggested' }} /></StatusLabel> : null}
                    {row.skuId === linkedSkuId ? <StatusLabel tone="ok"><Both text={{ ar: 'تم التأكيد', en: 'Confirmed' }} /></StatusLabel> : null}
                  </div>
                  <p className="text-bw-small text-bw-ink-soft"><Code>{row.code}</Code></p>
                  <p className="text-bw-small text-bw-ink"><Both text={packagingText(row)} /></p>
                  {row.variantName ? <p className="text-bw-small text-bw-ink-soft"><Both text={{ ar: 'النوع', en: 'Variant' }} />: <bdi className="text-bw-ink">{row.variantName}</bdi></p> : null}
                  <Words label={{ ar: 'التركيبة', en: 'Formula' }} words={row.formula} />
                  <Words label={{ ar: 'بيتفقوا في', en: 'Both state' }} words={row.shared} />
                  <Words label={{ ar: 'في صف المورد بس', en: 'Only in the row' }} words={row.onlySupplier} />
                  <Words label={{ ar: 'في الكتالوج بس', en: 'Only in the catalog' }} words={row.onlyCatalog} />
                  {row.missing?.length ? <Reasons reasons={row.missing.map(conflictReason)} /> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {packaging ? <StatusLabel tone={packaging.tone}><Both text={packaging.text} /></StatusLabel> : null}
                    {row.score !== null ? (
                      <span className="text-bw-small text-bw-ink-subtle">
                        <Both text={{ ar: 'درجة الترتيب', en: 'Rank score' }} /> <Code>{row.score}</Code>
                      </span>
                    ) : null}
                  </div>
                </div>
                {match.confirmable ? (
                  <Button
                    variant="secondary"
                    className="h-auto w-full whitespace-normal py-2 sm:w-auto"
                    loading={confirm.pending && pickedSkuId === row.skuId}
                    disabled={anyPending || !evidenceIsEnough(evidence)}
                    onClick={() => settled(() => confirm.execute(row.skuId))}
                  >
                    <CheckCircle2 className="size-4" aria-hidden />
                    <Both text={{ ar: 'تأكيد المنتج ده', en: 'Confirm this SKU' }} />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}

      {match.rejectedCandidates.length ? (
        <div className="space-y-2">
          <p className="text-bw-small font-semibold text-bw-ink"><Both text={{ ar: 'منتجات قريبة بس فيها تعارض', en: 'Close SKUs ruled out by a stated fact' }} /></p>
          <ul className="space-y-2">
            {match.rejectedCandidates.map(row => (
              <li key={row.skuId} className="space-y-1 rounded-bw-field border border-bw-line/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <bdi className="font-semibold text-bw-ink">{row.productName}</bdi>
                  <Code>{row.code}</Code>
                  <StatusLabel tone="danger"><Both text={{ ar: 'مينفعش يتأكد', en: 'Cannot be confirmed' }} /></StatusLabel>
                </div>
                <p className="text-bw-small text-bw-ink"><Both text={packagingText(row)} /></p>
                <Reasons reasons={row.conflicts.map(conflictReason)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {open ? (
        <div className="space-y-3 border-t border-bw-line/70 pt-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="h-auto whitespace-normal py-2" loading={differentProduct.pending} disabled={anyPending || !evidenceIsEnough(evidence)}
              onClick={() => settled(() => differentProduct.execute())}>
              <FilePlus2 className="size-4" aria-hidden />
              <Both text={{ ar: 'منتج مختلف أو جديد', en: 'Different or new product' }} />
            </Button>
            <Button variant="secondary" className="h-auto whitespace-normal py-2" loading={hold.pending} disabled={anyPending || !evidenceIsEnough(evidence)}
              onClick={() => settled(() => hold.execute())}>
              <Clock className="size-4" aria-hidden />
              <Both text={{ ar: 'تعليق لحد الدليل', en: 'Hold for evidence' }} />
            </Button>
            <Button variant="danger" className="h-auto whitespace-normal py-2" loading={reject.pending} disabled={anyPending || !evidenceIsEnough(evidence)}
              onClick={() => settled(() => reject.execute())}>
              <XCircle className="size-4" aria-hidden />
              <Both text={{ ar: 'رفض الصف', en: 'Reject as invalid' }} />
            </Button>
          </div>
        </div>
      ) : null}

      {refusal ? (
        <Notice tone="danger" title="القرار اترفض · Decision refused">
          <Reasons reasons={refusalReasons(refusal.message)} />
        </Notice>
      ) : null}
    </section>
  )
}
