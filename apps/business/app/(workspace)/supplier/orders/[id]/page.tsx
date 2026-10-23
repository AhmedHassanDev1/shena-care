'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  PackageCheck,
  ShieldCheck,
  Truck,
  Warehouse,
  XCircle,
} from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, Stepper } from '@/components/bw/primitives'
import { CommandError, Egp, Select, Status, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { PO_LINE_STATUS, PO_STATUS, SUPPLIER_EXCEPTIONS, formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { OPEN_STATUSES, type SupplierPo } from '../page'

type Answer = 'full' | 'partial' | 'unavailable' | 'price'

interface Draft {
  answer: Answer
  quantity: number
  exception: string
  proposedQuantity: string
  proposedUnitCost: string
  note: string
}

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
    return 'الكمية الجزئية يجب أن تكون بين ١ وأقل من المطلوب'
  if (d.answer === 'price' && !(Number(d.proposedUnitCost) > 0))
    return 'يرجى كتابة سعر الشراء الجديد المقترح'
  if (
    ['MIN_ORDER_QUANTITY', 'PACK_SIZE'].includes(d.exception) &&
    !(Number(d.proposedQuantity) > line.requestedQuantity)
  )
    return 'يرجى كتابة أقل كمية تقدر على توريدها (أكبر من الكمية المطلوبة)'
  return null
}

export default function SupplierPoDetailPage() {
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : ''
  const { data, error, loading, reload } = useApi<SupplierPo>(id ? `/purchase-orders/${id}` : null)

  return (
    <RoleShell role="supplier" active="orders" mode="responsive">
      <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <Link
          href="/supplier/orders"
          className="inline-flex items-center gap-1.5 text-xs text-bw-ink-soft transition-colors hover:text-white"
        >
          <ArrowRight className="size-4" />
          <span>العودة إلى قائمة أوامر الشراء</span>
        </Link>

        {error ? <LoadError message={error.message} onRetry={reload} /> : null}

        {!data && loading ? (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : null}

        {data ? (
          OPEN_STATUSES.includes(data.status) ? (
            <ConfirmForm po={data} onDone={reload} />
          ) : (
            <AnsweredView po={data} onDone={reload} />
          )
        ) : null}
      </div>
    </RoleShell>
  )
}

function PoHeader({ po }: { po: SupplierPo }) {
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="إدارة الرد على أمر الشراء"
        title={`أمر توريد #${shortId(po.id)}`}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <Status map={PO_STATUS} value={po.status} />
            <span className="text-bw-ink-subtle">
              · الصادر في: {formatDateTime(po.issuedAt ?? po.createdAt)}
            </span>
            {po.batchRef ? (
              <span className="text-bw-ink-subtle font-mono text-[11px]">
                · دفعة: <Code>{po.batchRef}</Code>
              </span>
            ) : null}
          </span>
        }
      />

      {/* Operational Lifecycle Timestamps */}
      <div className="rounded-2xl border border-white/[0.08] bg-bw-surface/70 p-4 space-y-3">
        <p className="text-xs font-bold text-bw-ink">سجل مراحل أمر الشراء وتوقيتاتها</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="flex items-center gap-2 text-bw-ink-soft">
            <Clock className="size-3.5 text-bw-ink-subtle" />
            <div>
              <p className="text-[10px] text-bw-ink-subtle">تاريخ الإصدار</p>
              <p className="text-white font-mono font-medium">{formatDateTime(po.issuedAt ?? po.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-bw-ink-soft">
            <Eye className="size-3.5 text-bw-ink-subtle" />
            <div>
              <p className="text-[10px] text-bw-ink-subtle">تاريخ الاطلاع</p>
              <p className="text-white font-mono font-medium">{formatDateTime(po.openedAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-bw-ink-soft">
            <ShieldCheck className="size-3.5 text-bw-ink-subtle" />
            <div>
              <p className="text-[10px] text-bw-ink-subtle">تاريخ التأكيد</p>
              <p className="text-white font-mono font-medium">{formatDateTime(po.confirmedAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-bw-ink-soft">
            <Truck className="size-3.5 text-bw-ink-subtle" />
            <div>
              <p className="text-[10px] text-bw-ink-subtle">جاهزية التوريد</p>
              <p className="text-white font-mono font-medium">{formatDateTime(po.readyAt)}</p>
            </div>
          </div>
        </div>

        {po.receivedAt ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400 border-t border-white/[0.06] pt-2">
            <Warehouse className="size-4" />
            <span>
              تم فحص واستلام الشحنة في مخزن شيناكير: <span className="font-mono font-bold">{formatDateTime(po.receivedAt)}</span>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function LineCardHead({ line }: { line: SupplierPo['lines'][number] }) {
  const lineTotal = (line.unitCost ?? 0) * line.requestedQuantity
  return (
    <div className="space-y-3 border-b border-white/[0.06] pb-3.5">
      <div className="flex items-start gap-3.5">
        {line.sku?.imageUrl ? (
          <img
            src={line.sku.imageUrl}
            alt={line.sku.productName}
            className="size-16 rounded-xl object-cover border border-white/[0.1] bg-black/40 shrink-0"
          />
        ) : (
          <div className="size-16 rounded-xl border border-white/[0.08] bg-white/[0.03] flex items-center justify-center shrink-0 text-bw-ink-subtle text-[10px]">
            بدون صورة
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-bold text-white text-sm sm:text-base leading-snug">
            <bdi>{line.sku ? line.sku.productName : shortId(line.skuId)}</bdi>
          </p>
          {line.sku?.brandName ? (
            <p className="text-xs text-emerald-400 font-semibold">{line.sku.brandName}</p>
          ) : null}

          {line.sku ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-bw-ink-subtle pt-0.5">
              <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-white font-medium">
                {line.sku.variantName}
                {line.sku.size ? ` · ${line.sku.size} ${line.sku.sizeUnit ?? ''}` : ''}
              </span>
              <span>
                كود: <Code className="text-bw-ink font-mono">{line.sku.skuCode}</Code>
              </span>
              {line.sku.barcode ? (
                <span>
                  باركود: <Code className="text-bw-ink font-mono">{line.sku.barcode}</Code>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="text-end shrink-0 ps-2">
          <p className="text-[11px] text-bw-ink-subtle">الكمية المطلوبة</p>
          <p className="font-mono text-lg sm:text-xl font-extrabold text-white">
            {line.requestedQuantity} <span className="text-xs font-normal text-bw-ink-subtle">قطعة</span>
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs pt-1.5 border-t border-white/[0.04]">
        <span className="text-bw-ink-subtle">سعر الشراء المعتمد للقطعة:</span>
        <span className="font-semibold text-white font-mono">
          <Egp value={line.unitCost} />
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-bw-ink-subtle">إجمالي تكلفة البند المطلوب:</span>
        <span className="font-bold text-emerald-300 font-mono">
          <Egp value={lineTotal} />
        </span>
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
    setDrafts(() => {
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

  const confirmedCount = po.lines.filter(
    (l) => drafts[l.id]?.answer === 'full' || drafts[l.id]?.answer === 'partial'
  ).length

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
      method: 'POST',
      body: { lines: po.lines.map((l) => toLine(l, drafts[l.id])) },
    })
  )

  return (
    <form
      className="space-y-6 pb-28"
      onSubmit={async (e) => {
        e.preventDefault()
        if (await confirm.execute()) onDone()
      }}
    >
      <PoHeader po={po} />

      <Notice tone="neutral" title="تسجيل الرد الفعلي على أمر التوريد">
        ردك المعتمد هنا يسجل فوريًا لتحديث جداول التوريد والتجهيز. أي تعديل على الأسعار أو كميات الحد الأدنى للطلب (MOQ)
        يُحال للمراجعة دون تعطيل باقي الأصناف المتوفرة.
      </Notice>

      {/* Bulk Draft Preparation Action */}
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div>
          <p className="text-xs font-bold text-white">إجراء جماعي لإعداد المسودة</p>
          <p className="text-[11px] text-bw-ink-subtle">
            يضبط جميع بنود الأمر كمتوفرة بالكامل لتسريع الرد (لا يتم الاعتماد إلا عند ضغط زر التأكيد النهائي).
          </p>
        </div>
        <button
          type="button"
          onClick={handleBulkDraftAllAvailable}
          className="rounded-xl border border-[#34d27b]/50 bg-[#34d27b]/15 px-4 py-2 text-xs font-bold text-[#34d27b] hover:bg-[#34d27b]/25 transition-all shrink-0"
        >
          كل الأصناف متوفرة بالكامل (تجهيز مسودة)
        </button>
      </div>

      {/* Lines Sections */}
      <div className="space-y-4">
        {po.lines.map((line) => {
          const d = drafts[line.id]
          const currentProblem = problem(line, d)

          return (
            <Section key={line.id} className="p-4 sm:p-5 space-y-4 rounded-2xl border-white/[0.08]">
              <LineCardHead line={line} />

              <div className="space-y-3">
                <label className="block text-xs font-semibold text-bw-ink">
                  حالة التوفر والرد على هذا الصنف:
                </label>
                <div role="radiogroup" aria-label="الرد على الصنف" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                  <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-bw-ink font-medium">الكمية المتاحة لديك للتوريد:</span>
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
                  <div className="rounded-xl border border-white/[0.08] bg-bw-surface/70 p-3.5 space-y-2">
                    <Field
                      label="سعر الشراء الجديد المقترح للقطعة (ج.م)"
                      ltr
                      inputMode="decimal"
                      placeholder="0.00"
                      value={d.proposedUnitCost}
                      onChange={(e) => set(line.id, { proposedUnitCost: e.target.value })}
                    />
                    <p className="text-[11px] text-bw-ink-subtle">
                      السعر الحالي المعتمد بأمر الشراء: <Egp value={line.unitCost} />
                    </p>
                  </div>
                ) : null}

                {d.answer === 'partial' || d.answer === 'unavailable' ? (
                  <Select
                    label="سبب النقص أو عدم التوفر (اختياري)"
                    value={d.exception}
                    onChange={(v) => set(line.id, { exception: v })}
                    options={[
                      ['', '— اختر سبب الاستثناء إذا رغبت —'],
                      ['OUT_OF_STOCK', SUPPLIER_EXCEPTIONS.OUT_OF_STOCK],
                      ['DISCONTINUED', SUPPLIER_EXCEPTIONS.DISCONTINUED],
                      ['MIN_ORDER_QUANTITY', SUPPLIER_EXCEPTIONS.MIN_ORDER_QUANTITY],
                      ['PACK_SIZE', SUPPLIER_EXCEPTIONS.PACK_SIZE],
                    ]}
                  />
                ) : null}

                {['MIN_ORDER_QUANTITY', 'PACK_SIZE'].includes(d.exception) ? (
                  <Field
                    label="الحد الأدنى للطلب (MOQ) أو حجم الكرتونة الكاملة المقترحة"
                    ltr
                    inputMode="numeric"
                    value={d.proposedQuantity}
                    onChange={(e) => set(line.id, { proposedQuantity: e.target.value })}
                  />
                ) : null}

                {d.answer !== 'full' ? (
                  <TextArea
                    label="ملاحظات توضيحية لشيناكير بخصوص هذا الصنف (اختياري)"
                    value={d.note}
                    onChange={(v) => set(line.id, { note: v })}
                  />
                ) : null}

                {currentProblem ? (
                  <p className="text-xs text-bw-danger font-medium flex items-center gap-1.5 pt-1">
                    <AlertTriangle className="size-3.5" />
                    <span>{currentProblem}</span>
                  </p>
                ) : null}
              </div>
            </Section>
          )
        })}
      </div>

      {/* Sticky Contextual Summary & Submission Bar */}
      <div className="sticky bottom-4 z-40 rounded-2xl border border-white/[0.15] bg-[#090b0e]/95 p-4 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.8)] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="text-bw-ink-subtle">الكمية الإجمالية المؤكدة: </span>
            <span className="font-mono font-bold text-white text-sm">{totalConfirmedQty} قطعة</span>
            <span className="text-bw-ink-subtle"> ({confirmedCount} من {po.lines.length} أصناف)</span>
          </div>
          <div>
            <span className="text-bw-ink-subtle">إجمالي التكلفة المعتمدة: </span>
            <span className="font-bold text-emerald-300 font-mono text-sm"><Egp value={totalConfirmedAmount} /></span>
          </div>
          {exceptionCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/35 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
              {exceptionCount} استثناءات
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/35 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
              جاهز للاعتماد الكامل
            </span>
          )}
        </div>

        <CommandError error={confirm.error} />

        <Button
          type="submit"
          size="touch"
          className="w-full h-12 text-sm font-bold bg-[#34d27b] text-black hover:bg-[#2eb96c] shadow-[0_4px_16px_rgba(52,210,123,0.3)] transition-all"
          loading={confirm.pending}
          disabled={problems.length > 0}
        >
          اعتماد وتأكيد الرد على أمر الشراء بالكامل ({totalConfirmedQty} قطعة)
        </Button>
      </div>
    </form>
  )
}

function AnsweredView({ po, onDone }: { po: SupplierPo; onDone: () => void }) {
  const ready = useCommand(() => api(`/purchase-orders/${po.id}/ready`, { method: 'POST' }))
  const canReady =
    ['confirmed', 'partial'].includes(po.status) &&
    po.lines.some((l) => (l.confirmedQuantity ?? 0) > 0)

  const totalConfirmedQty = po.lines.reduce((s, l) => s + (l.confirmedQuantity ?? 0), 0)
  const totalRequestedQty = po.lines.reduce((s, l) => s + l.requestedQuantity, 0)
  const totalConfirmedValue = po.lines.reduce(
    (s, l) => s + (l.unitCost ?? 0) * (l.confirmedQuantity ?? 0),
    0
  )

  return (
    <div className="space-y-6">
      <PoHeader po={po} />

      {/* Confirmation Status Banner */}
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">تم اعتماد الرد على أمر الشراء</h3>
            <p className="text-xs text-bw-ink-subtle">
              تم تسجيل تأكيدك بنجاح في سجلات شيناكير بتاريخ {formatDateTime(po.confirmedAt)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-3 text-xs">
          <div>
            <span className="text-bw-ink-subtle">الكمية المؤكدة:</span>
            <p className="font-mono font-bold text-white text-base">
              {totalConfirmedQty} <span className="text-xs font-normal text-bw-ink-subtle">/ {totalRequestedQty} قط</span>
            </p>
          </div>
          <div>
            <span className="text-bw-ink-subtle">إجمالي القيمة المعتمدة:</span>
            <p className="font-mono font-bold text-emerald-300 text-base">
              <Egp value={totalConfirmedValue} />
            </p>
          </div>
          <div>
            <span className="text-bw-ink-subtle">جاهزية الشحن:</span>
            <p className="font-bold text-white text-base">
              {po.readyAt ? 'جاهز للشحن' : 'قيد التجهيز'}
            </p>
          </div>
        </div>

        {canReady ? (
          <div className="pt-2 border-t border-white/[0.06]">
            <CommandError error={ready.error} />
            <Button
              type="button"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold h-11 shadow-sm"
              loading={ready.pending}
              onClick={async () => {
                if (await ready.execute()) onDone()
              }}
            >
              <PackageCheck className="size-4 me-1.5" />
              تأكيد جاهزية البضاعة للتسليم / خروج الشحنة
            </Button>
          </div>
        ) : null}
      </div>

      {/* Answered Lines Table */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-bw-surface shadow-md">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] bg-black/30 text-bw-ink-subtle font-semibold text-[11px]">
                <th className="py-3 px-4 text-start">المنتج والمواصفات</th>
                <th className="py-3 px-4 text-center">المطلوب</th>
                <th className="py-3 px-4 text-center">المؤكد</th>
                <th className="py-3 px-4 text-end">سعر الشراء</th>
                <th className="py-3 px-4 text-end">إجمالي البند</th>
                <th className="py-3 px-4 text-start">حالة الرد والملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {po.lines.map((line) => {
                const confirmed = line.confirmedQuantity ?? 0
                const lineTotal = (line.unitCost ?? 0) * confirmed

                return (
                  <tr key={line.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 max-w-xs">
                      <div className="flex items-center gap-3">
                        {line.sku?.imageUrl ? (
                          <img
                            src={line.sku.imageUrl}
                            alt=""
                            className="size-10 rounded-lg object-cover border border-white/[0.08] shrink-0"
                          />
                        ) : null}
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-bold text-white truncate text-xs">
                            {line.sku?.productName || shortId(line.skuId)}
                          </p>
                          <div className="flex items-center gap-1.5 text-[10px] text-bw-ink-subtle">
                            {line.sku?.brandName ? <span>{line.sku.brandName}</span> : null}
                            {line.sku?.skuCode ? <span>· <Code className="text-[10px]">{line.sku.skuCode}</Code></span> : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono font-medium text-bw-ink-soft">
                      {line.requestedQuantity}
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono font-bold text-emerald-300">
                      {line.confirmedQuantity ?? '—'}
                    </td>
                    <td className="py-3.5 px-4 text-end font-mono text-white">
                      <Egp value={line.unitCost} />
                    </td>
                    <td className="py-3.5 px-4 text-end font-mono font-bold text-emerald-300">
                      <Egp value={lineTotal} />
                    </td>
                    <td className="py-3.5 px-4 text-bw-ink-soft">
                      <div className="space-y-0.5">
                        <Status map={PO_LINE_STATUS} value={line.status} />
                        {line.exceptionCode ? (
                          <p className="text-[10px] text-amber-300">
                            {SUPPLIER_EXCEPTIONS[line.exceptionCode as keyof typeof SUPPLIER_EXCEPTIONS] || line.exceptionCode}
                          </p>
                        ) : null}
                        {line.proposedUnitCost ? (
                          <p className="text-[10px] text-amber-300 font-mono">
                            سعر مقترح: <Egp value={line.proposedUnitCost} />
                          </p>
                        ) : null}
                        {line.exceptionNote ? (
                          <p className="text-[10px] text-bw-ink-subtle italic">{line.exceptionNote}</p>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
