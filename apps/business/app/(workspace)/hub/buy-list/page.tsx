'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft, RefreshCw, Scissors } from 'lucide-react'
import { Button, Code, Notice, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Meter, Segmented } from '@/components/bw/ops'
import { PendingCosts, type PendingCost } from '@/components/workspace/buy-costs'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, newKey } from '@/lib/api'
import { formatDateTime } from '@/lib/labels'
import { ACTION_LABEL, STATUS_LABEL, type BatchOverview, type BatchSummary } from '@/lib/purchase-batch'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

/**
 * Internal Buy List as scheduled purchase batches. At every cutoff the demand no batch holds yet is cut into one numbered batch; staff
 * order it outside the system, mark it sent and record what physically arrived. Nothing here contacts a supplier.
 */
export default function BuyListPage() {
  return (
    <RoleShell role="hub" active="buy-list" mode="desktop">
      <BatchListBody />
    </RoleShell>
  )
}

type View = 'active' | 'closed'

function BatchListBody() {
  const [view, setView] = React.useState<View>('active')
  const { data, error, loading, reload } = useApi<BatchOverview>(`/purchase-batches?status=${view}`, { pollMs: 30000 })
  const pendingCosts = useApi<{ pending: number; items: PendingCost[] }>('/buy-list/costs?pending=true&take=50', { pollMs: 30000 })
  // One key per intended early cut: a retry after a lost response replays instead of cutting twice.
  const cutKey = React.useRef(newKey())
  const cut = useCommand(() => api<{ batchId: string | null; number: number | null; empty?: boolean }>('/purchase-batches/cut', { body: { idempotencyKey: cutKey.current } }))
  const [cutNote, setCutNote] = React.useState<string | null>(null)

  const cutNow = async () => {
    setCutNote(null)
    const result = await cut.execute()
    if (!result) return
    cutKey.current = newKey()
    setCutNote(result.batchId ? `اتقفلت دفعة #${result.number}` : 'مفيش طلبات مستنية دلوقتي')
    reload()
  }

  const pending = data?.pending
  return (
    <Page>
      <PageHeader
        title="قائمة المشتريات"
        meta="الطلبات المؤكدة بتتجمّع في دفعات مرقّمة. اطلب الدفعة من برّه النظام، وسجّل اللي وصل فعلًا."
        actions={<Button variant="secondary" size="sm" onClick={reload} loading={loading && !!data}>{!(loading && !!data) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>}
      />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}

      {!data && loading ? <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : null}

      {data && data.mode !== 'INTERNAL_BUY_LIST' ? (
        <Notice tone="warn" title="قائمة المشتريات الداخلية مش مفعّلة">وضع التوريد الحالي مش «شراء داخلي». غيّره من الإعدادات ← العمليات لو ده المطلوب.</Notice>
      ) : null}

      {data ? (
        <>
          {/* What is waiting for the next cutoff, and the early-cut control: one slim strip, not a card per fact. */}
          <section aria-label="الدفعة الجاية" className="bw-panel flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-bw-small text-bw-ink-soft">مستني الدفعة الجاية</p>
              <p className="mt-0.5 text-bw-body font-semibold text-bw-ink">
                {pending && pending.units > 0
                  ? <><Code>{pending.units}</Code> قطعة · <Code>{pending.skus}</Code> صنف · <Code>{pending.orders}</Code> طلب</>
                  : 'مفيش طلبات مستنية'}
              </p>
            </div>
            <div className="text-bw-small text-bw-ink-soft">
              القفل الجاي <strong className="font-semibold text-bw-ink">{formatDateTime(data.schedule.nextCutoffAt)}</strong>
              <span className="mx-1.5 text-bw-ink-subtle">·</span>
              كل <Code>{data.schedule.settings.intervalMinutes}</Code> دقيقة
            </div>
            <Button variant="secondary" size="sm" onClick={cutNow} loading={cut.pending} disabled={!pending || pending.units === 0}>
              <Scissors className="size-4" aria-hidden />اقفل دفعة دلوقتي
            </Button>
            {cutNote ? <p role="status" className="basis-full text-bw-small text-bw-ink-soft">{cutNote}</p> : null}
            {cut.error ? <div className="basis-full"><CommandError error={cut.error} /></div> : null}
          </section>

          {pendingCosts.data && pendingCosts.data.items.length > 0 ? <PendingCosts items={pendingCosts.data.items} onSaved={() => { pendingCosts.reload(); reload() }} /> : null}

          <Segmented label="عرض الدفعات" value={view} onChange={setView} items={[
            { value: 'active', label: 'شغّالة' },
            { value: 'closed', label: 'مقفولة' },
          ]} />

          {data.items.length === 0 ? (
            <div className="bw-panel">
              <StateBlock kind="empty" title={view === 'active' ? 'مفيش دفعات شغّالة' : 'مفيش دفعات مقفولة لسه'}
                body={view === 'active' ? 'الطلبات الجديدة (دفع عند الاستلام) بتتجمّع هنا في الدفعة الجاية.' : undefined} />
            </div>
          ) : (
            <ul className="bw-panel divide-y divide-bw-line overflow-hidden" aria-label="الدفعات">
              {data.items.map((batch) => <BatchRow key={batch.id} batch={batch} />)}
            </ul>
          )}
        </>
      ) : null}
    </Page>
  )
}

function BatchRow({ batch }: { batch: BatchSummary }) {
  const tone = batch.status === 'closed' ? (batch.closeReason === 'cancelled' ? 'neutral' : 'ok') : batch.status === 'sent' ? 'info' : 'warn'
  return (
    <li>
      <Link href={`/hub/buy-list/${batch.id}`} className="bw-row grid items-center gap-x-5 gap-y-2 px-4 py-3.5 md:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_9rem_auto]">
        <span className="text-[1.25rem] font-semibold leading-none text-bw-ink"><Code>#{batch.number}</Code></span>
        <span className="min-w-0 text-bw-small text-bw-ink-soft">
          <span className="block text-bw-ink">{formatDateTime(batch.cutoffAt)}</span>
          <span className="block"><Code>{batch.skus}</Code> صنف · <Code>{batch.units}</Code> قطعة{batch.kind === 'manual' ? ' · قفل يدوي' : ''}</span>
        </span>
        <span className="min-w-0 text-bw-small text-bw-ink-soft">
          <span className="flex items-center gap-2">
            <StatusLabel tone={tone}>{STATUS_LABEL[batch.status]}</StatusLabel>
          </span>
          <span className="mt-0.5 block">
            {batch.expectedAt && batch.status !== 'closed' ? <>وصول متوقع {formatDateTime(batch.expectedAt)}</> : batch.status === 'closed' ? (batch.closeReason === 'cancelled' ? 'اتلغت طلباتها' : 'اتستلمت') : 'لسه مااتطلبتش'}
          </span>
        </span>
        <span className="text-[12px] text-bw-ink-subtle">
          <Meter value={batch.received} max={batch.units} tone={batch.remaining === 0 ? 'emerald' : 'cobalt'} label={`اتستلم ${batch.received} من ${batch.units}`} />
          <span className="mt-1 block">اتستلم <Code>{batch.received}/{batch.units}</Code></span>
        </span>
        <span className={cn('inline-flex h-9 items-center gap-1.5 justify-self-start rounded-bw-field px-3 text-bw-small font-semibold md:justify-self-end',
          batch.nextAction ? 'bg-bw-action text-bw-on-action' : 'text-bw-ink-soft')}>
          {batch.nextAction ? ACTION_LABEL[batch.nextAction] : 'عرض'}
          <ChevronLeft className="size-4" aria-hidden />
        </span>
      </Link>
    </li>
  )
}
