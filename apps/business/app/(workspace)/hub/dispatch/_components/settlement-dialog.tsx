'use client'

import * as React from 'react'
import { AlertTriangle, Check, ShieldCheck } from 'lucide-react'
import { Button, Notice, Skeleton } from '@/components/bw/primitives'
import { CopyId } from '@/components/workspace/copy-id'
import { ResponsiveDialog } from '@/components/workspace/responsive-dialog'
import { CommandError, Egp } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { RUN_BLOCKER, formatDateTime, shortId } from '@/lib/labels'
import { cashDifference, parseAmount, tripRef, type RunSettlementDetail } from '@/lib/trip-ops'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { Disclosure } from './trip-ui'
import { ReturnScanRow } from './return-scan'

export interface SettleTarget {
  courierId: string
  courierName: string
  /** Absent only for declared cash that belongs to no trip listed on this page (older trips). */
  runId?: string
  /** For the no-trip case: the orders whose cash is counted. */
  orderIds?: string[]
}

interface AwaitingCash {
  orderId: string
  orderNumber: string
  expected: number
  declared: number | null
}

/**
 * تسوية المشوار. One decision: how much cash did the courier actually hand over. Expected COD comes from the backend, the
 * difference is computed live, returned parcels are confirmed by label scan, and one button records the count and closes the trip.
 * A settled trip opens as a read-only summary; the server refuses a second count (409), and the form is not even offered.
 */
export function SettlementDialog({
  hubId,
  target,
  collections,
  onClose,
  onChanged,
}: {
  hubId: string
  target: SettleTarget
  /** Declared cash of the no-trip case (only read when there is no runId). */
  collections: Array<{ orderId: string; orderNumber: string; expectedAmount: string; declaredAmount: string | null }>
  onClose: () => void
  onChanged: () => void
}) {
  const { runId, courierId, courierName } = target
  const detail = useApi<RunSettlementDetail>(runId ? `/fulfillment/delivery-batches/${runId}/settlement` : null)
  const run = detail.data

  const [input, setInput] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [done, setDone] = React.useState<{ variance: number; closed: boolean } | null>(null)
  // One reference per dialog: the server treats it as the idempotency key of the count.
  const reference = React.useRef(`CNT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${courierId.slice(0, 4)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase())

  const awaiting: AwaitingCash[] = React.useMemo(() => {
    if (runId) {
      return (run?.deliveredOrders ?? [])
        .filter((o) => o.cash?.status === 'collected')
        .map((o) => ({ orderId: o.orderId, orderNumber: o.orderNumber ?? shortId(o.orderId), expected: o.cash!.expectedAmount, declared: o.cash!.declaredAmount }))
    }
    const scope = new Set(target.orderIds ?? [])
    return collections
      .filter((c) => scope.size === 0 || scope.has(c.orderId))
      .map((c) => ({ orderId: c.orderId, orderNumber: c.orderNumber, expected: Number(c.expectedAmount), declared: c.declaredAmount === null ? null : Number(c.declaredAmount) }))
  }, [runId, run, collections, target.orderIds])

  const expected = awaiting.reduce((sum, a) => sum + a.expected, 0)
  const received = parseAmount(input)
  const diff = cashDifference(expected, received)
  const returns = run?.pendingReturns ?? []
  const cashDue = awaiting.length > 0 && !done
  const closed = run?.state === 'completed'
  const delivered = run?.stops.delivered ?? 0
  const returned = (run?.stops.pendingReturns ?? 0) + (run?.stops.returnedToHub ?? 0)

  // Everything the primary action does, in the order the server requires: count the cash, then close the trip if nothing else is open.
  const confirm = useCommand(async () => {
    let variance = 0
    try {
      if (cashDue) {
        const round = await api<{ variance: string }>('/ordering/settlements/rounds', {
          body: {
            courierId,
            locationId: hubId,
            reference: reference.current,
            runId: runId || undefined,
            orderIds: awaiting.map((a) => a.orderId),
            countedTotal: received,
            notes: notes.trim() || undefined,
          },
        })
        variance = Number(round.variance)
      }
      let closedNow = false
      if (runId) {
        const fresh = await api<RunSettlementDetail>(`/fulfillment/delivery-batches/${runId}/settlement`)
        if (fresh.canComplete) {
          await api(`/fulfillment/delivery-batches/${runId}/complete`, { method: 'POST' })
          closedNow = true
        }
      }
      setDone({ variance, closed: closedNow })
    } finally {
      // Whatever happened, show the server's current position (a count that succeeded must not be offered twice).
      detail.reload()
      onChanged()
    }
  })

  const otherBlockers = (run?.blockers ?? []).filter((b) => !['CASH_AWAITING_COUNT', 'PENDING_RETURNS', 'STOPS_IN_TRANSIT'].includes(b.code))
  const needsReturns = returns.length > 0
  const canConfirmCash = cashDue && received !== null && !needsReturns
  const canCloseOnly = !cashDue && !!run?.canComplete
  const primaryDisabled = !(canConfirmCash || canCloseOnly)
  const showPrimary = !closed && !(done && !cashDue && !run?.canComplete)

  const why: string[] = []
  if (cashDue && received === null) why.push('أدخل المبلغ المستلم فعليًا')
  if (needsReturns) why.push('أكّد استلام الطرود المرتجعة بالباركود')
  if (!cashDue && !canCloseOnly && !closed) why.push(...(run?.blockers ?? []).map((b) => (RUN_BLOCKER[b.code] ?? (() => b.code))(b.count)))

  return (
    <ResponsiveDialog
      title={closed ? 'ملخص التسوية' : 'تسوية المشوار'}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium text-bw-ink">{courierName}</span>
          {runId ? <CopyId value={runId} display={tripRef(runId)} label="رقم المشوار" muted /> : <span>نقدية بدون مشوار</span>}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إغلاق</Button>
          {showPrimary ? (
            <Button loading={confirm.pending} disabled={primaryDisabled} onClick={() => confirm.execute()}>
              <ShieldCheck className="size-4" aria-hidden />
              {cashDue ? 'تأكيد التسوية' : 'إغلاق المشوار'}
            </Button>
          ) : null}
        </>
      }
    >
      {runId && detail.loading && !run ? <Skeleton className="h-28 w-full rounded-bw-card" /> : null}
      {runId && detail.error ? <LoadError message={detail.error.message} onRetry={detail.reload} /> : null}

      {done ? (
        <Notice tone={done.variance === 0 ? 'ok' : 'warn'} title={done.closed ? 'تمت التسوية وأُغلق المشوار' : 'تم تسجيل التسوية'}>
          {done.variance === 0
            ? 'المبلغ مطابق للمتوقع.'
            : `${done.variance < 0 ? 'عجز' : 'زيادة'} ${Math.abs(done.variance).toLocaleString('en-US')} ج.م — سُجّل الفرق للمراجعة الإدارية.`}
        </Notice>
      ) : null}

      {/* The three numbers that frame the decision. Expected COD is the backend's, never typed. */}
      {run || !runId ? (
        <dl className="grid grid-cols-3 gap-3 border-b border-bw-line pb-4">
          <Stat label="تم التسليم" value={runId ? delivered : awaiting.length} />
          <Stat label="مرتجع" value={runId ? returned : 0} danger={returns.length > 0} />
          <div>
            <dt className="text-[11px] text-bw-ink-subtle">{cashDue ? 'المتوقع (COD)' : 'التحصيل المتوقع'}</dt>
            <dd className="text-bw-heading font-semibold tabular-nums text-bw-ink">
              {runId && (run?.cash.codOrders ?? 0) === 0 ? <span className="text-bw-small font-normal text-bw-ink-soft">بدون تحصيل</span> : <Egp value={runId ? run?.cash.expectedTotal ?? 0 : expected} />}
            </dd>
          </div>
        </dl>
      ) : null}

      {/* Returned parcels come first: the cash count is only confirmed once every returned parcel is back and verified. */}
      {needsReturns ? (
        <section aria-label="طرود مرتجعة" className="space-y-1">
          <div className="flex items-center gap-2 text-bw-small font-semibold text-bw-danger">
            <AlertTriangle className="size-4" aria-hidden />
            {returns.length} طرد مرتجع ما زال مع المندوب
          </div>
          <p className="text-[11px] text-bw-ink-subtle">امسح باركود الطرد للتأكد من وصوله إلى المخزن. لا تُكتمل التسوية بدونه.</p>
          <ul className="divide-y divide-bw-line/70">
            {returns.map((p) => (
              <ReturnScanRow key={p.shipmentId} parcel={p} onDone={() => { detail.reload(); onChanged() }} />
            ))}
          </ul>
        </section>
      ) : null}

      {cashDue ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canConfirmCash) confirm.execute()
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-bw-small font-semibold text-bw-ink">المبلغ المستلم فعليًا</span>
            <span className="flex items-center gap-2 rounded-bw-field border border-bw-line-field bg-bw-page px-3 focus-within:border-bw-ink">
              <input
                autoFocus
                dir="ltr"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-invalid={input.trim() !== '' && received === null ? true : undefined}
                className="bw-code h-14 min-w-0 flex-1 bg-transparent text-start text-bw-figure font-semibold text-bw-ink outline-none placeholder:text-bw-ink-subtle focus-visible:outline-none"
              />
              <span className="text-bw-small text-bw-ink-soft">ج.م</span>
            </span>
          </label>
          {input.trim() !== '' && received === null ? <p className="text-bw-small text-bw-danger">أدخل مبلغًا صحيحًا (أرقام فقط، حتى خانتين عشريتين).</p> : null}

          <div aria-live="polite" className="min-h-6">
            {diff.kind === 'matched' ? (
              <p className="flex items-center gap-1.5 text-bw-small font-semibold text-bw-emerald">
                <Check className="size-4" aria-hidden /> مطابق للمتوقع
              </p>
            ) : diff.kind === 'shortage' || diff.kind === 'surplus' ? (
              <p className={cn('flex items-center gap-1.5 text-bw-small font-semibold', diff.kind === 'shortage' ? 'text-bw-danger' : 'text-bw-warn')}>
                <AlertTriangle className="size-4" aria-hidden />
                {diff.kind === 'shortage' ? 'عجز' : 'زيادة'} <Egp value={diff.amount} />
                <span className="font-normal text-bw-ink-soft">— يُسجَّل الفرق للمراجعة الإدارية.</span>
              </p>
            ) : null}
          </div>

          {diff.kind === 'shortage' || diff.kind === 'surplus' ? (
            <label className="block space-y-1.5">
              <span className="text-bw-small text-bw-ink-soft">سبب الفرق (اختياري)</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bw-control h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface px-3 text-bw-small"
              />
            </label>
          ) : null}
          <button type="submit" className="sr-only" tabIndex={-1}>تأكيد التسوية</button>
        </form>
      ) : null}

      {otherBlockers.length > 0 && !closed ? (
        <Notice tone={run?.state === 'reconciliation_required' ? 'warn' : 'info'} title="يمنع إغلاق المشوار">
          <ul className="list-disc space-y-0.5 ps-4">
            {otherBlockers.map((b) => (
              <li key={b.code}>{(RUN_BLOCKER[b.code] ?? (() => b.code))(b.count)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {/* Counted rounds: read-only. Once the cash is counted, nothing here can be entered again. */}
      {(run?.settlements ?? []).length > 0 ? (
        <section aria-label="التسويات المسجلة" className="space-y-1.5">
          <h3 className="text-bw-small font-semibold text-bw-ink-soft">التسويات المسجلة</h3>
          <ul className="divide-y divide-bw-line/70">
            {run!.settlements.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2 text-bw-small">
                <span className="flex items-center gap-2 text-bw-ink-soft">
                  <CopyId value={s.reference} label="مرجع التسوية" />
                  <span className="text-[11px] text-bw-ink-subtle">{formatDateTime(s.settledAt)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Egp value={s.countedTotal} className="font-semibold text-bw-ink" />
                  {s.variance === 0 ? (
                    <span className="text-bw-emerald">مطابق</span>
                  ) : (
                    <span className={s.variance < 0 ? 'text-bw-danger' : 'text-bw-warn'}>
                      {s.variance < 0 ? 'عجز' : 'زيادة'} {Math.abs(s.variance).toLocaleString('en-US')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DeliveredOrders run={run} awaiting={awaiting} />

      {!primaryDisabled || why.length === 0 || closed ? null : <p className="text-[11px] text-bw-ink-subtle">{why.join(' · ')}</p>}
      <CommandError error={confirm.error} />
    </ResponsiveDialog>
  )
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-bw-ink-subtle">{label}</dt>
      <dd className={cn('text-bw-heading font-semibold tabular-nums', danger ? 'text-bw-danger' : 'text-bw-ink')}>{value}</dd>
    </div>
  )
}

/** Delivered orders with their cash, behind a disclosure: secondary detail, every order number copyable. */
function DeliveredOrders({ run, awaiting }: { run: RunSettlementDetail | undefined; awaiting: AwaitingCash[] }) {
  const [open, setOpen] = React.useState(false)
  const rows = run
    ? run.deliveredOrders.map((o) => ({
        key: o.orderId,
        number: o.orderNumber ?? shortId(o.orderId),
        orderId: o.orderId,
        expected: o.cash?.expectedAmount ?? null,
        counted: o.cash?.countedAmount ?? null,
        declared: o.cash?.declaredAmount ?? null,
      }))
    : awaiting.map((a) => ({ key: a.orderId, number: a.orderNumber, orderId: a.orderId, expected: a.expected, counted: null, declared: a.declared }))
  if (rows.length === 0) return null
  return (
    <Disclosure label={`الطلبات المسلّمة (${rows.length})`} open={open} onToggle={() => setOpen((v) => !v)}>
      <ul className="divide-y divide-bw-line/70">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5 text-bw-small">
            <span className="flex items-center gap-2">
              <CopyId value={r.number} label="رقم الطلب" className="font-semibold text-bw-ink" />
              <CopyId value={r.orderId} display={shortId(r.orderId)} label="معرّف الطلب" muted className="text-[11px]" />
            </span>
            <span className="text-bw-ink-soft">
              {r.expected === null ? 'بدون تحصيل' : <>متوقع <Egp value={r.expected} className="font-semibold text-bw-ink" />{r.declared !== null ? <> · أعلن المندوب <Egp value={r.declared} /></> : null}</>}
            </span>
          </li>
        ))}
      </ul>
    </Disclosure>
  )
}
