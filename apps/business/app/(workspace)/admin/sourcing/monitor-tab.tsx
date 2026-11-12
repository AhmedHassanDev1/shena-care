'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronDown, Send } from 'lucide-react'
import { Button, Code, Dialog, Field, Skeleton, StateBlock, StatusLabel, useDialog } from '@/components/bw/primitives'
import { CommandError, Egp, Status } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { PAYABLE_STATUS, PO_LINE_STATUS, PO_STATUS, SUPPLIER_EXCEPTIONS, formatDateTime } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import {
  CLOSE_REASON_TEXT,
  Payable,
  PoLine,
  RFQ_STATUS_TEXT,
  RfqDetail,
  RfqListItem,
  StaffPo,
  attentionItems,
  coverageTotals,
  percent,
  shortRef,
} from './sourcing-model'
import { MiniBar } from './sourcing-ui'

type PoFilter = 'all' | 'attention' | 'owed'

export function MonitorTab() {
  const rfqs = useApi<{ mode: string; total: number; items: RfqListItem[] }>('/rfq/staff?take=50', { pollMs: 30000 })
  const pos = useApi<{ total: number; items: StaffPo[] }>('/purchase-orders?take=50', { pollMs: 30000 })
  const payables = useApi<{ total: number; items: Payable[] }>('/sourcing/payables?take=50')
  const suppliers = useApi<Array<{ id: string; name: string }>>('/sourcing/suppliers')
  const [openRfq, setOpenRfq] = React.useState<string | null>(null)
  const [openPo, setOpenPo] = React.useState<string | null>(null)
  const [poFilter, setPoFilter] = React.useState<PoFilter>('all')
  const [notice, setNotice] = React.useState<string | null>(null)
  const flushDialog = useDialog()
  const poSection = React.useRef<HTMLElement>(null)
  const rfqSection = React.useRef<HTMLElement>(null)

  const supplierName = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]))
  const rfqItems = rfqs.data?.items ?? []
  const poItems = pos.data?.items ?? []
  const payableItems = payables.data?.items ?? []
  const payableByPo = new Map(payableItems.map((p) => [p.purchaseOrderId, p]))
  const reloadAll = () => { rfqs.reload(); pos.reload(); payables.reload() }

  const totals = coverageTotals(rfqItems)
  const attention = attentionItems(rfqItems, poItems, payableItems)
  const attentionPoIds = new Set(attention.filter((a) => a.target === 'po' && a.id).map((a) => a.id))
  const owedPoIds = new Set(payableItems.filter((p) => p.status !== 'paid').map((p) => p.purchaseOrderId))
  const shownPos = poItems.filter((po) => poFilter === 'all' || (poFilter === 'attention' ? attentionPoIds.has(po.id) : owedPoIds.has(po.id)))

  const goTo = (item: { target: 'rfq' | 'po'; id?: string }) => {
    if (item.target === 'rfq') {
      setOpenRfq(item.id ?? null)
      rfqSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      if (item.id) { setPoFilter('all'); setOpenPo(item.id) } else setPoFilter('owed')
      poSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const loading = (!rfqs.data && rfqs.loading) || (!pos.data && pos.loading)

  return (
    <div className="space-y-8">
      {notice ? (
        <p role="status" className="flex items-center justify-between gap-3 rounded-bw-field border border-bw-emerald/30 bg-bw-emerald-soft px-3.5 py-2 text-bw-small text-bw-ink">
          {notice}
          <button type="button" className="text-bw-ink-soft underline" onClick={() => setNotice(null)}>إخفاء</button>
        </p>
      ) : null}
      {rfqs.error ? <LoadError message={rfqs.error.message} onRetry={rfqs.reload} /> : null}
      {loading ? <Skeleton className="h-40 w-full" /> : null}

      {!loading ? (
        <>
          {/* Coverage: the one chart. */}
          <section aria-label="تغطية الطلبات">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-bw-heading font-semibold text-bw-ink">تغطية الطلبات</h2>
              <Button variant="secondary" onClick={() => flushDialog.open()}>
                <Send className="size-4" aria-hidden />
                إرسال الطلبات الآن
              </Button>
            </div>
            {totals.required === 0 ? (
              <p className="mt-3 text-bw-small text-bw-ink-soft">لا توجد طلبات توريد حتى الآن. تظهر هنا بمجرد وجود طلبات عملاء تحتاج مورّدين.</p>
            ) : (
              <div className="mt-3 space-y-2.5">
                <div className="flex h-3 overflow-hidden rounded-full bg-bw-sunken" role="img" aria-label={`مغطى ${percent(totals.covered, totals.required)}%`}>
                  <div className="bg-bw-emerald" style={{ width: `${percent(totals.covered, totals.required)}%` }} />
                  <div className="bg-bw-cobalt" style={{ width: `${percent(totals.waiting, totals.required)}%` }} />
                  <div className="bg-bw-rose" style={{ width: `${percent(totals.uncovered, totals.required)}%` }} />
                </div>
                <ul className="flex flex-wrap gap-x-6 gap-y-1 text-bw-small">
                  <Legend color="bg-bw-emerald" label="مغطى" value={totals.covered} />
                  <Legend color="bg-bw-cobalt" label="بانتظار الموردين" value={totals.waiting} />
                  <Legend color="bg-bw-rose" label="بلا تغطية" value={totals.uncovered} />
                </ul>
              </div>
            )}
          </section>

          {attention.length > 0 ? (
            <section aria-label="يحتاج تدخل" className="rounded-bw-card border border-bw-amber/30 bg-bw-amber-soft/50 p-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-bw-small font-semibold text-bw-ink">
                  <AlertTriangle className="size-4 text-bw-amber" aria-hidden />
                  يحتاج تدخل
                </h2>
                <Link href="/admin/exceptions" className="text-bw-small text-bw-ink-soft underline underline-offset-4">مركز الاستثناءات</Link>
              </div>
              <ul>
                {attention.map((item) => (
                  <li key={item.key}>
                    <button type="button" onClick={() => goTo(item)} className="flex w-full items-center justify-between gap-3 rounded-bw-field px-2 py-2 text-start text-bw-small text-bw-ink transition-colors hover:bg-bw-sunken/60">
                      <span>{item.text}</span>
                      <span className="shrink-0 text-bw-ink-soft">عرض</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Broadcast requests */}
          <section ref={rfqSection} aria-label="الطلبات المرسلة للموردين" className="scroll-mt-4">
            <h2 className="mb-2 text-bw-heading font-semibold text-bw-ink">الطلبات المرسلة للموردين</h2>
            {rfqItems.length === 0 ? <StateBlock kind="empty" title="لا توجد طلبات مرسلة" body="تظهر الطلبات هنا بعد تجميع احتياج العملاء وإرساله للموردين." /> : (
              <ul className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-surface">
                {rfqItems.map((rfq) => (
                  <RfqItem key={rfq.id} rfq={rfq} open={openRfq === rfq.id} onToggle={() => setOpenRfq(openRfq === rfq.id ? null : rfq.id)} supplierName={supplierName} />
                ))}
              </ul>
            )}
          </section>

          {/* Final POs */}
          <section ref={poSection} aria-label="أوامر الشراء النهائية" className="scroll-mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-bw-heading font-semibold text-bw-ink">أوامر الشراء النهائية</h2>
              <div role="group" aria-label="تصفية أوامر الشراء" className="inline-flex rounded-bw-field border border-bw-line p-0.5">
                {([['all', 'الكل'], ['attention', 'تحتاج تدخل'], ['owed', 'عليها مستحق']] as Array<[PoFilter, string]>).map(([value, text]) => (
                  <button key={value} type="button" aria-pressed={poFilter === value} onClick={() => setPoFilter(value)}
                    className={cn('min-h-8 rounded-bw-field px-3 text-bw-small transition-colors', poFilter === value ? 'bg-bw-sunken font-semibold text-bw-ink' : 'text-bw-ink-soft hover:text-bw-ink')}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
            {pos.error ? <LoadError message={pos.error.message} onRetry={pos.reload} /> : null}
            {pos.data && shownPos.length === 0 ? (
              <StateBlock kind="empty" title={poFilter === 'all' ? 'لا توجد أوامر شراء' : 'لا توجد أوامر شراء بهذه الحالة'} body={poFilter === 'all' ? 'يُنشأ أمر الشراء عندما يرسو طلب على مورد.' : undefined} />
            ) : (
              <ul className="divide-y divide-bw-line rounded-bw-card border border-bw-line bg-bw-surface">
                {shownPos.map((po) => (
                  <PoItem key={po.id} po={po} supplier={supplierName.get(po.supplierId) ?? shortRef(po.supplierId)} payable={payableByPo.get(po.id)} open={openPo === po.id} onToggle={() => setOpenPo(openPo === po.id ? null : po.id)} onChanged={reloadAll} />
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <FlushDialog dialogRef={flushDialog.ref} onClose={() => flushDialog.close()} onDone={(m) => { flushDialog.close(); setNotice(m); reloadAll() }} />
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <li className="flex items-center gap-2 text-bw-ink-soft">
      <span className={cn('size-2.5 rounded-full', color)} aria-hidden />
      {label}
      <Code className="font-semibold text-bw-ink">{value}</Code>
    </li>
  )
}

function RowButton({ open, controls, onToggle, children }: { open: boolean; controls: string; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-bw-sunken">
      <ChevronDown className={cn('size-4 shrink-0 text-bw-ink-subtle transition-transform', open ? 'rotate-180' : 'rtl:rotate-90 ltr:-rotate-90')} aria-hidden />
      {children}
    </button>
  )
}

/* ── Broadcast request ───────────────────────────────────────────────────────────────────────── */

function RfqItem({ rfq, open, onToggle, supplierName }: { rfq: RfqListItem; open: boolean; onToggle: () => void; supplierName: Map<string, string> }) {
  const [text, tone] = RFQ_STATUS_TEXT[rfq.status]
  const covered = percent(rfq.awardedQuantity, rfq.requiredQuantity)
  const panel = `rfq-${rfq.id}`
  return (
    <li>
      <RowButton open={open} controls={panel} onToggle={onToggle}>
        <span className="min-w-0 flex-1">
          <span className="block whitespace-nowrap font-semibold text-bw-ink"><Code>{rfq.batchRef}</Code></span>
          <span className="block text-[11px] text-bw-ink-subtle">{formatDateTime(rfq.createdAt)}{rfq.expedited ? <span className="ms-2 font-semibold text-bw-amber">عاجل</span> : null}<span className="sm:hidden"> · غُطّي <Code>{`${rfq.awardedQuantity}/${rfq.requiredQuantity}`}</Code></span></span>
        </span>
        <span className="hidden w-24 shrink-0 text-bw-small text-bw-ink-soft lg:block"><Code>{rfq.lineCount}</Code> منتج</span>
        <span className="hidden w-40 shrink-0 items-center gap-2 text-bw-small sm:flex">
          <MiniBar value={covered} label={`غُطّي ${covered}%`} />
          <Code className="text-bw-ink-soft">{`${rfq.awardedQuantity}/${rfq.requiredQuantity}`}</Code>
        </span>
        <span className="hidden w-28 shrink-0 text-bw-small text-bw-ink-soft xl:block">ردّ <Code>{`${rfq.recipients.responded}/${rfq.recipients.total}`}</Code></span>
        <StatusLabel tone={tone}>{text}</StatusLabel>
      </RowButton>
      {open ? <RfqPanel id={panel} rfq={rfq} supplierName={supplierName} /> : null}
    </li>
  )
}

function RfqPanel({ id, rfq, supplierName }: { id: string; rfq: RfqListItem; supplierName: Map<string, string> }) {
  const { data, error, loading, reload } = useApi<RfqDetail>(`/rfq/staff/${rfq.id}`)
  return (
    <div id={id} className="space-y-3 border-t border-bw-line bg-bw-page/40 px-4 py-4 sm:ps-12">
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {loading && !data ? <Skeleton className="h-24 w-full" /> : null}
      {data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-start text-bw-small">
              <thead className="text-[11px] text-bw-ink-subtle">
                <tr>
                  <th className="pb-2 text-start font-medium">المنتج</th>
                  <th className="pb-2 text-start font-medium">المطلوب</th>
                  <th className="pb-2 text-start font-medium">رسا على موردين</th>
                  <th className="pb-2 text-start font-medium">المتبقي بلا مورد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bw-line">
                {data.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="py-2 pe-3"><bdi className="font-semibold text-bw-ink">{line.sku ? `${line.sku.productName} · ${line.sku.variantName}` : shortRef(line.skuId)}</bdi>{line.sku ? <span className="ms-2 text-[11px] text-bw-ink-subtle"><Code>{line.sku.skuCode}</Code></span> : null}</td>
                    <td className="py-2 pe-3"><Code>{line.requiredQuantity}</Code></td>
                    <td className="py-2 pe-3"><Code>{line.awardedQuantity}</Code></td>
                    <td className={cn('py-2', line.remainingQuantity > 0 && rfq.status === 'exhausted' ? 'font-semibold text-bw-rose' : 'text-bw-ink')}><Code>{line.remainingQuantity}</Code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-bw-small text-bw-ink-soft">
            الموردون: ردّ <Code>{rfq.recipients.responded}</Code> · بانتظار الرد <Code>{rfq.recipients.pending}</Code> · انتهت مهلتهم <Code>{rfq.recipients.timedOut}</Code>
            {data.recipients.length ? <> ({data.recipients.slice(0, 4).map((r) => supplierName.get(r.supplierId) ?? shortRef(r.supplierId)).join('، ')}{data.recipients.length > 4 ? '…' : ''})</> : null}
            {rfq.closeReason ? <> · {CLOSE_REASON_TEXT[rfq.closeReason] ?? rfq.closeReason}</> : null}
          </p>
        </>
      ) : null}
    </div>
  )
}

/* ── Final PO ────────────────────────────────────────────────────────────────────────────────── */

function PoItem({ po, supplier, payable, open, onToggle, onChanged }: { po: StaffPo; supplier: string; payable?: Payable; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const requested = po.lines.reduce((s, l) => s + l.requestedQuantity, 0)
  const confirmed = po.lines.reduce((s, l) => s + (l.confirmedQuantity ?? 0), 0)
  const needsDecision = po.lines.some((l) => l.distributionRequired)
  const panel = `po-${po.id}`
  return (
    <li id={panel + '-row'}>
      <RowButton open={open} controls={panel} onToggle={onToggle}>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-bw-ink"><bdi>{supplier}</bdi></span>
          <span className="block text-[11px] text-bw-ink-subtle"><Code>{shortRef(po.id)}</Code> · {formatDateTime(po.createdAt)}</span>
        </span>
        {needsDecision ? <span className="hidden text-bw-small font-semibold text-bw-amber sm:block">يحتاج قرار توزيع</span> : null}
        <span className="hidden w-28 shrink-0 text-bw-small text-bw-ink-soft sm:block">مؤكد <Code>{`${confirmed}/${requested}`}</Code></span>
        <span className="hidden w-32 shrink-0 text-bw-small md:block">{payable ? <><Egp value={payable.netAmount ?? payable.amount} /></> : <span className="text-bw-ink-subtle">—</span>}</span>
        <span className="shrink-0"><Status map={PO_STATUS} value={po.status} /></span>
      </RowButton>
      {open ? <PoPanel id={panel} po={po} payable={payable} onChanged={onChanged} /> : null}
    </li>
  )
}

function PoPanel({ id, po, payable, onChanged }: { id: string; po: StaffPo; payable?: Payable; onChanged: () => void }) {
  return (
    <div id={id} className="space-y-4 border-t border-bw-line bg-bw-page/40 px-4 py-4 sm:ps-12">
      {po.lines.map((line) => (
        <div key={line.id} className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-bw-small">
            <bdi className="font-semibold text-bw-ink">{line.sku ? `${line.sku.productName} · ${line.sku.variantName}` : shortRef(line.skuId)}</bdi>
            <span className="text-bw-ink-soft">مطلوب <Code>{line.requestedQuantity}</Code></span>
            <span className="text-bw-ink-soft">مؤكد <Code>{line.confirmedQuantity ?? '—'}</Code></span>
            <span className="text-bw-ink-soft">التكلفة <Egp value={line.unitCost} /></span>
            <Status map={PO_LINE_STATUS} value={line.status} />
          </div>
          {line.exceptionCode ? (
            <p className="text-bw-small text-bw-amber">
              {SUPPLIER_EXCEPTIONS[line.exceptionCode] ?? line.exceptionCode}
              {line.proposedQuantity ? <> · يقترح كمية <Code>{line.proposedQuantity}</Code></> : null}
              {line.proposedUnitCost ? <> · يقترح تكلفة <Egp value={line.proposedUnitCost} /></> : null}
            </p>
          ) : null}
          {line.allocations.length ? (
            <ul className="flex flex-wrap gap-2 text-[11px] text-bw-ink-soft">
              {line.allocations.map((a) => (
                <li key={a.sourceAllocationId} className="rounded-full bg-bw-sunken px-2.5 py-1">
                  <Link href={`/admin/orders/${a.orderId}`} className="underline underline-offset-2">طلب <Code>{shortRef(a.orderId)}</Code></Link>
                  {' '}<Code>{a.quantity}</Code> · مؤكد <Code>{a.confirmedQuantity ?? '—'}</Code> · وصل <Code>{a.receivedQuantity}</Code>
                </li>
              ))}
            </ul>
          ) : null}
          {line.distributionRequired ? <Distribute po={po} line={line} onDone={onChanged} /> : null}
        </div>
      ))}
      <p className="text-[11px] text-bw-ink-subtle">
        أُنشئ {formatDateTime(po.createdAt)}{po.readyAt ? ` · جاهز ${formatDateTime(po.readyAt)}` : ''}{po.receivedAt ? ` · وصل المخزن ${formatDateTime(po.receivedAt)}` : ''}
      </p>
      {po.status === 'received_at_hub' ? <PayableBox po={po} payable={payable} onChanged={onChanged} /> : null}
    </div>
  )
}

/** Scarce stock: the Admin decides who gets the partial quantity. Audited by the API, never automatic. */
function Distribute({ po, line, onDone }: { po: StaffPo; line: PoLine; onDone: () => void }) {
  const [split, setSplit] = React.useState<Record<string, number>>({})
  const [reason, setReason] = React.useState('')
  const total = Object.values(split).reduce((s, n) => s + n, 0)
  const available = line.confirmedQuantity ?? 0
  const cmd = useCommand(() => api(`/purchase-orders/${po.id}/lines/${line.id}/distribute`, {
    body: { allocations: line.allocations.map((a) => ({ sourceAllocationId: a.sourceAllocationId, quantity: split[a.sourceAllocationId] ?? 0 })), reason: reason.trim() },
  }))
  return (
    <form className="space-y-3 rounded-bw-field border border-bw-amber/30 bg-bw-amber-soft/50 p-3" onSubmit={async (e) => { e.preventDefault(); if (await cmd.execute()) onDone() }}>
      <p className="text-bw-small font-semibold text-bw-ink">المورد أكّد <Code>{available}</Code> فقط، وزّعها على الطلبات</p>
      <div className="flex flex-wrap gap-3">
        {line.allocations.map((a) => (
          <label key={a.sourceAllocationId} className="flex items-center gap-2 text-bw-small text-bw-ink">
            طلب <Code>{shortRef(a.orderId)}</Code> (طلب <Code>{a.quantity}</Code>)
            <input
              type="number" min={0} max={a.quantity} dir="ltr"
              value={split[a.sourceAllocationId] ?? 0}
              onChange={(e) => setSplit({ ...split, [a.sourceAllocationId]: Math.max(0, Math.min(a.quantity, Number(e.target.value))) })}
              className="h-bw-control w-20 rounded-bw-field border border-bw-line-field bg-bw-surface px-2 bw-code"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field className="min-w-56 flex-1" label="سبب القرار" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="submit" loading={cmd.pending} disabled={total !== available || !reason.trim()}>تأكيد التوزيع <Code>{`${total}/${available}`}</Code></Button>
      </div>
      <CommandError error={cmd.error} />
    </form>
  )
}

function PayableBox({ po, payable, onChanged }: { po: StaffPo; payable?: Payable; onChanged: () => void }) {
  const create = useCommand(() => api(`/sourcing/purchase-orders/${po.id}/payable`, { method: 'POST' }))
  const [ref, setRef] = React.useState('')
  const [creditRef, setCreditRef] = React.useState('')
  const [creditAmount, setCreditAmount] = React.useState('')
  const [showCredit, setShowCredit] = React.useState(false)
  const pay = useCommand(() => api(`/sourcing/payables/${payable?.id}/mark-paid`, { method: 'PATCH', body: { paymentRef: ref.trim() } }))
  const credit = useCommand(() => api(`/sourcing/payables/${payable?.id}/apply-credit`, { method: 'POST', body: { creditAmount: Number(creditAmount), supplierReturnRef: creditRef.trim() } }))

  if (!payable) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-bw-line pt-3">
        <Button variant="secondary" loading={create.pending} onClick={async () => { if (await create.execute()) onChanged() }}>حساب مستحق المورد</Button>
        <span className="text-bw-small text-bw-ink-soft">المستحق = الكمية التي وصلت فعلًا × تكلفة أمر الشراء</span>
        <CommandError error={create.error} />
      </div>
    )
  }
  return (
    <div className="space-y-3 border-t border-bw-line pt-3">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-bw-small">
        <span className="text-bw-ink-soft">المستحق</span>
        <Egp value={payable.grossAmount ?? payable.amount} />
        {payable.creditApplied ? <span className="text-bw-emerald">− رصيد مرتجع <Egp value={payable.creditApplied} /></span> : null}
        <span className="font-semibold text-bw-ink">الصافي <Egp value={payable.netAmount ?? payable.amount} /></span>
        <Status map={PAYABLE_STATUS} value={payable.status} />
        {payable.paymentRef ? <Code>{payable.paymentRef}</Code> : null}
      </p>
      {payable.status !== 'paid' ? (
        <div className="space-y-2">
          <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => { e.preventDefault(); if (await pay.execute()) onChanged() }}>
            <Field className="w-56" label="مرجع التحويل" ltr value={ref} onChange={(e) => setRef(e.target.value)} />
            <Button type="submit" variant="secondary" loading={pay.pending} disabled={!ref.trim()}>تسجيل السداد</Button>
            {!showCredit ? <button type="button" onClick={() => setShowCredit(true)} className="pb-2.5 text-bw-small text-bw-ink-soft underline underline-offset-4">خصم رصيد مرتجع</button> : null}
          </form>
          {showCredit ? (
            <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => { e.preventDefault(); if (await credit.execute()) { setShowCredit(false); onChanged() } }}>
              <Field className="w-44" label="رقم إذن المرتجع" value={creditRef} onChange={(e) => setCreditRef(e.target.value)} />
              <Field className="w-32" label="المبلغ" type="number" ltr value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} />
              <Button type="submit" variant="secondary" loading={credit.pending} disabled={!creditRef.trim() || !(Number(creditAmount) > 0)}>تطبيق الخصم</Button>
              <button type="button" onClick={() => setShowCredit(false)} className="pb-2.5 text-bw-small text-bw-ink-soft underline underline-offset-4">إلغاء</button>
            </form>
          ) : null}
          <CommandError error={pay.error ?? credit.error} />
        </div>
      ) : payable.paidAt ? <p className="text-bw-small text-bw-ink-soft">سُدّد {formatDateTime(payable.paidAt)}</p> : null}
    </div>
  )
}

/* ── Early send: an audited exception to the checkpoint schedule ───────────────────────────────── */

function FlushDialog({ dialogRef, onClose, onDone }: { dialogRef: React.RefObject<HTMLDialogElement | null>; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = React.useState('')
  const [includeClosed, setIncludeClosed] = React.useState(false)
  const mode = useApi<{ mode: string }>('/rfq/mode')
  const broadcast = mode.data?.mode === 'BROADCAST_ON_DEMAND'
  const run = useCommand(async () => {
    if (broadcast) {
      const result = await api<unknown>('/rfq/batches', { body: { reason: reason.trim(), includeClosedSuppliers: includeClosed } })
      return result
    }
    return api<unknown>('/purchase-orders/batches', { body: { reason: reason.trim(), ...(includeClosed ? { force: true } : {}) } })
  })
  return (
    <Dialog
      dialogRef={dialogRef}
      title="إرسال الطلبات الآن"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>إلغاء</Button>
        <Button type="submit" form="flush-form" loading={run.pending} disabled={reason.trim().length < 3 || !mode.data}>إرسال</Button>
      </>}
    >
      <form
        id="flush-form"
        dir="rtl"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if ((await run.execute()) !== undefined) { setReason(''); onDone('تم إرسال الاحتياج المعلّق للموردين') }
        }}
      >
        <p className="text-bw-small text-bw-ink-soft">يرسل احتياج العملاء المعلّق الآن بدل انتظار الموعد الدوري. يُسجَّل السبب في السجل.</p>
        <Field label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        <label className="flex items-center gap-2 text-bw-small text-bw-ink">
          <input type="checkbox" className="size-4 accent-bw-cobalt" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
          شمل الموردين خارج ساعات عملهم
        </label>
        <CommandError error={run.error} />
      </form>
    </Dialog>
  )
}
