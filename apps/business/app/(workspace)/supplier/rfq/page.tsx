'use client'

import Link from 'next/link'
import { ChevronLeft, Clock, Zap } from 'lucide-react'
import { Button, Code, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { formatDateTime, shortId } from '@/lib/labels'
import { type RfqListItem, useRfqStream } from '@/lib/rfq-live'
import { useApi } from '@/lib/use-api'

function stateOf(item: RfqListItem): { tone: 'ok' | 'warn' | 'neutral' | 'danger'; text: string } {
  if (item.status !== 'open') {
    return item.status === 'fulfilled' ? { tone: 'ok', text: 'اتغطّى بالكامل' } : { tone: 'neutral', text: 'اتقفل' }
  }
  if (item.recipientStatus === 'timed_out' || Date.parse(item.deadlineAt) <= Date.now()) return { tone: 'danger', text: 'خلصت مهلة الرد' }
  if (item.recipientStatus === 'responded') return { tone: 'ok', text: 'رديت على كل البنود' }
  return { tone: 'warn', text: item.actionableLineCount > 0 ? `${item.actionableLineCount} بند مستني ردك` : 'مفيش بنود مطلوبة منك دلوقتي' }
}

export default function SupplierRfqListPage() {
  const { data, error, loading, reload } = useApi<RfqListItem[]>('/rfq/mine', { pollMs: 30000 })
  const live = useRfqStream({
    onMessage: (message) => {
      if (['rfq_issued', 'demand_changed', 'rfq_closed', 'recipient_timed_out'].includes(message.event)) reload()
    },
    onConnected: reload,
  })

  return (
    <RoleShell role="supplier" active="rfq" mode="responsive">
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
        <PageHeader
          eyebrow="بوابة المورد"
          title="طلبات التوريد المفتوحة"
          meta="شيناكير بتبعت لكل الموردين المعتمدين نفس القائمة. اللي تقدر تغطّيه بتأكّده، واللي مش متاح بتعلّمه مش متاح."
          actions={<StatusLabel tone={live === 'live' ? 'ok' : 'warn'}>{live === 'live' ? 'متصل لحظيًا' : 'بيعيد الاتصال…'}</StatusLabel>}
        />

        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ) : null}

        {data && data.length === 0 ? (
          <StateBlock kind="empty" title="مفيش طلبات توريد دلوقتي" body="أول ما شيناكير تبعت قائمة جديدة هتظهر هنا لوحدها." />
        ) : null}

        <ul className="space-y-3">
          {data?.map((item) => {
            const state = stateOf(item)
            return (
              <li key={item.rfqId}>
                <Link
                  href={`/supplier/rfq/${item.rfqId}`}
                  className="seven-card flex items-center gap-3 p-4 transition-colors hover:bg-white/[0.03]"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">طلب <Code>{shortId(item.rfqId)}</Code></span>
                      <StatusLabel tone={state.tone}>{state.text}</StatusLabel>
                      {item.expedited ? <StatusLabel tone="info"><Zap className="size-3" aria-hidden /> عاجل</StatusLabel> : null}
                    </div>
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-bw-small text-bw-ink-soft">
                      <span>{item.lineCount} صنف</span>
                      <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden /> آخر موعد للرد {formatDateTime(item.deadlineAt)}</span>
                    </p>
                  </div>
                  <ChevronLeft className="size-5 shrink-0 text-bw-ink-subtle" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
        <div>
          <Button variant="ghost" onClick={reload}>تحديث القائمة</Button>
        </div>
      </div>
    </RoleShell>
  )
}
