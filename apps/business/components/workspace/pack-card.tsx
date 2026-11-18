'use client'

import * as React from 'react'
import { Check, Printer, RotateCcw } from 'lucide-react'
import { Button, Code, Field, StatusLabel } from '@/components/bw/primitives'
import { Flash } from '@/components/bw/ops'
import { CommandError, Status } from '@/components/workspace/kit'
import { api } from '@/lib/api'
import { SHIPMENT_STATUS } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type PrintStatus = 'pending' | 'printed' | 'failed'
/** The server's reading of which paper is printed right now (the latest confirmation or failure of each wins). */
export interface PrintState {
  receipt: PrintStatus; label: PrintStatus; labelGenerated: boolean; ready: boolean
  lastFailure: { document: 'RECEIPT' | 'LABEL' | 'BOTH'; note: string | null; at: string } | null
}
/** What the print + pack card needs about one shipment. */
export interface PackShipment {
  shipmentId: string; orderId: string; orderNumber: string | null; status: string; itemCount: number; printEvents: string[]; print?: PrintState
}
export type PackagingCosts = { BAG: number | null; BOX: number | null }
type Packaging = { packagingType: 'BAG' | 'BOX' | null; packagingCost: string | null }
type Doc = 'receipt' | 'slip'
const PACKAGING_LABEL = { BAG: 'شنطة', BOX: 'كرتونة' } as const
const egp = (value: string | number) => `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`

/** Older callers only know the event names: a document counts as printed only if it was confirmed and never reported failed. */
const fallbackPrint = (events: string[]): PrintState => ({
  receipt: events.includes('RECEIPT_PRINTED') && !events.includes('PRINT_FAILED') ? 'printed' : 'pending',
  label: events.includes('LABEL_PRINTED') && !events.includes('PRINT_FAILED') ? 'printed' : 'pending',
  labelGenerated: events.includes('LABEL_GENERATED'), ready: false, lastFailure: null,
})

/**
 * Print + pack of one verified order. Two thermal papers on the pharmacy's narrow printer: the customer receipt (inside the parcel) and the
 * external shipping slip with the shipment barcode. A browser preview is never a print: a paper can only be confirmed after it was sent to
 * the printer from this screen, a failure is recorded against that exact paper with its reason and reopens it for a reprint, and the parcel
 * can be marked ready for handoff only when both papers are confirmed right now and the packaging actually used is recorded. The server
 * enforces the same rule. Shared by the Orders & Preparation desk and the legacy pack page.
 */
export function PackCard({ s, onChanged, onPacked, packagingCosts }: { s: PackShipment; onChanged: () => void; onPacked?: () => void; packagingCosts: PackagingCosts | null }) {
  const recorded = useApi<Packaging>(`/order-costs/${s.orderId}`)
  const choose = useCommand((type: 'BAG' | 'BOX') => api(`/order-costs/${s.orderId}`, { method: 'PUT', body: { packagingType: type } }))
  const packagingType = recorded.data?.packagingType ?? null
  const [barcode, setBarcode] = React.useState<string | null>(null)
  const [opened, setOpened] = React.useState<Record<Doc, boolean>>({ receipt: false, slip: false })
  const [failing, setFailing] = React.useState<Doc | null>(null)
  const [reason, setReason] = React.useState('')
  const label = useCommand(() => api<{ barcode: string }>(`/fulfillment/shipments/${s.shipmentId}/label`, { method: 'POST' }))
  const event = useCommand((type: string, extra?: Record<string, unknown>) => api(`/fulfillment/shipments/${s.shipmentId}/events`, { body: { type, ...extra } }))
  const print = s.print ?? fallbackPrint(s.printEvents)
  const labelDone = print.labelGenerated || !!barcode
  const printed = print.receipt === 'printed' && print.label === 'printed'
  const packed = s.status === 'packed'
  const ready = printed && !!packagingType
  const record = async (type: string, extra?: Record<string, unknown>) => { const result = await event.execute(type, extra); if (result) onChanged(); return !!result }
  const open = (doc: Doc) => { setOpened((all) => ({ ...all, [doc]: true })); window.open(`/print/${s.shipmentId}?doc=${doc}`, `print-${doc}-${s.shipmentId}`, 'width=420,height=760') }
  const missing = [
    !labelDone ? 'ولّد بيانات البوليصة' : null,
    print.receipt !== 'printed' ? 'أكّد طباعة إيصال العميل' : null,
    print.label !== 'printed' ? 'أكّد طباعة بوليصة الشحن' : null,
    !packagingType ? 'اختار نوع التغليف المستخدم' : null,
  ].filter((text): text is string => !!text)

  return (
    <section className="bw-panel bw-arrive overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-bw-line px-4 py-3">
        <h2 className="text-bw-body font-semibold text-bw-ink">طلب <Code>{(s.orderNumber ?? '—').replace(/^ORD-/, '#')}</Code></h2>
        <span className="text-bw-small text-bw-ink-soft"><Code>{s.itemCount}</Code> قطعة</span>
        <Status map={SHIPMENT_STATUS} value={s.status} />
        {print.lastFailure && !printed ? <StatusLabel tone="warn">فشل طباعة — أعد الطباعة</StatusLabel> : null}
      </div>
      <ol className="grid md:grid-cols-3 md:[&>li:not(:first-child)]:border-s md:[&>li]:border-bw-line [&>li:not(:first-child)]:border-t md:[&>li:not(:first-child)]:border-t-0 [&>li]:border-bw-line">
        <Step n={1} done={labelDone} title="بيانات البوليصة">
          {labelDone ? <p className="text-[12px] text-bw-emerald">اتعملت{barcode ? <> · <Code>{barcode}</Code></> : null}</p> : null}
          <Button variant="secondary" size="sm" loading={label.pending} disabled={packed} onClick={async () => { const r = await label.execute(); if (r) { setBarcode(r.barcode); onChanged() } }}>
            {print.labelGenerated ? 'إعادة توليد (نفس الباركود)' : 'توليد البوليصة'}
          </Button>
        </Step>
        <Step n={2} done={printed} title="الطباعة على الطابعة الحرارية">
          <PrintRow title="إيصال العميل" status={print.receipt} failure={print.lastFailure && (print.lastFailure.document === 'RECEIPT' || print.lastFailure.document === 'BOTH') ? print.lastFailure.note : null}
            canPrint={!packed} opened={opened.receipt} onOpen={() => open('receipt')} busy={event.pending}
            onOk={() => record('RECEIPT_PRINTED')} onFail={() => { setFailing('receipt'); setReason('') }} />
          <PrintRow title="بوليصة الشحن" status={print.label} failure={print.lastFailure && (print.lastFailure.document === 'LABEL' || print.lastFailure.document === 'BOTH') ? print.lastFailure.note : null}
            canPrint={labelDone && !packed} opened={opened.slip} onOpen={() => open('slip')} busy={event.pending}
            onOk={() => record('LABEL_PRINTED')} onFail={() => { setFailing('slip'); setReason('') }} waitingFor={!labelDone ? 'ولّد البوليصة الأول' : undefined} />
          {failing ? (
            <form className="space-y-2 rounded-bw-field border border-bw-line p-2" onSubmit={async (e) => {
              e.preventDefault()
              if (await record('PRINT_FAILED', { document: failing === 'receipt' ? 'RECEIPT' : 'LABEL', notes: reason.trim() })) { setFailing(null); setOpened((all) => ({ ...all, [failing]: false })) }
            }}>
              <Field label={`إيه اللي حصل في طباعة ${failing === 'receipt' ? 'الإيصال' : 'البوليصة'}؟`} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="danger" loading={event.pending} disabled={reason.trim().length < 3}>سجّل الفشل</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setFailing(null)}>إلغاء</Button>
              </div>
            </form>
          ) : null}
        </Step>
        <Step n={3} done={packed} title="التغليف والتسليم">
          <p className="text-[12px] text-bw-ink-soft">حط الإيصال جوه، والبوليصة برّه بشريط أو جراب.</p>
          <div role="group" aria-label="نوع التغليف المستخدم" className="flex gap-2">
            {(['BAG', 'BOX'] as const).map((type) => {
              const cost = packagingCosts?.[type] ?? null
              return (
                <button
                  key={type} type="button" aria-pressed={packagingType === type} disabled={choose.pending || cost === null || (!!packagingType && packagingType !== type && !recorded.error) || packed}
                  onClick={async () => { if (await choose.execute(type)) recorded.reload() }}
                  className={cn('inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-bw-field border px-2 text-bw-small transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    packagingType === type ? 'border-bw-cobalt/60 bg-bw-cobalt-soft font-semibold text-bw-ink' : 'border-bw-line-field text-bw-ink-soft hover:border-bw-ink-subtle hover:text-bw-ink')}
                >
                  {PACKAGING_LABEL[type]}{cost !== null ? <span className="text-[11px] tabular-nums text-bw-ink-subtle">{cost}</span> : null}
                </button>
              )
            })}
          </div>
          {packagingType && recorded.data?.packagingCost ? <p className="text-[12px] text-bw-ink-soft">اتسجّل: {PACKAGING_LABEL[packagingType]} بتكلفة <strong className="tabular-nums text-bw-ink">{egp(recorded.data.packagingCost)}</strong> على الطلب ده. التكلفة دي ثابتة حتى لو الإعدادات اتغيّرت.</p> : null}
          {packagingCosts && (packagingCosts.BAG === null || packagingCosts.BOX === null) ? <p className="text-[11px] text-bw-amber">حدّد تكلفة الشنطة والكرتونة في الإعدادات.</p> : null}
          {packed ? <Flash tone="ok">الطرد جاهز للتسليم.</Flash> : (
            <>
              <Button size="sm" loading={event.pending} disabled={!ready} onClick={async () => { if (await record('PACKED')) onPacked?.() }}>اتغلّف — جاهز للتسليم</Button>
              {!ready ? (
                <ul className="list-disc ps-4 text-[11px] text-bw-ink-subtle" aria-label="المطلوب قبل التسليم">
                  {missing.map((text) => <li key={text}>{text}</li>)}
                </ul>
              ) : null}
            </>
          )}
          <CommandError error={choose.error} />
        </Step>
      </ol>
      {label.error || event.error ? <div className="border-t border-bw-line p-3"><CommandError error={label.error ?? event.error} /></div> : null}
    </section>
  )
}

/** One paper: its current status, the print action, and the two honest outcomes that only become available after it was sent to the printer. */
function PrintRow({ title, status, failure, canPrint, opened, onOpen, onOk, onFail, busy, waitingFor }: {
  title: string; status: PrintStatus; failure: string | null; canPrint: boolean; opened: boolean
  onOpen: () => void; onOk: () => void; onFail: () => void; busy: boolean; waitingFor?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-bw-ink">{title}</span>
        {status === 'printed' ? <span className="inline-flex items-center gap-1 text-[12px] text-bw-emerald"><Check className="size-3.5" aria-hidden />اتطبع</span>
          : status === 'failed' ? <span className="text-[12px] text-bw-danger">فشلت — لازم تتطبع تاني</span>
          : <span className="text-[12px] text-bw-ink-subtle">لسه ماتطبعتش</span>}
      </div>
      {status === 'failed' && failure ? <p className="text-[11px] text-bw-ink-soft">السبب: <bdi>{failure}</bdi></p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={!canPrint} onClick={onOpen}>
          {status === 'pending' ? <Printer className="size-4" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}{status === 'pending' ? 'اطبع' : 'أعد الطباعة'}
        </Button>
        {opened && status !== 'printed' ? (
          <>
            <button type="button" className="text-[12px] font-semibold text-bw-cobalt underline-offset-4 hover:underline disabled:opacity-50" disabled={busy} onClick={onOk}>طلعت سليمة</button>
            <button type="button" className="text-[12px] text-bw-danger underline-offset-4 hover:underline disabled:opacity-50" disabled={busy} onClick={onFail}>الطباعة فشلت</button>
          </>
        ) : null}
      </div>
      {waitingFor ? <p className="text-[11px] text-bw-ink-subtle">{waitingFor}</p> : null}
      {!opened && status !== 'printed' && canPrint ? <p className="text-[11px] text-bw-ink-subtle">التأكيد بيتفتح بعد ما تبعت الورقة للطابعة.</p> : null}
    </div>
  )
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 p-4">
      <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums', done ? 'border-bw-emerald/40 bg-bw-emerald-soft text-bw-emerald' : 'border-bw-line-field text-bw-ink-soft')}>
        {done ? <Check className="size-3.5" aria-label="تم" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-bw-small font-semibold text-bw-ink">{title}</p>
        {children}
      </div>
    </li>
  )
}
