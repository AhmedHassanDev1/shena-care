'use client'

import { Code, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Egp } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { FAILURE_REASONS, formatDateTime } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

interface HistoryItem { stopId: string; outcome: string; closedAt: string | null; orderNumber: string | null; area: string | null; reasonCode: string | null; cashDeclared: number | null }

/** The driver's own closed attempts (no customer contact details kept here). */
export default function DriverHistory() {
  const { data, error, loading, reload } = useApi<{ total: number; items: HistoryItem[] }>('/fulfillment/driver/history?take=50')
  return (
    <RoleShell role="driver" active="history" mode="mobile">
      <div className="space-y-4 p-4">
        <PageHeader title="السجل" />
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-32 w-full" /> : null}
        {data && data.items.length === 0 ? <StateBlock kind="empty" title="لسه مافيش محاولات مقفولة" /> : null}
        <ul className="space-y-2">
          {data?.items.map((h) => (
            <li key={h.stopId} className="space-y-1 rounded-bw-card border border-bw-line bg-bw-surface p-3">
              <p className="flex flex-wrap items-center gap-2">
                <Code>{h.orderNumber ?? '—'}</Code>
                <StatusLabel tone={h.outcome === 'delivered' ? 'ok' : 'danger'}>{h.outcome === 'delivered' ? 'اتسلّم' : h.outcome === 'failed' ? 'فشلت' : 'رجع'}</StatusLabel>
              </p>
              <p className="text-bw-small text-bw-ink-soft">
                {h.area ?? ''} · {formatDateTime(h.closedAt)}
                {h.reasonCode ? <> · {FAILURE_REASONS[h.reasonCode] ?? h.reasonCode}</> : null}
                {h.cashDeclared !== null ? <> · أعلنت <Egp value={h.cashDeclared} /></> : null}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </RoleShell>
  )
}
