'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { CheckCircle2, ChevronRight, Clock, Eye, ShieldCheck, Truck, Warehouse } from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, Stepper } from '@/components/bw/primitives'
import { CommandError, Egp, Select, Status, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { PO_LINE_STATUS, PO_STATUS, SUPPLIER_EXCEPTIONS, formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { OPEN, type SupplierPo } from '../../page'

type Answer = 'full' | 'partial' | 'unavailable' | 'price'
interface Draft {
  answer: Answer
  quantity: number
  exception: string
  proposedQuantity: string
  proposedUnitCost: string
  note: string
}

/** One line's answer → the API's confirmation shape; MOQ/carton/price are recorded, never auto-applied. */
function toLine(line: SupplierPo['lines'][number], d: Draft) {
  const base = { id: line.id }
  const exception = d.exception
    ? {
        exceptionCode: d.exception,
        ...(d.note.trim() ? { exceptionNote: d.note.trim() } : {}),
        ...(['MIN_ORDER_QUANTITY', 'PACK_SIZE'].includes(d.exception) && d.proposedQuantity
          ? { proposedQuantity: Number(d.proposedQuantity) }
          : {}),
      }
    : {}
  switch (d.answer) {
    case 'full':
      return { ...base, status: 'confirmed_full' }
    case 'partial':
      return { ...base, status: 'confirmed_partial', confirmedQuantity: d.quantity, ...exception }
    case 'unavailable':
      return { ...base, status: 'unavailable', ...exception }
    case 'price':
      return {
        ...base,
        status: 'price_changed',
        exceptionCode: 'PRICE_CHANGED',
        proposedUnitCost: Number(d.proposedUnitCost),
        ...(d.note.trim() ? { exceptionNote: d.note.trim() } : {}),
      }
  }
}

function problem(line: SupplierPo['lines'][number], d: Draft): string | null {
  if (d.answer === 'partial' && (d.quantity < 1 || d.quantity >= line.requestedQuantity))
    return 'الكمية الجزئية لازم تكون بين ١ وأقل من المطلوب'
  if (d.answer === 'price' && !(Number(d.proposedUnitCost) > 0))
    return 'اكتب سعر الشراء الجديد المقترح'
  if (
    ['MIN_ORDER_QUANTITY', 'PACK_SIZE'].includes(d.exception) &&
    !(Number(d.proposedQuantity) > line.requestedQuantity)
  )
    return 'اكتب أقل كمية تقدر تبيعها (أكبر من المطلوب)'
  return null
}

export default function SupplierPoDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, error, loading, reload } = useApi<SupplierPo>(`/purchase-orders/${id}`)

  return (
    <RoleShell role="supplier" active="pos" mode="mobile">
      <div className="space-y-4 p-4">
        <Link
          href="/supplier"
          className="inline-flex items-center gap-1.5 text-xs text-bw-ink-soft transition-colors hover:text-white"
        >
          <ChevronRight className="size-4" />
          <span>العودة إلى كل أوامر الشراء</span>
        </Link>
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-64 w-full rounded-2xl" /> : null}
        {data ? (
          OPEN.includes(data.status) ? (
            <ConfirmForm po={data} onDone={reload} />
          ) : (
            <Answered po={data} onDone={reload} />
          )
        ) : null}
      </div>
    </RoleShell>
  )
}

function Header({ po }: { po: SupplierPo }) {
  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="تفاصيل أمر الشراء"
        title={`أمر توريد #${shortId(po.id)}`}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <Status map={PO_STATUS} value={po.status} />
            <span className="text-bw-ink-subtle">· الصادر: {formatDateTime(po.issuedAt ?? po.createdAt)}</span>
          </span>
        }
      />

      {/* Operational Lifecycle Timestamps */}
      <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-3 space-y-2">
        <p className="text-[11px] font-semibold text-bw-ink-subtle">سجل مراحل أمر الشراء</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2 text-bw-ink-soft">
            <Clock className="size-3.5 text-bw-ink-subtle" />
            <span>الإصدار: <span className="text-white font-mono">{formatDateTime(po.issuedAt ?? po.createdAt)}</span></span>
          </div>
          <div className="flex items-center gap-2 text-bw-ink-soft">
            <Eye className="size-3.5 text-bw-ink-subtle" />
            <span>الاطلاع: <span className="text-white font-mono">{formatDateTime(po.openedAt)}</span></span>
          </div>
          <div className="flex items-center gap-2 text-bw-ink-soft">
            <ShieldCheck className="size-3.5 text-bw-ink-subtle" />
            <span>التأكيد: <span className="text-white font-mono">{formatDateTime(po.confirmedAt)}</span></span>
          </div>
          <div className="flex items-center gap-2 text-bw-ink-soft">
            <Truck className="size-3.5 text-bw-ink-subtle" />
            <span>الجاهزية: <span className="text-white font-mono">{formatDateTime(po.readyAt)}</span></span>
          </div>
        </div>
        {po.receivedAt ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400 border-t border-white/[0.06] pt-1.5">
            <Warehouse className="size-3.5" />
            <span>تم استلام الشحنة في المخزن: <span className="font-mono">{formatDateTime(po.receivedAt)}</span></span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function LineHead({ line }: { line: SupplierPo['lines'][number] }) {
  const lineTotal = (line.unitCost ?? 0) * line.requestedQuantity
  return (
    <div className="space-y-2 border-b border-white/[0.06] pb-3">
      <div className="flex items-start gap-3">
        {line.sku?.imageUrl ? (
          <img
            src={line.sku.imageUrl}
            alt={line.sku.productName}
            className="size-14 rounded-xl object-cover border border-white/[0.1] bg-black/40 shrink-0"
          />
        ) : (
          <div className="size-14 rounded-xl border border-white/[0.08] bg-white/[0.03] flex items-center justify-center shrink-0 text-bw-ink-subtle text-[10px]">
            بدون صورة
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-bold text-white text-sm leading-snug">
            <bdi>{line.sku ? line.sku.productName : shortId(line.skuId)}</bdi>
          </p>
          {line.sku?.brandName ? (
            <p className="text-xs text-emerald-400 font-medium">{line.sku.brandName}</p>
          ) : null}

          {line.sku ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-bw-ink-subtle pt-0.5">
              <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-bw-ink font-medium">
                {line.sku.variantName}
                {line.sku.size ? ` · ${line.sku.size} ${line.sku.sizeUnit ?? ''}` : ''}
              </span>
              <span>كود: <Code className="text-bw-ink font-mono">{line.sku.skuCode}</Code></span>
              {line.sku.barcode ? (
                <span>باركود: <Code className="text-bw-ink font-mono">{line.sku.barcode}</Code></span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="text-end shrink-0">
          <p className="text-[11px] text-bw-ink-subtle">المطلوب</p>
          <p className="font-mono text-base font-extrabold text-white">{line.requestedQuantity} قطعة</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
        <span className="text-bw-ink-subtle">سعر الشراء المعتمد للقطعة:</span>
        <span className="font-semibold text-white"><Egp value={line.unitCost} /></span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-bw-ink-subtle">إجمالي تكلفة البند:</span>
        <span className="font-bold text-emerald-300"><Egp value={lineTotal} /></span>
      </div>
    </div>
  )
}

function ConfirmForm({ po, onDone }: { po: SupplierPo; onDone: () => void }) {
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      po.lines.map((l) => [
        l.id,
        {
          answer: 'full',
          quantity: Math.max(1, l.requestedQuantity - 1),
          exception: '',
          proposedQuantity: '',
          proposedUnitCost: '',
          note: '',
        } as Draft,
      ])
    )
  )

  const set = (lineId: string, patch: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [lineId]: { ...all[lineId], ...patch } }))
  const problems = po.lines.map((l) => problem(l, drafts[l.id])).filter(Boolean)

  const handleBulkDraftAllAvailable = () => {
    setDrafts((prev) => {
      const updated: Record<string, Draft> = {}
      for (const line of po.lines) {
        updated[line.id] = {
          answer: 'full',
          quantity: Math.max(1, line.requestedQuantity - 1),
          exception: '',
          proposedQuantity: '',
          proposedUnitCost: '',
          note: '',
        }
      }
      return updated
    })
  }

  const confirmedCount = po.lines.filter((l) => drafts[l.id]?.answer === 'full' || drafts[l.id]?.answer === 'partial').length
  const totalConfirmedQty = po.lines.reduce((sum, l) => {
    const d = drafts[l.id]
    if (d?.answer === 'full') return sum + l.requestedQuantity
    if (d?.answer === 'partial') return sum + (d.quantity || 0)
    return sum
  }, 0)
  const totalConfirmedAmount = po.lines.reduce((sum, l) => {
    const d = drafts[l.id]
    const unitCost = l.unitCost ?? 0
    if (d?.answer === 'full') return sum + unitCost * l.requestedQuantity
    if (d?.answer === 'partial') return sum + unitCost * (d.quantity || 0)
    return sum
  }, 0)
  const exceptionCount = po.lines.filter((l) => drafts[l.id]?.answer !== 'full').length

  const confirm = useCommand(() =>
    api(`/purchase-orders/${po.id}/confirm`, {
      body: { lines: po.lines.map((l) => toLine(l, drafts[l.id])) },
    })
  )

  return (
    <form
      className="space-y-4 pb-24"
      onSubmit={async (e) => {
        e.preventDefault()
        if (await confirm.execute()) onDone()
      }}
    >
      <Header po={po} />

      <Notice tone="neutral" title="ردك يُسجل مباشرة وبأثر فوري">
        يرجى تحديد حالة التوفر الحقيقية لكل صنف. أي اقتراح لتغيير السعر أو الحد الأدنى للطلب (MOQ)
        يُحال للمراجعة دون تعطيل الأصناف المتوفرة.
      </Notice>

      {/* Bulk Draft Preparation Action */}
      <div className="rounded-xl border border-white/[0.1] bg-bw-surface/80 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-sm">
        <div>
          <p className="text-xs font-bold text-white">إجراء سريع لإعداد المسودة</p>
          <p className="text-[11px] text-bw-ink-subtle">
            يضبط كل الأصناف كمتوفرة بالكامل في المسودة أدناه (لا يؤكد الطلب تلقائياً، يتطلب ضغط زر التأكيد النهائي)
          </p>
        </div>
        <button
          type="button"
          onClick={handleBulkDraftAllAvailable}
          className="rounded-xl border border-[#34d27b]/40 bg-[#34d27b]/10 px-3.5 py-2 text-xs font-bold text-[#34d27b] hover:bg-[#34d27b]/20 transition-all shrink-0"
        >
          كل الأصناف متوفرة كما طلبتم (تجهيز مسودة)
        </button>
      </div>

      {po.lines.map((line) => {
        const d = drafts[line.id]
        return (
          <Section key={line.id} className="p-4 space-y-3">
            <LineHead line={line} />

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-bw-ink-soft">حالة التوفر والرد على الصنف:</label>
              <div role="radiogroup" aria-label="الرد" className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['full', 'متوفر كله بالكامل'],
                    ['partial', 'متوفر جزئياً'],
                    ['unavailable', 'غير متوفر نهائياً'],
                    ['price', 'تغيّر سعر الشراء'],
                  ] as const
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={d.answer === value}
                    onClick={() =>
                      set(line.id, {
                        answer: value,
                        exception: value === 'full' || value === 'price' ? '' : d.exception,
                      })
                    }
                    className={`h-11 rounded-xl border text-xs font-semibold transition-all ${
                      d.answer === value
                        ? 'border-[#34d27b] bg-[#34d27b]/15 text-[#34d27b] shadow-[0_0_12px_rgba(52,210,123,0.2)]'
                        : 'border-white/[0.08] bg-bw-surface hover:border-white/[0.15] text-bw-ink'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>

              {d.answer === 'partial' ? (
                <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-bw-ink">الكمية المتاحة لديك للتوريد:</span>
                    <Stepper
                      label="الكمية المتاحة"
                      value={d.quantity}
                      max={line.requestedQuantity - 1}
                      onChange={(n) => set(line.id, { quantity: Math.max(0, n) })}
                    />
                  </div>
                </div>
              ) : null}

              {d.answer === 'price' ? (
                <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-3 space-y-2">
                  <Field
                    label="سعر الشراء الجديد المقترح للقطعة (ج.م)"
                    ltr
                    inputMode="decimal"
                    placeholder="0.00"
                    value={d.proposedUnitCost}
                    onChange={(e) => set(line.id, { proposedUnitCost: e.target.value })}
                  />
                  <p className="text-[11px] text-bw-ink-subtle">
                    السعر الحالي المعتمد: <Egp value={line.unitCost} />
                  </p>
                </div>
              ) : null}

              {d.answer === 'partial' || d.answer === 'unavailable' ? (
                <Select
                  label="سبب النقص أو عدم التوفر (اختياري)"
                  value={d.exception}
                  onChange={(v) => set(line.id, { exception: v })}
                  options={[
                    ['', '— اختر السبب إذا رغبت —'],
                    ['OUT_OF_STOCK', SUPPLIER_EXCEPTIONS.OUT_OF_STOCK],
                    ['DISCONTINUED', SUPPLIER_EXCEPTIONS.DISCONTINUED],
                    ['MIN_ORDER_QUANTITY', SUPPLIER_EXCEPTIONS.MIN_ORDER_QUANTITY],
                    ['PACK_SIZE', SUPPLIER_EXCEPTIONS.PACK_SIZE],
                  ]}
                />
              ) : null}

              {['MIN_ORDER_QUANTITY', 'PACK_SIZE'].includes(d.exception) ? (
                <Field
                  label="أقل كمية أو حجم كرتونة تقدر تبيعها"
                  ltr
                  inputMode="numeric"
                  value={d.proposedQuantity}
                  onChange={(e) => set(line.id, { proposedQuantity: e.target.value })}
                />
              ) : null}

              {d.answer !== 'full' ? (
                <TextArea
                  label="ملاحظات توضيحية لشيناكير (اختياري)"
                  value={d.note}
                  onChange={(v) => set(line.id, { note: v })}
                />
              ) : null}

              {problem(line, d) ? (
                <p className="text-xs text-bw-danger font-medium">{problem(line, d)}</p>
              ) : null}
            </div>
          </Section>
        )
      })}

      {/* Sticky Contextual Summary for Mobile and Desktop */}
      <div className="sticky bottom-3 z-40 rounded-2xl border border-white/[0.15] bg-bw-surface/95 p-3.5 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.8)] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            <span className="text-bw-ink-subtle">الكمية المؤكدة: </span>
            <span className="font-mono font-bold text-white">{totalConfirmedQty} قطعة</span>
            <span className="text-bw-ink-subtle"> ({confirmedCount} من {po.lines.length} أصناف)</span>
          </div>
          <div>
            <span className="text-bw-ink-subtle">إجمالي التكلفة: </span>
            <span className="font-bold text-emerald-300"><Egp value={totalConfirmedAmount} /></span>
          </div>
          {exceptionCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/35 px-2 py-0.5 text-[10px] font-bold text-amber-300">
              {exceptionCount} استثناءات
            </span>
          ) : null}
        </div>

        <CommandError error={confirm.error} />
        <Button
          type="submit"
          size="touch"
          className="w-full h-12 text-sm font-bold bg-[#34d27b] text-black hover:bg-[#2eb96c] shadow-[0_4px_16px_rgba(52,210,123,0.3)]"
          loading={confirm.pending}
          disabled={problems.length > 0}
        >
          اعتماد وتأكيد الرد على أمر الشراء بالكامل ({totalConfirmedQty} قطعة)
        </Button>
      </div>
    </form>
  )
}

function Answered({ po, onDone }: { po: SupplierPo; onDone: () => void }) {
  const ready = useCommand(() => api(`/purchase-orders/${po.id}/ready`, { method: 'POST' }))
  const canReady =
    ['confirmed', 'partial'].includes(po.status) &&
    po.lines.some((l) => (l.confirmedQuantity ?? 0) > 0)

  return (
    <div className="space-y-4">
      <Header po={po} />

      {po.status === 'ready' ? (
        <Notice tone="ok" title="تم إعلان البضاعة جاهزة للاستلام (Ready)">
          تم إعلان البضاعة كجاهزة في مقركم بانتظار استلام المندوب. تنبيه هام: إعلان الجاهزية لا يعد استلاماً في المخزن ولا يتيح المخزون للعملاء؛ الاستلام وإتاحة البضاعة يتمان حصراً بعد الفحص والمسح بواسطة أمين مخزن شيناكير.
        </Notice>
      ) : null}

      {po.status === 'received_at_hub' ? (
        <Notice tone="ok" title="تم استلام وفحص البضاعة في المخزن">
          تم إنهاء استلام هذا الأمر وإضافته لمستحقات التوريد تلقائياً.
        </Notice>
      ) : null}

      <div className="space-y-3">
        {po.lines.map((line) => (
          <Section key={line.id} className="p-4 space-y-2.5">
            <LineHead line={line} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
              <span className="text-bw-ink-subtle">الرد المعتمد:</span>
              <div className="flex items-center gap-2">
                <Status map={PO_LINE_STATUS} value={line.status} />
                <span className="font-mono font-bold text-white">
                  المؤكد: {line.confirmedQuantity ?? 0} قطعة
                </span>
              </div>
            </div>

            {line.exceptionCode ? (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-2.5 text-xs text-amber-300 space-y-1">
                <p className="font-semibold">
                  {SUPPLIER_EXCEPTIONS[line.exceptionCode] ?? line.exceptionCode}
                </p>
                {line.proposedQuantity ? (
                  <p>الكمية المقترحة: <Code className="font-mono">{line.proposedQuantity}</Code></p>
                ) : null}
                {line.proposedUnitCost ? (
                  <p>السعر المقترح: <Egp value={line.proposedUnitCost} /></p>
                ) : null}
                {line.exceptionNote ? (
                  <p className="text-bw-ink-soft">ملاحظة: {line.exceptionNote}</p>
                ) : null}
                <p className="text-[10px] text-amber-400/80">مُسجل في سجل الاستثناءات لمراجعة إدارة التوريد</p>
              </div>
            ) : null}
          </Section>
        ))}
      </div>

      {canReady ? (
        <div className="rounded-2xl border border-[#34d27b]/30 bg-[#34d27b]/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-[#34d27b]" />
            <h3 className="font-bold text-white text-sm">جاهزية بضاعة أمر الشراء</h3>
          </div>
          <p className="text-xs text-bw-ink-soft">
            عند الانتهاء من فرز وتجهيز الأصناف المؤكدة في مقركم، اضغط أدناه لإبلاغ فريق العمليات والمخزن بأن البضاعة جاهزة للاستلام الفوري.
          </p>
          <Button
            size="touch"
            className="w-full h-12 bg-[#34d27b] text-black font-bold hover:bg-[#2eb96c] shadow-[0_4px_16px_rgba(52,210,123,0.3)]"
            loading={ready.pending}
            onClick={async () => {
              if (await ready.execute()) onDone()
            }}
          >
            إعلان البضاعة المؤكدة جاهزة للاستلام
          </Button>
          <CommandError error={ready.error} />
        </div>
      ) : null}
    </div>
  )
}
