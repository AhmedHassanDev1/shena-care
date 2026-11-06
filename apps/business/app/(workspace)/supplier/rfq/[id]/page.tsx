'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowRight, CheckCircle2, Clock, X, Zap } from 'lucide-react'
import { Button, Code, Notice, PageHeader, Skeleton, StateBlock, Stepper, StatusLabel } from '@/components/bw/primitives'
import { CommandError } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, ApiError, newKey } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import { type RfqLineView, type RfqSnapshot, type RfqStreamMessage, useRfqStream } from '@/lib/rfq-live'
import { useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Answer = 'FULL' | 'PARTIAL' | 'UNAVAILABLE'

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
}

/** What the supplier chose and the exact server version/quantity it was looking at when choosing. */
interface Draft {
  answer: Answer
  quantity: number
  ackVersion: number
  seenQuantity: number
}

interface Change {
  from: number
  to: number
  at: number
  reason: string
}

interface Banner {
  key: string
  /** Demand line the notice is about; cleared once the supplier has reviewed or answered that line. */
  lineId?: string
  tone: 'warn' | 'info' | 'ok' | 'danger'
  title: string
  body?: string
}

const ANSWER_LABEL: Record<Answer, string> = { FULL: 'كامل', PARTIAL: 'جزئي', UNAVAILABLE: 'مش متاح' }

function productName(line: RfqLineView): string {
  const sku = line.sku
  if (!sku) return `صنف ${shortId(line.skuId)}`
  return [sku.brandName, sku.productName, sku.variantName].filter(Boolean).join(' · ')
}

/** A FULL/PARTIAL choice is only valid for the version it was made against; UNAVAILABLE can never over-buy. */
const needsReview = (line: RfqLineView, draft: Draft | undefined) =>
  !!draft && draft.answer !== 'UNAVAILABLE' && (draft.ackVersion !== line.version || draft.seenQuantity !== line.requestedQuantity)

export default function SupplierRfqDetailPage() {
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : ''

  const [snap, setSnap] = React.useState<RfqSnapshot | null>(null)
  const [loadError, setLoadError] = React.useState<ApiError | null>(null)
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({})
  const [changes, setChanges] = React.useState<Record<string, Change>>({})
  const [banners, setBanners] = React.useState<Banner[]>([])
  const [result, setResult] = React.useState<{ purchaseOrderId: string | null; awarded: number; lines: number } | null>(null)
  const snapRef = React.useRef<RfqSnapshot | null>(null)
  const reloadTimer = React.useRef<number | undefined>(undefined)
  const keyRef = React.useRef<{ fingerprint: string; key: string } | null>(null)
  /** Lines of the submission in flight: their own demand_changed echo is not news to this supplier. */
  const submittingRef = React.useRef<Set<string>>(new Set())

  const pushBanner = React.useCallback((banner: Omit<Banner, 'key'>) => {
    setBanners((list) => [{ ...banner, key: newKey() }, ...list].slice(0, 6))
  }, [])

  /** Records that a line's authoritative demand moved; never silently: banner + highlight + review requirement. */
  const noteChange = React.useCallback((line: RfqLineView, from: number, to: number, reason: string) => {
    setChanges((current) => ({ ...current, [line.demandLineId]: { from: current[line.demandLineId]?.from ?? from, to, at: Date.now(), reason } }))
    if (submittingRef.current.has(line.demandLineId)) return
    pushBanner({
      tone: 'warn',
      lineId: line.demandLineId,
      title: to === 0 ? `البند ده اتغطّى: ${productName(line)}` : `الطلب اتحدّث: الكمية المطلوبة اتغيّرت من ${from} إلى ${to}`,
      body: to === 0 ? 'مش مطلوب منك فيه حاجة دلوقتي.' : `${productName(line)} — راجع ردك قبل التأكيد.`,
    })
  }, [pushBanner])

  const applySnapshot = React.useCallback((next: RfqSnapshot) => {
    const previous = snapRef.current
    if (previous) {
      for (const line of next.lines) {
        const old = previous.lines.find((l) => l.demandLineId === line.demandLineId)
        if (old && line.version > old.version && line.requestedQuantity !== old.requestedQuantity && line.state === 'actionable') {
          noteChange(line, old.requestedQuantity, line.requestedQuantity, 'SNAPSHOT')
        }
      }
    }
    snapRef.current = next
    setSnap(next)
    // A line that stopped being actionable can no longer carry a draft.
    setDrafts((current) => {
      const kept = Object.fromEntries(Object.entries(current).filter(([lineId]) => next.lines.find((l) => l.demandLineId === lineId)?.state === 'actionable'))
      return Object.keys(kept).length === Object.keys(current).length ? current : kept
    })
  }, [noteChange])

  const load = React.useCallback(async () => {
    if (!id) return
    try {
      applySnapshot(await api<RfqSnapshot>(`/rfq/${id}`))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error : new ApiError(String(error), 0))
    }
  }, [id, applySnapshot])

  const scheduleReload = React.useCallback(() => {
    window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => void load(), 150)
  }, [load])

  React.useEffect(() => () => window.clearTimeout(reloadTimer.current), [])

  const onMessage = React.useCallback((message: RfqStreamMessage) => {
    const data = message.data as Record<string, unknown>
    if (data.rfqId !== id) return
    const current = snapRef.current
    if (message.event === 'demand_changed' && current) {
      const line = current.lines.find((l) => l.demandLineId === data.demandLineId)
      const version = Number(data.version)
      if (line && version > line.version) {
        const to = Number(data.remainingQuantity)
        const updated: RfqLineView = {
          ...line,
          requestedQuantity: to,
          version,
          state: line.state === 'actionable' && to === 0 ? (data.reason === 'DEMAND_AWARDED' ? 'fulfilled_elsewhere' : 'withdrawn') : line.state,
        }
        if (line.state === 'actionable') noteChange(updated, Number(data.previousQuantity ?? line.requestedQuantity), to, String(data.reason))
        const next = { ...current, lines: current.lines.map((l) => (l.demandLineId === line.demandLineId ? updated : l)) }
        snapRef.current = next
        setSnap(next)
        if (to === 0) setDrafts((drafts) => Object.fromEntries(Object.entries(drafts).filter(([lineId]) => lineId !== line.demandLineId)))
      }
    } else if (message.event === 'allocation_accepted') {
      pushBanner({ tone: 'ok', title: 'اتأكّد التوزيع وصدر أمر شراء ملزم', body: 'هتلاقيه في طلبات شيناكير.' })
    } else if (message.event === 'recipient_timed_out') {
      pushBanner({ tone: 'danger', title: 'خلصت مهلة الرد على الطلب ده', body: 'الكميات اتعرضت على موردين تانيين. متجهّزش حاجة بناءً عليه.' })
    } else if (message.event === 'rfq_closed') {
      pushBanner({ tone: 'info', title: 'الطلب اتقفل' })
    } else if (message.event === 'rfq_issued' && data.expedited === true) {
      pushBanner({ tone: 'info', title: 'وصلك طلب توريد عاجل لكميات لسه ناقصة' })
    }
    scheduleReload()
  }, [id, noteChange, pushBanner, scheduleReload])

  const live = useRfqStream({ onMessage, onConnected: () => void load() })

  const lines = snap?.lines ?? []
  const actionable = lines.filter((l) => l.state === 'actionable')
  const reviewNeeded = actionable.filter((l) => needsReview(l, drafts[l.demandLineId]))
  const ready = actionable.filter((l) => drafts[l.demandLineId])
  const windowClosed = !!snap && (snap.rfq.status !== 'open' || snap.recipient.status !== 'pending' || Date.parse(snap.recipient.deadlineAt) <= Date.now())

  const clearLineNotices = (lineId: string) => setBanners((list) => list.filter((b) => b.lineId !== lineId))

  const choose = (line: RfqLineView, answer: Answer) => {
    clearLineNotices(line.demandLineId)
    setDrafts((current) => ({
      ...current,
      [line.demandLineId]: {
        answer,
        quantity: answer === 'PARTIAL' ? Math.max(1, Math.min(current[line.demandLineId]?.quantity || 1, line.requestedQuantity - 1)) : 0,
        ackVersion: line.version,
        seenQuantity: line.requestedQuantity,
      },
    }))
    setChanges((current) => without(current, line.demandLineId))
  }

  const review = (line: RfqLineView) => {
    clearLineNotices(line.demandLineId)
    setDrafts((current) => {
      const draft = current[line.demandLineId]
      if (!draft) return current
      const partialStillValid = draft.answer === 'PARTIAL' && line.requestedQuantity >= 2
      return {
        ...current,
        [line.demandLineId]: {
          answer: draft.answer === 'PARTIAL' && !partialStillValid ? 'FULL' : draft.answer,
          quantity: partialStillValid ? Math.min(Math.max(1, draft.quantity), line.requestedQuantity - 1) : 0,
          ackVersion: line.version,
          seenQuantity: line.requestedQuantity,
        },
      }
    })
    setChanges((current) => without(current, line.demandLineId))
  }

  const submit = useCommand(async () => {
    const body = ready.map((line) => {
      const draft = drafts[line.demandLineId]
      return {
        demandLineId: line.demandLineId,
        answer: draft.answer,
        basedOnVersion: draft.ackVersion,
        ...(draft.answer === 'PARTIAL' ? { quantity: draft.quantity } : {}),
        ...(draft.answer === 'UNAVAILABLE' ? {} : { seenQuantity: draft.seenQuantity }),
      }
    })
    const fingerprint = JSON.stringify(body)
    submittingRef.current = new Set(body.map((l) => l.demandLineId))
    // One key per submit intent: a retry of the same content replays instead of awarding twice.
    if (keyRef.current?.fingerprint !== fingerprint) keyRef.current = { fingerprint, key: newKey() }
    try {
      const response = await api<{ purchaseOrderId: string | null; lines: Array<{ awardedQuantity: number }> }>(`/rfq/${id}/responses`, {
        method: 'POST',
        body: { idempotencyKey: keyRef.current.key, lines: body },
      })
      keyRef.current = null
      setDrafts({})
      setBanners((list) => list.filter((b) => !b.lineId || !submittingRef.current.has(b.lineId)))
      setResult({ purchaseOrderId: response.purchaseOrderId, awarded: response.lines.reduce((s, l) => s + l.awardedQuantity, 0), lines: response.lines.length })
      await load()
      submittingRef.current = new Set()
      return response
    } catch (error) {
      submittingRef.current = new Set()
      if (error instanceof ApiError && error.code === 'STALE_DEMAND') {
        keyRef.current = null
        pushBanner({ tone: 'warn', title: 'الكميات اتغيّرت قبل ما يتأكد ردك', body: 'ما اتبعتش حاجة. راجع الكميات الجديدة وأكّد تاني.' })
        await load()
      }
      throw error
    }
  })

  return (
    <RoleShell role="supplier" active="rfq" mode="responsive">
      <div className="mx-auto max-w-3xl space-y-5 p-4 pb-40 sm:p-6 lg:p-8 lg:pb-24">
        <Link href="/supplier/rfq" className="inline-flex items-center gap-1.5 text-xs text-bw-ink-soft transition-colors hover:text-bw-ink">
          <ArrowRight className="size-4" aria-hidden />
          <span>كل طلبات التوريد</span>
        </Link>

        {loadError && !snap ? <LoadError message={loadError.message} onRetry={() => void load()} /> : null}
        {!snap && !loadError ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : null}

        {snap ? (
          <>
            <PageHeader
              eyebrow="طلب توريد — مش أمر شراء لسه"
              title={`طلب ${shortId(snap.rfq.id)}`}
              meta={
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden /> آخر موعد للرد {formatDateTime(snap.recipient.deadlineAt)}</span>
                  <span>{lines.length} صنف</span>
                </span>
              }
              actions={
                <>
                  {snap.rfq.expedited ? <StatusLabel tone="info"><Zap className="size-3" aria-hidden /> عاجل</StatusLabel> : null}
                  <StatusLabel tone={live === 'live' ? 'ok' : 'warn'}>{live === 'live' ? 'متصل لحظيًا' : 'بيعيد الاتصال… البيانات اللي قدامك ممكن تكون قديمة'}</StatusLabel>
                </>
              }
            />

            <div aria-live="polite" className="space-y-2" data-testid="rfq-notices">
              {banners.map((banner) => (
                <Notice
                  key={banner.key}
                  tone={banner.tone}
                  title={banner.title}
                  action={
                    <button type="button" aria-label="إخفاء التنبيه" className="grid size-8 place-items-center rounded-full hover:bg-bw-sunken" onClick={() => setBanners((list) => list.filter((b) => b.key !== banner.key))}>
                      <X className="size-4" aria-hidden />
                    </button>
                  }
                >
                  {banner.body}
                </Notice>
              ))}
            </div>

            {windowClosed ? (
              <Notice tone="danger" title={snap.rfq.status !== 'open' ? 'الطلب ده اتقفل' : 'مهلة الرد خلصت'}>
                متجهّزش أو تسلّم حاجة بناءً على الطلب ده. أي كمية اتأكدت قبل كده ليها أمر شراء في صفحة طلبات شيناكير.
              </Notice>
            ) : null}

            {result ? (
              <Notice
                tone="ok"
                title={result.awarded > 0 ? `اتأكد الرد: وُزّع عليك ${result.awarded} وحدة` : 'اتسجّل ردك'}
                action={result.purchaseOrderId ? <Link className="font-semibold underline" href={`/supplier/orders/${result.purchaseOrderId}`}>أمر الشراء</Link> : undefined}
              >
                {result.awarded > 0 ? 'صدر أمر شراء ملزم بالكميات اللي اتوزعت فعلًا. باقي البنود رجعت للموردين التانيين.' : 'مفيش كميات اتوزعت عليك.'}
              </Notice>
            ) : null}

            {lines.length === 0 ? <StateBlock kind="empty" title="مفيش أصناف في نطاقك في الطلب ده" /> : null}

            <ul className="space-y-3">
              {lines.map((line) => {
                const draft = drafts[line.demandLineId]
                const change = changes[line.demandLineId]
                const stale = needsReview(line, draft)
                const open = line.state === 'actionable' && !windowClosed
                return (
                  <li
                    key={line.demandLineId}
                    data-testid="rfq-line"
                    data-sku={line.skuId}
                    data-state={line.state}
                    data-version={line.version}
                    className={cn(
                      'seven-card space-y-3 p-4 transition-colors',
                      !open && 'opacity-70',
                      change && open && 'border-bw-warn/40 bg-bw-warn-soft',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold">{productName(line)}</p>
                        <p className="text-bw-small text-bw-ink-soft">
                          كود <Code>{line.sku?.skuCode ?? shortId(line.skuId)}</Code>
                          {line.sku?.barcode ? <> · باركود <Code>{line.sku.barcode}</Code></> : null}
                        </p>
                      </div>
                      <div className="shrink-0 text-center">
                        <p className="text-[11px] text-bw-ink-soft">المطلوب دلوقتي</p>
                        <p data-testid="rfq-requested" className={cn('text-2xl font-bold tabular-nums', change && open && 'text-bw-warn')}>{line.requestedQuantity}</p>
                        {line.requestedQuantity !== line.originalQuantity ? <p className="text-[11px] text-bw-ink-subtle">كان {line.originalQuantity}</p> : null}
                      </div>
                    </div>

                    {change && open ? (
                      <Notice tone="warn" title={`الكمية المطلوبة اتغيّرت من ${change.from} إلى ${change.to}`}>
                        {draft && stale ? 'راجع ردك قبل التأكيد — اختيارك القديم مش هيتبعت.' : 'الرقم اللي قدامك هو آخر رقم من الخادم.'}
                      </Notice>
                    ) : null}

                    {line.state === 'answered' && line.myAnswer ? (
                      <p className="flex items-center gap-2 text-bw-small">
                        <CheckCircle2 className="size-4 text-bw-ok" aria-hidden />
                        رديت: {ANSWER_LABEL[line.myAnswer.answer]}
                        {line.myAnswer.awardedQuantity > 0 ? ` — اتوزّع عليك ${line.myAnswer.awardedQuantity}` : ''}
                      </p>
                    ) : null}
                    {line.state === 'fulfilled_elsewhere' ? <StatusLabel tone="neutral">اتغطّى بالكامل — مش مطلوب منك</StatusLabel> : null}
                    {line.state === 'withdrawn' ? <StatusLabel tone="neutral">الطلب على الصنف ده اتسحب</StatusLabel> : null}
                    {line.state === 'closed' ? <StatusLabel tone="warn">خلصت مهلة الرد</StatusLabel> : null}

                    {open ? (
                      <div className="space-y-3">
                        <div role="group" aria-label={`رد على ${productName(line)}`} className="grid grid-cols-3 gap-2">
                          {(['FULL', 'PARTIAL', 'UNAVAILABLE'] as Answer[]).map((answer) => {
                            const disabled = answer === 'PARTIAL' && line.requestedQuantity < 2
                            const selected = draft?.answer === answer
                            return (
                              <button
                                key={answer}
                                type="button"
                                disabled={disabled}
                                aria-pressed={selected}
                                onClick={() => choose(line, answer)}
                                className={cn(
                                  'h-bw-touch rounded-bw-field border-[1.5px] px-2 text-bw-small font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                                  selected ? 'border-bw-action bg-bw-action/15 text-bw-ink' : 'border-bw-line-field/70 bg-bw-surface text-bw-ink-soft hover:bg-bw-sunken',
                                )}
                              >
                                {ANSWER_LABEL[answer]}
                              </button>
                            )
                          })}
                        </div>
                        {draft?.answer === 'PARTIAL' ? (
                          <div className="flex items-center gap-3">
                            <Stepper
                              label="الكمية اللي تقدر تغطّيها"
                              value={draft.quantity}
                              max={Math.max(1, line.requestedQuantity - 1)}
                              onChange={(quantity) => setDrafts((current) => ({ ...current, [line.demandLineId]: { ...draft, quantity: Math.max(1, quantity) } }))}
                            />
                            <span className="text-bw-small text-bw-ink-soft">من {line.requestedQuantity}</span>
                          </div>
                        ) : null}
                        {stale ? (
                          <Button variant="secondary" size="touch" className="w-full" onClick={() => review(line)}>
                            راجعت الكمية الجديدة ({line.requestedQuantity}) — كمّل
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>

            {snap.purchaseOrders.length ? (
              <section className="seven-card space-y-2 p-4" aria-label="أوامر الشراء الملزمة">
                <h2 className="font-bold">أوامر الشراء الملزمة من الطلب ده</h2>
                <ul className="space-y-1">
                  {snap.purchaseOrders.map((po) => (
                    <li key={po.id}>
                      <Link className="inline-flex items-center gap-2 text-bw-small underline" href={`/supplier/orders/${po.id}`}>
                        أمر شراء <Code>{shortId(po.id)}</Code>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {!windowClosed && actionable.length ? (
              <div className="sticky bottom-[4.5rem] z-10 -mx-4 space-y-2 border-t border-bw-line bg-bw-page p-4 lg:bottom-0 lg:mx-0 lg:rounded-bw-card lg:border">
                {reviewNeeded.length ? (
                  <p role="alert" className="text-bw-small text-bw-warn">
                    {reviewNeeded.length} بند كميته اتغيّرت — راجعه الأول عشان تقدر تأكّد.
                  </p>
                ) : null}
                <CommandError error={submit.error} />
                <Button
                  size="touch"
                  className="w-full"
                  loading={submit.pending}
                  disabled={!ready.length || reviewNeeded.length > 0 || live !== 'live'}
                  onClick={() => void submit.execute()}
                >
                  أكّد الرد على {ready.length} بند
                </Button>
                {live !== 'live' ? <p className="text-center text-[11px] text-bw-ink-subtle">لازم الاتصال اللحظي يشتغل عشان نضمن إن الكميات اللي قدامك حديثة.</p> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </RoleShell>
  )
}
