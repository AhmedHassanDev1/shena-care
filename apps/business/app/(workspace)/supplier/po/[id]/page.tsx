'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, Stepper } from '@/components/bw/primitives'
import { CommandError, Egp, Select, Status, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { PO_LINE_STATUS, PO_STATUS, SUPPLIER_EXCEPTIONS, formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { OPEN, type SupplierPo } from '../../page'

type Answer = 'full' | 'partial' | 'unavailable' | 'price'
interface Draft { answer: Answer; quantity: number; exception: string; proposedQuantity: string; proposedUnitCost: string; note: string }

/** One line's answer → the API's confirmation shape; MOQ/carton/price are recorded, never auto-applied. */
function toLine(line: SupplierPo['lines'][number], d: Draft) {
  const base = { id: line.id }
  const exception = d.exception ? {
    exceptionCode: d.exception,
    ...(d.note.trim() ? { exceptionNote: d.note.trim() } : {}),
    ...(['MIN_ORDER_QUANTITY', 'PACK_SIZE'].includes(d.exception) && d.proposedQuantity ? { proposedQuantity: Number(d.proposedQuantity) } : {}),
  } : {}
  switch (d.answer) {
    case 'full': return { ...base, status: 'confirmed_full' }
    case 'partial': return { ...base, status: 'confirmed_partial', confirmedQuantity: d.quantity, ...exception }
    case 'unavailable': return { ...base, status: 'unavailable', ...exception }
    case 'price': return {
      ...base, status: 'price_changed', exceptionCode: 'PRICE_CHANGED', proposedUnitCost: Number(d.proposedUnitCost),
      ...(d.note.trim() ? { exceptionNote: d.note.trim() } : {}),
    }
  }
}

function problem(line: SupplierPo['lines'][number], d: Draft): string | null {
  if (d.answer === 'partial' && (d.quantity < 1 || d.quantity >= line.requestedQuantity)) return 'الكمية الجزئية لازم تكون بين ١ وأقل من المطلوب'
  if (d.answer === 'price' && !(Number(d.proposedUnitCost) > 0)) return 'اكتب سعر الشراء الجديد'
  if (['MIN_ORDER_QUANTITY', 'PACK_SIZE'].includes(d.exception) && !(Number(d.proposedQuantity) > line.requestedQuantity)) return 'اكتب الكمية اللي بتقدر تبيعها (أكبر من المطلوب)'
  return null
}

export default function SupplierPoDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, error, loading, reload } = useApi<SupplierPo>(`/purchase-orders/${id}`)

  return (
    <RoleShell role="supplier" active="pos" mode="mobile">
      <div className="space-y-4 p-4">
        <Link href="/supplier" className="text-bw-small text-bw-ink-soft underline">← كل الأوامر</Link>
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-64 w-full" /> : null}
        {data ? (OPEN.includes(data.status) ? <ConfirmForm po={data} onDone={reload} /> : <Answered po={data} onDone={reload} />) : null}
      </div>
    </RoleShell>
  )
}

function Header({ po }: { po: SupplierPo }) {
  return (
    <PageHeader
      eyebrow="أمر شراء"
      title={shortId(po.id)}
      meta={<span className="flex flex-wrap items-center gap-2"><Status map={PO_STATUS} value={po.status} /> {formatDateTime(po.issuedAt ?? po.createdAt)}</span>}
    />
  )
}

function LineHead({ line }: { line: SupplierPo['lines'][number] }) {
  return (
    <div className="space-y-0.5">
      <p className="font-semibold"><bdi>{line.sku ? line.sku.productName : shortId(line.skuId)}</bdi></p>
      {line.sku ? (
        <>
          <p className="text-bw-small text-bw-ink-soft"><bdi>{line.sku.variantName}</bdi> · <Code>{line.sku.skuCode}</Code></p>
          {line.sku.barcode ? <p className="text-bw-small text-bw-ink-soft break-all">باركود <Code>{line.sku.barcode}</Code></p> : null}
        </>
      ) : null}
      <p className="text-bw-small">المطلوب <Code>{line.requestedQuantity}</Code> · سعر الشراء المعتمد <Egp value={line.unitCost} /></p>
    </div>
  )
}

function ConfirmForm({ po, onDone }: { po: SupplierPo; onDone: () => void }) {
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(() => Object.fromEntries(po.lines.map((l) => [l.id, {
    answer: 'full', quantity: Math.max(1, l.requestedQuantity - 1), exception: '', proposedQuantity: '', proposedUnitCost: '', note: '',
  } as Draft])))
  const set = (lineId: string, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [lineId]: { ...all[lineId], ...patch } }))
  const problems = po.lines.map((l) => problem(l, drafts[l.id])).filter(Boolean)
  const confirm = useCommand(() => api(`/purchase-orders/${po.id}/confirm`, { body: { lines: po.lines.map((l) => toLine(l, drafts[l.id])) } }))

  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await confirm.execute()) onDone() }}>
      <Header po={po} />
      <Notice tone="neutral" title="ردك بيتسجّل زي ما هو">أي تغيير في السعر أو أقل كمية أو الكرتونة بيتسجّل كاستثناء ويتراجع من شينا كير — مابيغيّرش سعر العميل ولا بيتقبل تلقائي.</Notice>
      {po.lines.map((line) => {
        const d = drafts[line.id]
        return (
          <Section key={line.id}>
            <div className="space-y-3">
              <LineHead line={line} />
              <div role="radiogroup" aria-label="الرد" className="grid grid-cols-2 gap-2">
                {([['full', 'متوفر كله'], ['partial', 'جزء بس'], ['unavailable', 'مش متوفر'], ['price', 'السعر اتغيّر']] as const).map(([value, text]) => (
                  <button key={value} type="button" role="radio" aria-checked={d.answer === value} onClick={() => set(line.id, { answer: value, exception: value === 'full' || value === 'price' ? '' : d.exception })}
                    className={`h-bw-touch rounded-full border-[1.5px] px-3 text-bw-small font-semibold ${d.answer === value ? 'border-bw-action bg-bw-action-soft text-bw-action-ink' : 'border-bw-line-field bg-bw-surface'}`}>
                    {text}
                  </button>
                ))}
              </div>
              {d.answer === 'partial' ? (
                <div className="flex items-center gap-3">
                  <span className="text-bw-small">الكمية المتاحة</span>
                  <Stepper label="الكمية المتاحة" value={d.quantity} max={line.requestedQuantity - 1} onChange={(n) => set(line.id, { quantity: Math.max(0, n) })} />
                </div>
              ) : null}
              {d.answer === 'price' ? (
                <Field label="سعر الشراء الجديد للقطعة (ج.م)" ltr inputMode="decimal" value={d.proposedUnitCost} onChange={(e) => set(line.id, { proposedUnitCost: e.target.value })} />
              ) : null}
              {d.answer === 'partial' || d.answer === 'unavailable' ? (
                <Select label="السبب (اختياري)" value={d.exception} onChange={(v) => set(line.id, { exception: v })}
                  options={[['', '—'], ['OUT_OF_STOCK', SUPPLIER_EXCEPTIONS.OUT_OF_STOCK], ['DISCONTINUED', SUPPLIER_EXCEPTIONS.DISCONTINUED], ['MIN_ORDER_QUANTITY', SUPPLIER_EXCEPTIONS.MIN_ORDER_QUANTITY], ['PACK_SIZE', SUPPLIER_EXCEPTIONS.PACK_SIZE]]} />
              ) : null}
              {['MIN_ORDER_QUANTITY', 'PACK_SIZE'].includes(d.exception) ? (
                <Field label="أقل كمية/كرتونة تقدر تبيعها" ltr inputMode="numeric" value={d.proposedQuantity} onChange={(e) => set(line.id, { proposedQuantity: e.target.value })} />
              ) : null}
              {d.answer !== 'full' ? <TextArea label="ملاحظة (اختياري)" value={d.note} onChange={(v) => set(line.id, { note: v })} /> : null}
              {problem(line, d) ? <p className="text-bw-small text-bw-danger">{problem(line, d)}</p> : null}
            </div>
          </Section>
        )
      })}
      <CommandError error={confirm.error} />
      <Button type="submit" size="touch" className="w-full" loading={confirm.pending} disabled={problems.length > 0}>تأكيد الرد على الأمر كله</Button>
    </form>
  )
}

function Answered({ po, onDone }: { po: SupplierPo; onDone: () => void }) {
  const ready = useCommand(() => api(`/purchase-orders/${po.id}/ready`, { method: 'POST' }))
  const canReady = ['confirmed', 'partial'].includes(po.status) && po.lines.some((l) => (l.confirmedQuantity ?? 0) > 0)
  return (
    <div className="space-y-4">
      <Header po={po} />
      {po.status === 'ready' ? <Notice tone="ok" title="سجّلت إن البضاعة جاهزة">ده مش استلام: المخزن هيأكد الكمية اللي وصلت فعلاً عند الاستلام.</Notice> : null}
      {po.status === 'received_at_hub' ? <Notice tone="ok" title="المخزن استلم البضاعة" /> : null}
      {po.lines.map((line) => (
        <Section key={line.id}>
          <div className="space-y-2">
            <LineHead line={line} />
            <p className="flex flex-wrap items-center gap-2 text-bw-small">
              <Status map={PO_LINE_STATUS} value={line.status} /> المؤكد <Code>{line.confirmedQuantity ?? 0}</Code>
            </p>
            {line.exceptionCode ? (
              <p className="text-bw-small text-bw-warn">
                {SUPPLIER_EXCEPTIONS[line.exceptionCode] ?? line.exceptionCode}
                {line.proposedQuantity ? <> · كمية مقترحة <Code>{line.proposedQuantity}</Code></> : null}
                {line.proposedUnitCost ? <> · سعر مقترح <Egp value={line.proposedUnitCost} /></> : null}
                {line.exceptionNote ? <> · {line.exceptionNote}</> : null}
                {' '}— مستني مراجعة شينا كير
              </p>
            ) : null}
          </div>
        </Section>
      ))}
      {canReady ? (
        <div className="space-y-2">
          <Button size="touch" className="w-full" loading={ready.pending} onClick={async () => { if (await ready.execute()) onDone() }}>البضاعة المؤكدة جاهزة للاستلام</Button>
          <p className="text-bw-small text-bw-ink-soft">"جاهزة" معناها إنها مستنية المندوب/الاستلام — المخزن بس هو اللي يسجّل الاستلام.</p>
          <CommandError error={ready.error} />
        </div>
      ) : null}
    </div>
  )
}
