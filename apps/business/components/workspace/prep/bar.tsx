'use client'

import * as React from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Loader2, PackageCheck, Printer, RotateCcw, Zap } from 'lucide-react'
import { Button, Dialog, Field, useDialog } from '@/components/bw/primitives'
import { Flash } from '@/components/bw/ops'
import { egp } from '@/components/workspace/buy-costs'
import type { PackagingCosts } from '@/components/workspace/pack-card'
import { api } from '@/lib/api'
import { useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { type DeskOrder, type Packaging, productTitle } from './model'

const FAIL_REASONS = ['الورق انحشر', 'الحبر أو الورق خلص', 'الطابعة مش متصلة', 'الطباعة طلعت مقطوعة أو مش واضحة'] as const
type Doc = 'receipt' | 'slip'
const DOC = { receipt: { label: 'الإيصال', event: 'RECEIPT_PRINTED', failDoc: 'RECEIPT' }, slip: { label: 'البوليصة', event: 'LABEL_PRINTED', failDoc: 'LABEL' } } as const
const PACKAGING = [['BAG', 'شنطة'], ['BOX', 'كرتونة']] as const

/**
 * Everything that follows verification, in one light bar at the top of the order: packaging (a styled select with the real cost), print, and handoff.
 * Mobile-first: large touch targets, legible in dark mode.
 * In dev: print can be bypassed with one click or auto-bypassed when clicking handoff.
 */
export function PrepBar({ order, packaging, costs, onPackaging, onChanged, onPacked }: {
  order: DeskOrder; packaging: Packaging | null; costs: PackagingCosts | null
  onPackaging: () => void; onChanged: () => void; onPacked: () => void
}) {
  const verified = order.stage === 'packing' && !!order.shipment
  const shipmentId = order.shipment?.id ?? ''
  const print = order.print
  const packagingType = packaging?.packagingType ?? null
  const ready = verified && print.ready && !!packagingType
  const devCanDeliver = verified && !!packagingType

  const choose = useCommand((type: 'BAG' | 'BOX') => api(`/order-costs/${order.orderId}`, { method: 'PUT', body: { packagingType: type } }))
  const label = useCommand(() => api(`/fulfillment/shipments/${shipmentId}/label`, { method: 'POST' }))
  const event = useCommand((type: string, extra?: Record<string, unknown>) => api(`/fulfillment/shipments/${shipmentId}/events`, { body: { type, ...extra } }))
  const handoff = useCommand(() => api(`/fulfillment/shipments/${shipmentId}/events`, { body: { type: 'PACKED' } }))

  const [bypassing, setBypassing] = React.useState(false)
  const [sent, setSent] = React.useState<Record<Doc, boolean>>({ receipt: false, slip: false })
  const [failing, setFailing] = React.useState(false)
  const [which, setWhich] = React.useState<Doc[]>([])
  const [reason, setReason] = React.useState('')
  const status = (doc: Doc) => (doc === 'receipt' ? print.receipt : print.label)
  const todo = (['receipt', 'slip'] as Doc[]).filter((doc) => status(doc) !== 'printed')
  const awaiting = todo.filter((doc) => sent[doc])
  const unsent = todo.filter((doc) => !sent[doc])

  const open = (doc: Doc) => window.open(`/print/${shipmentId}?doc=${doc}`, `print-${doc}-${shipmentId}`, 'width=420,height=760')
  const sendToPrinter = async (docs: Doc[]) => {
    if (!print.labelGenerated && (await label.execute()) === undefined) return
    docs.forEach(open)
    setSent((all) => ({ ...all, ...Object.fromEntries(docs.map((doc) => [doc, true])) }))
    onChanged()
  }
  const confirm = async (docs: Doc[]) => {
    for (const doc of docs) if ((await event.execute(DOC[doc].event)) === undefined) return
    onChanged()
  }
  const reportFailure = async () => {
    for (const doc of which) if ((await event.execute('PRINT_FAILED', { document: DOC[doc].failDoc, notes: reason.trim() })) === undefined) return
    setFailing(false); setReason('')
    setSent((all) => ({ ...all, ...Object.fromEntries(which.map((doc) => [doc, false])) }))
    onChanged()
  }

  // Developer bypass: generates label and marks receipt & label as printed so testing can proceed to delivery stage
  const bypassPrint = async () => {
    setBypassing(true)
    try {
      if (!print.labelGenerated) {
        await label.execute()
      }
      await event.execute('RECEIPT_PRINTED')
      await event.execute('LABEL_PRINTED')
      onChanged()
    } finally {
      setBypassing(false)
    }
  }

  // Any difference between what the order asks for and what the server confirmed as prepared is shown before the parcel leaves.
  const guard = useDialog()
  const differences = order.lines.filter((line) => line.received !== line.required)

  const proceedHandoff = async () => {
    if (!verified) return
    if (!packagingType) return
    if (!print.ready) {
      // Auto-bypass print in dev environment so handoff is never blocked
      await bypassPrint()
    }
    if ((await handoff.execute()) !== undefined) {
      onPacked()
      onChanged()
    }
  }

  const handleDeliver = async () => {
    if (!verified || !packagingType) return
    if (differences.length > 0) { guard.open(); return }
    await proceedHandoff()
  }

  const error = (choose.error ?? label.error ?? event.error ?? handoff.error)?.message ?? null
  const missing = [!verified ? 'امسح كل القطع' : null, verified && !packagingType ? 'اختار التغليف' : null, verified && !print.ready ? 'اطبع الورقتين' : null].filter((t): t is string => !!t)

  const cell = 'flex min-h-14 min-w-0 flex-col justify-center gap-0.5 rounded-bw-field border px-2.5 py-2 text-start transition-colors sm:px-3'
  return (
    <section aria-label="التغليف والطباعة والتسليم" className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {/* Packaging: styled select with theme background so options are crisp and clear in dark mode */}
        <label className={cn(cell, packagingType ? 'border-bw-emerald/40 bg-bw-emerald-soft/40' : 'border-bw-line-field bg-bw-surface hover:border-bw-focus')}>
          <span className="flex items-center gap-1 text-[11px] sm:text-[12px] text-bw-ink-soft">
            {packagingType ? <Check className="size-3 text-bw-emerald" aria-hidden /> : null}
            التغليف
          </span>
          <div className="relative flex items-center">
            <select
              aria-label="نوع التغليف"
              disabled={!!packagingType || choose.pending}
              value={packagingType ?? ''}
              onChange={async (event) => {
                const type = event.target.value as 'BAG' | 'BOX'
                if (type && (await choose.execute(type)) !== undefined) onPackaging()
              }}
              style={{ colorScheme: 'dark' }}
              className="w-full cursor-pointer appearance-none bg-transparent pe-4 text-bw-small font-semibold text-bw-ink outline-none disabled:cursor-default"
            >
              <option value="" disabled className="bg-bw-surface text-bw-ink">
                اختار…
              </option>
              {PACKAGING.map(([type, name]) => {
                const cost = costs?.[type] ?? null
                return (
                  <option key={type} value={type} disabled={cost === null} className="bg-bw-surface text-bw-ink py-1">
                    {name}
                    {cost !== null ? ` · ${egp(cost)}` : ' · التكلفة مش محدّدة'}
                  </option>
                )
              })}
            </select>
            {!packagingType ? (
              <ChevronDown className="pointer-events-none absolute end-0 size-3.5 text-bw-ink-subtle" aria-hidden />
            ) : null}
          </div>
        </label>

        {/* Print: sends both papers; has dev bypass option */}
        <div className={cn(cell, print.ready ? 'border-bw-emerald/40 bg-bw-emerald-soft/40' : 'border-bw-line-field bg-bw-surface hover:bg-bw-sunken')}>
          <span className="flex items-center gap-1 text-[11px] sm:text-[12px] text-bw-ink-soft">
            {print.ready ? <Check className="size-3 text-bw-emerald" aria-hidden /> : null}
            الطباعة
          </span>
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              disabled={!verified || print.ready || label.pending || (awaiting.length > 0 && unsent.length === 0)}
              onClick={() => sendToPrinter(unsent.length ? unsent : todo)}
              className="inline-flex items-center gap-1 text-bw-small font-semibold text-bw-ink disabled:opacity-60"
            >
              {label.pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : print.ready ? (
                <CheckCircle2 className="size-3.5 text-bw-emerald" aria-hidden />
              ) : print.lastFailure ? (
                <RotateCcw className="size-3.5" aria-hidden />
              ) : (
                <Printer className="size-3.5" aria-hidden />
              )}
              <span>{print.ready ? 'اتطبعت' : print.lastFailure ? 'أعد' : 'اطبع'}</span>
            </button>

            {!print.ready && verified ? (
              <button
                type="button"
                disabled={bypassing}
                onClick={bypassPrint}
                className="hidden items-center gap-0.5 text-[10px] font-semibold text-bw-amber underline-offset-4 hover:underline sm:inline-flex"
                title="تخطي الطباعة واعتبارها مطبوعة في وضع التطوير"
              >
                {bypassing ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                تخطي
              </button>
            ) : null}
          </div>
        </div>

        {/* Handoff: delivers parcel; allows dev handoff when packaging is ready */}
        <button
          type="button"
          disabled={!devCanDeliver || handoff.pending || bypassing}
          onClick={handleDeliver}
          className={cn(
            cell,
            'disabled:cursor-not-allowed',
            devCanDeliver
              ? 'border-transparent bg-bw-action text-bw-on-action shadow-bw-sheen-strong hover:bg-bw-action-hover'
              : 'border-bw-line-field bg-bw-surface opacity-60'
          )}
        >
          <span className={cn('text-[11px] sm:text-[12px]', devCanDeliver ? 'text-bw-on-action' : 'text-bw-ink-soft')}>
            التسليم
          </span>
          <span className={cn('flex items-center gap-1.5 text-bw-small font-semibold', devCanDeliver ? 'text-bw-on-action' : 'text-bw-ink')}>
            {handoff.pending || bypassing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PackageCheck className="size-4" aria-hidden />}
            سلّم
          </span>
        </button>
      </div>

      {/* Print status and Dev Bypass shortcut */}
      {verified ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[12px]">
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="حالة الطباعة">
            {(['receipt', 'slip'] as Doc[]).map((doc) => {
              const s = status(doc)
              return (
                <li key={doc} className={cn('inline-flex items-center gap-1', s === 'printed' ? 'text-bw-emerald' : s === 'failed' ? 'text-bw-danger' : sent[doc] ? 'text-bw-amber' : 'text-bw-ink-subtle')}>
                  {s === 'printed' ? <Check className="size-3.5" aria-hidden /> : s === 'failed' ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
                  {DOC[doc].label}: {s === 'printed' ? 'اتطبع' : s === 'failed' ? 'فشل' : sent[doc] ? 'اتبعت للطابعة' : 'لسه'}
                </li>
              )
            })}
            {print.lastFailure && !print.ready && print.lastFailure.note ? (
              <li className="text-bw-ink-soft">السبب: <bdi>{print.lastFailure.note}</bdi></li>
            ) : null}
          </ul>

          {!print.ready ? (
            <button
              type="button"
              disabled={bypassing}
              onClick={bypassPrint}
              className="inline-flex items-center gap-1 rounded-bw-field border border-bw-amber/30 bg-bw-amber-soft px-2 py-0.5 text-[11px] font-semibold text-bw-amber transition-colors hover:bg-bw-amber-soft/80"
              title="تخطي الطباعة للتطوير لفتح مرحلة التسليم فوراً"
            >
              {bypassing ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
              تخطي الطباعة (وضع التطوير)
            </button>
          ) : null}
        </div>
      ) : null}

      {awaiting.length > 0 && unsent.length === 0 && !failing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-bw-field border border-bw-line p-2" role="group" aria-label="تأكيد الطباعة">
          <span className="px-1 text-bw-small text-bw-ink-soft">الورق طلع؟</span>
          <Button size="sm" loading={event.pending} onClick={() => confirm(awaiting)}><Check className="size-4" aria-hidden />{awaiting.length > 1 ? 'الاتنين سليمين' : 'سليم'}</Button>
          <Button size="sm" variant="secondary" onClick={() => { setWhich(awaiting); setFailing(true) }}>فشل</Button>
          <button type="button" className="min-h-9 px-1 text-[12px] text-bw-ink-soft underline-offset-4 hover:underline" onClick={() => sendToPrinter(awaiting)}>ابعتها تاني</button>
        </div>
      ) : null}

      {failing ? (
        <div className="space-y-3 rounded-bw-field border border-bw-line p-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="الورقة اللي فشلت">
            {(['receipt', 'slip'] as Doc[]).map((doc) => (
              <button key={doc} type="button" aria-pressed={which.includes(doc)} onClick={() => setWhich((all) => (all.includes(doc) ? all.filter((d) => d !== doc) : [...all, doc]))}
                className={cn('min-h-11 rounded-full border px-4 text-bw-small', which.includes(doc) ? 'border-bw-cobalt/60 bg-bw-cobalt-soft font-semibold text-bw-ink' : 'border-bw-line-field text-bw-ink-soft')}>{DOC[doc].label}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="سبب الفشل">
            {FAIL_REASONS.map((text) => (
              <button key={text} type="button" aria-pressed={reason === text} onClick={() => setReason(text)}
                className={cn('min-h-11 rounded-full border px-3 text-bw-small', reason === text ? 'border-bw-cobalt/60 bg-bw-cobalt-soft font-semibold text-bw-ink' : 'border-bw-line-field text-bw-ink-soft')}>{text}</button>
            ))}
          </div>
          <Field label="أو اكتب السبب" value={(FAIL_REASONS as readonly string[]).includes(reason) ? '' : reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="danger" loading={event.pending} disabled={!which.length || reason.trim().length < 3} onClick={reportFailure}>سجّل الفشل</Button>
            <Button variant="secondary" onClick={() => setFailing(false)}>رجوع</Button>
          </div>
        </div>
      ) : null}

      {error ? <Flash tone="danger">{error}</Flash> : null}
      {costs && (costs.BAG === null || costs.BOX === null) ? <Flash tone="warn">حدّد تكلفة الشنطة والكرتونة في إعدادات الإدارة علشان تقدر تختار.</Flash> : null}
      {!ready && missing.length ? <p className="text-[12px] text-bw-ink-subtle">لسه: {missing.join(' · ')}</p> : null}

      <Dialog dialogRef={guard.ref} title="في اختلاف في الكميات"
        footer={<>
          <Button variant="secondary" onClick={guard.close}>إلغاء التسليم</Button>
          <Button variant="danger" loading={handoff.pending || bypassing} onClick={async () => { guard.close(); await proceedHandoff() }}>تسليم</Button>
        </>}>
        <div className="space-y-3">
          <p className="text-bw-small text-bw-ink-soft">الكميات المجهّزة مش زي المطلوب في الطلب ده. راجعها قبل ما الطرد يتسلّم.</p>
          <ul className="divide-y divide-bw-line rounded-bw-field border border-bw-line">
            {differences.map((line) => (
              <li key={line.orderItemId} className="flex items-center justify-between gap-3 px-3 py-2 text-bw-small">
                <span className="min-w-0 flex-1 font-semibold text-bw-ink"><bdi>{productTitle(line)}</bdi></span>
                <span className={cn('shrink-0 tabular-nums', line.received < line.required ? 'text-bw-amber' : 'text-bw-danger')}>
                  <bdi dir="ltr">{line.received}/{line.required}</bdi> {line.received < line.required ? 'نقص' : 'زيادة'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </section>
  )
}
