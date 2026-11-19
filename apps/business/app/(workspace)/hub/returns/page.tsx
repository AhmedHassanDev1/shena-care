'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Select, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { useToast } from '@/components/bw/toast'
import { Flash } from '@/components/bw/ops'
import { HubShell, useHub } from '@/components/workspace/hub'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Result = 'SEALED_INTACT' | 'OPENED_UNUSED' | 'USED' | 'DAMAGED' | 'EXPIRED'
type Disposition = 'RETURN_TO_SUPPLIER' | 'WRITE_OFF' | 'QUARANTINE'
interface Inspection {
  id: string; quantity: number; result: Result; disposition: Disposition; lotNumber: string | null; expiryDate: string | null
  note: string | null; supersedesId: string | null; correctionReason: string | null; receivedAt: string
}
interface ReturnLine {
  orderItemId: string; skuId: string; quantity: number; productName: string | null; variantName: string | null; skuCode: string | null
  barcode: string | null; inspection: Inspection | null; history: Inspection[]
}
interface ReturnCase {
  resolutionId: string; orderId: string; orderNumber: string; status: 'approved' | 'in_transit' | 'received'; reasonCode: string | null
  requestedAt: string; safetyReport: boolean; description: string | null
  refund: { status: string; amount: string; currency: string } | null
  lines: ReturnLine[]; allInspected: boolean
}
interface InspectResult { outcome: 'recorded' | 'rejected' | 'corrected'; code?: string; replayed?: boolean; case: ReturnCase }

const RESULT: Record<Result, string> = {
  SEALED_INTACT: 'مقفولة وسليمة', OPENED_UNUSED: 'مفتوحة ومااتستخدمتش', USED: 'مستخدمة', DAMAGED: 'تالفة', EXPIRED: 'منتهية الصلاحية',
}
const DISPOSITION: Record<Disposition, string> = {
  RETURN_TO_SUPPLIER: 'ترجع للمورد', WRITE_OFF: 'تتشطب (خسارة)', QUARANTINE: 'تتحجز للفحص',
}
const STATUS: Record<ReturnCase['status'], { label: string; tone: 'info' | 'warn' | 'ok' }> = {
  approved: { label: 'مستني البضاعة', tone: 'info' }, in_transit: { label: 'في الطريق', tone: 'warn' }, received: { label: 'اتستلم واتفحص', tone: 'ok' },
}
const REASON: Record<string, string> = {
  WRONG_ITEM: 'منتج غلط', MISSING_ITEM: 'ناقص', DAMAGED_OR_LEAKING: 'تالف أو بيسرّب', DEFECT_OR_QUALITY_CONCERN: 'عيب أو جودة', EXPIRED_PRODUCT: 'منتهي الصلاحية',
  CHANGE_OF_MIND: 'العميل غيّر رأيه', DELIVERY_PROBLEM: 'مشكلة توصيل', POSSIBLE_ADVERSE_EVENT: 'بلاغ سلامة', OTHER: 'سبب تاني',
}
const REFUND: Record<string, string> = { pending: 'مستني', processing: 'بيتنفّذ', succeeded: 'اتصرف', failed: 'فشل' }
const REJECT: Record<string, string> = {
  PRODUCT_IDENTITY_MISMATCH: 'المنتج اللي مسحته مش هو المنتج اللي العميل اشتراه. مااتسجّلش حاجة.',
  PRODUCT_IDENTITY_REVIEW_REQUIRED: 'الباركود ده مش متسجّل لأي منتج متراجع. اتحقق يدوي.',
  PRODUCT_IDENTITY_AMBIGUOUS: 'الباركود ده متسجّل لأكتر من منتج. اتحقق يدوي.',
}
const CHECKS = ['brand', 'variant', 'size', 'pack']

/**
 * Returns (GLO-315): receive and inspect what a customer sent back. This records what physically arrived and what happens to it. It does
 * not approve, resolve or pay a refund: that decision and its proof stay with the admin, and its state is only shown here.
 */
export default function HubReturns() {
  return <HubShell active="returns"><Body /></HubShell>
}

function Body() {
  const hub = useHub()
  const { data, error, loading, reload } = useApi<{ items: ReturnCase[] }>(`/fulfillment/locations/${hub.id}/returns`, { pollMs: 30000 })
  const [updated, setUpdated] = React.useState<ReturnCase | null>(null)
  React.useEffect(() => { setUpdated(null) }, [data])
  const items = (data?.items ?? []).map((c) => (updated && updated.resolutionId === c.resolutionId ? updated : c))
  return (
    <Page>
      <PageHeader
        title="المرتجعات"
        meta="استلم المنتج اللي رجع، اتأكد إنه هو، افحصه وسجّل هيحصله إيه. قرار الاسترداد المالي بتاع الإدارة، مش من هنا."
        actions={<Button variant="secondary" size="sm" onClick={reload} loading={loading && !!data}>{!(loading && !!data) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>}
      />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <div className="space-y-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div> : null}
      {data && items.length === 0 ? <div className="bw-panel"><StateBlock kind="empty" title="مافيش مرتجعات مستنية" body="لما الإدارة توافق على مرتجع فيه بضاعة راجعة للمخزن، بيظهر هنا." /></div> : null}
      <div className="space-y-4">
        {items.map((c) => <CaseCard key={c.resolutionId} c={c} onCase={setUpdated} onChanged={reload} />)}
      </div>
    </Page>
  )
}

function CaseCard({ c, onCase, onChanged }: { c: ReturnCase; onCase: (c: ReturnCase) => void; onChanged: () => void }) {
  const status = STATUS[c.status]
  return (
    <section className="bw-panel bw-arrive overflow-hidden" aria-label={`مرتجع طلب ${c.orderNumber}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-bw-line px-4 py-3">
        <h2 className="text-bw-body font-semibold text-bw-ink">طلب <Code>{c.orderNumber.replace(/^ORD-/, '#')}</Code></h2>
        <StatusLabel tone={status.tone}>{status.label}</StatusLabel>
        <span className="text-bw-small text-bw-ink-soft">{REASON[c.reasonCode ?? ''] ?? c.reasonCode ?? '—'} · {formatDateTime(c.requestedAt)}</span>
        {c.safetyReport ? <StatusLabel tone="danger">بلاغ سلامة — احجز البضاعة</StatusLabel> : null}
        <span className="ms-auto text-[12px] text-bw-ink-subtle">
          الاسترداد المالي (الإدارة): {c.refund ? <>{REFUND[c.refund.status] ?? c.refund.status} · <Code>{c.refund.amount}</Code> {c.refund.currency}</> : 'لسه ماتقرّرش'}
        </span>
      </div>
      {c.description ? <p className="border-b border-bw-line px-4 py-2 text-bw-small text-bw-ink-soft"><bdi>{c.description}</bdi></p> : null}
      <ul className="divide-y divide-bw-line">
        {c.lines.map((line) => <LineRow key={line.orderItemId} c={c} line={line} onCase={onCase} onChanged={onChanged} />)}
      </ul>
      {c.allInspected ? <div className="border-t border-bw-line px-4 py-3"><Flash tone="ok">كل المنتجات اتستلمت واتفحصت. الإدارة هي اللي بتقرر الاسترداد وتقفل المرتجع.</Flash></div> : null}
    </section>
  )
}

function LineRow({ c, line, onCase, onChanged }: { c: ReturnCase; line: ReturnLine; onCase: (c: ReturnCase) => void; onChanged: () => void }) {
  const [correcting, setCorrecting] = React.useState(false)
  const insp = line.inspection
  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-semibold text-bw-ink"><bdi>{line.productName ?? line.skuCode}</bdi> <span className="font-normal text-bw-ink-soft"><bdi>{line.variantName}</bdi></span></p>
        <span className="text-[12px] text-bw-ink-soft">راجع <Code>{line.quantity}</Code> · <Code>{line.skuCode ?? '—'}</Code>{line.barcode ? <> · <Code>{line.barcode}</Code></> : null}</span>
      </div>
      {insp ? (
        <div className="space-y-2">
          <p className="text-bw-small text-bw-ink">
            اتفحصت: <strong><Code>{insp.quantity}</Code> {RESULT[insp.result]}</strong> → {DISPOSITION[insp.disposition]}
            {insp.lotNumber ? <> · تشغيلة <Code>{insp.lotNumber}</Code></> : null}{insp.expiryDate ? <> · صلاحية <Code>{insp.expiryDate}</Code></> : null}
            {insp.note ? <> · <bdi>{insp.note}</bdi></> : null}
          </p>
          {line.history.length > 1 ? (
            <ul className="space-y-0.5 text-[12px] text-bw-ink-soft">
              {line.history.filter((h) => h.id !== insp.id).map((h) => <li key={h.id}>قبل التصحيح: {RESULT[h.result]} → {DISPOSITION[h.disposition]}</li>)}
              {insp.correctionReason ? <li>سبب التصحيح: <bdi>{insp.correctionReason}</bdi></li> : null}
            </ul>
          ) : null}
          {correcting
              ? <InspectionForm c={c} line={line} mode="correct" inspection={insp} onCancel={() => setCorrecting(false)} onDone={(next) => { setCorrecting(false); onCase(next); onChanged() }} />
              : <button type="button" className="text-[12px] font-semibold text-bw-cobalt underline-offset-4 hover:underline" onClick={() => setCorrecting(true)}>تصحيح الفحص</button>}
        </div>
      ) : (
        <InspectionForm c={c} line={line} mode="new" onDone={(next) => { onCase(next); onChanged() }} />
      )}
    </li>
  )
}

function InspectionForm({ c, line, mode, inspection, onDone, onCancel }: {
  c: ReturnCase; line: ReturnLine; mode: 'new' | 'correct'; inspection?: Inspection; onDone: (next: ReturnCase) => void; onCancel?: () => void
}) {
  const hub = useHub()
  const [manual, setManual] = React.useState(false)
  const [barcode, setBarcode] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [checks, setChecks] = React.useState<string[]>([])
  const [quantity, setQuantity] = React.useState(String(inspection?.quantity ?? line.quantity))
  const [result, setResult] = React.useState<Result>(inspection?.result ?? 'SEALED_INTACT')
  const [disposition, setDisposition] = React.useState<Disposition | ''>(inspection?.disposition ?? '')
  const [lot, setLot] = React.useState(inspection?.lotNumber ?? '')
  const [expiry, setExpiry] = React.useState(inspection?.expiryDate ?? '')
  const [note, setNote] = React.useState(inspection?.note ?? '')
  const [why, setWhy] = React.useState('')
  const toast = useToast()
  const key = React.useRef(newKey())
  const touch = () => { key.current = newKey() }

  // Owner policy: only sealed, intact goods go back to the supplier; a safety report is always held.
  const options: Disposition[] = c.safetyReport ? ['QUARANTINE'] : result === 'SEALED_INTACT' ? ['RETURN_TO_SUPPLIER', 'WRITE_OFF', 'QUARANTINE'] : ['WRITE_OFF', 'QUARANTINE']
  const effective: Disposition = disposition && options.includes(disposition) ? disposition : options[0]

  const submit = useCommand(() => api<InspectResult>(
    mode === 'new'
      ? `/fulfillment/locations/${hub.id}/returns/${c.resolutionId}/inspections`
      : `/fulfillment/locations/${hub.id}/returns/${c.resolutionId}/inspections/${inspection!.id}/correct`,
    { body: {
      idempotencyKey: key.current, orderItemId: line.orderItemId, quantity: Number(quantity), result, disposition: effective,
      ...(lot.trim() ? { lotNumber: lot.trim() } : {}), ...(expiry ? { expiryDate: expiry } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      ...(mode === 'new' ? (manual ? { manualReason: reason.trim(), manualChecks: checks } : { barcodeScanned: barcode.trim() }) : { reason: why.trim() }),
    } },
  ))
  const qty = Number(quantity)
  const evidenceOk = mode === 'correct' ? why.trim().length >= 5 : manual ? reason.trim().length > 0 && checks.length === CHECKS.length : barcode.trim().length > 0
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= line.quantity && evidenceOk

  return (
    <form className={cn('space-y-3', mode === 'correct' && 'rounded-bw-field border border-bw-line p-3')} onSubmit={async (event) => {
      event.preventDefault()
      const r = await submit.execute()
      if (!r) return
      if (r.outcome === 'rejected') { toast.error(REJECT[r.code ?? ''] ?? 'الفحص اترفض.'); key.current = newKey(); setBarcode(''); onDone(r.case); return }
      key.current = newKey()
      onDone(r.case)
    }}>
      {mode === 'new' ? (
        manual ? (
          <div className="space-y-2">
            <Field label="سبب التحقق اليدوي (مفيش باركود مقروء)" value={reason} onChange={(e) => { setReason(e.target.value); touch() }} />
            <fieldset className="flex flex-wrap gap-3 text-bw-small">
              <legend className="mb-1 font-semibold">اتأكدت من:</legend>
              {[['brand', 'الماركة'], ['variant', 'النوع'], ['size', 'الحجم'], ['pack', 'العبوة']].map(([v, t]) => (
                <label key={v} className="flex items-center gap-1"><input type="checkbox" checked={checks.includes(v)} onChange={(e) => { setChecks(e.target.checked ? [...checks, v] : checks.filter((x) => x !== v)); touch() }} />{t}</label>
              ))}
            </fieldset>
          </div>
        ) : <Field label="امسح باركود المنتج الراجع" ltr autoComplete="off" value={barcode} onChange={(e) => { setBarcode(e.target.value); touch() }} />
      ) : (
        <Field label="سبب التصحيح (٥ حروف على الأقل)" value={why} onChange={(e) => { setWhy(e.target.value); touch() }} />
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الكمية الراجعة فعلًا" ltr inputMode="numeric" value={quantity} onChange={(e) => { setQuantity(e.target.value.replace(/[^\d]/g, '')); touch() }}
          error={qty > line.quantity ? `أكتر من المطلوب (${line.quantity})` : undefined} />
        <Select label="حالة المنتج بعد الفحص" value={result} onChange={(e) => { setResult(e.target.value as Result); touch() }} options={(Object.keys(RESULT) as Result[]).map((value) => ({ value, label: RESULT[value] }))} />
        <Select label="هيحصله إيه" value={effective} onChange={(e) => { setDisposition(e.target.value as Disposition); touch() }} options={options.map((value) => ({ value, label: DISPOSITION[value] }))} />
        <Field label="رقم التشغيلة (اختياري)" ltr value={lot} onChange={(e) => { setLot(e.target.value); touch() }} />
        <Field label="تاريخ الصلاحية (اختياري)" type="date" ltr value={expiry} onChange={(e) => { setExpiry(e.target.value); touch() }} />
        <Field className="sm:col-span-2" label="ملاحظة (اختياري)" value={note} onChange={(e) => { setNote(e.target.value); touch() }} />
      </div>
      {c.safetyReport ? <Notice tone="warn" title="بلاغ سلامة: البضاعة بتتحجز ومابترجعش للمورد ولا بتتشطب لحد قرار الإدارة." /> : result !== 'SEALED_INTACT' ? <p className="text-[12px] text-bw-ink-subtle">اللي مش مقفول وسليم مابيرجعش للمورد؛ بيتشطب أو بيتحجز.</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={submit.pending} disabled={!valid}>{mode === 'new' ? 'تسجيل الاستلام والفحص' : 'تأكيد التصحيح'}</Button>
        {mode === 'new' ? <button type="button" className="text-bw-small font-semibold text-bw-cobalt underline-offset-4 hover:underline" onClick={() => { setManual(!manual); touch() }}>{manual ? 'رجوع لمسح الباركود' : 'تحقق يدوي'}</button> : <Button type="button" variant="secondary" onClick={onCancel}>إلغاء</Button>}
      </div>
      <CommandError error={submit.error} />
    </form>
  )
}
