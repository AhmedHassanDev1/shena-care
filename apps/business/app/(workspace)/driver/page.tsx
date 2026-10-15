'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Code, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Egp, Status } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { RUN_STATUS, SHIPMENT_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { useApi } from '@/lib/use-api'

export interface DriverStop {
  sequence: number; shipmentId: string; status: string; attemptStatus: string; handedOver: boolean
  orderNumber: string; recipientName: string; recipientPhone: string; governorate: string | null; area: string | null
  address: string; deliveryNotes: string | null
  location: { latitude: number; longitude: number; source: string | null; navigationUrl: string } | null
  operatorInstruction: { note: string; reason: string; latitude: number | null; longitude: number | null } | null
  codDue: number; cashDeclared: number | null; currency: string; itemCount: number
}
export interface DriverRun { id: string; status: string; dispatchedAt: string | null; stops: DriverStop[] }

/** The driver's assigned runs only (API-scoped to this account). */
export default function DriverRoute() {
  const { data, error, loading, reload } = useApi<DriverRun[]>('/fulfillment/driver/runs', { pollMs: 20000 })
  const open = data?.flatMap((r) => r.stops).filter((s) => s.attemptStatus === 'active').length

  return (
    <RoleShell role="driver" active="run" mode="mobile" counts={{ run: open }}>
      <div className="space-y-4 p-4">
        <PageHeader title="مشواري" />
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
        {data && data.length === 0 ? <StateBlock kind="empty" title="مافيش مشوار متعيّن ليك دلوقتي" /> : null}
        {data?.map((run) => (
          <section key={run.id} className="space-y-2">
            <p className="flex flex-wrap items-center gap-2 text-bw-small">
              مشوار <Code>{shortId(run.id)}</Code> <Status map={RUN_STATUS} value={run.status} />
              {run.dispatchedAt ? <span className="text-bw-ink-soft">خرج {formatDateTime(run.dispatchedAt)}</span> : <span className="text-bw-warn">امسح بوليصة كل طرد وانت بتستلمه من المخزن</span>}
            </p>
            <ul className="space-y-2">
              {run.stops.map((s) => (
                <li key={s.shipmentId}>
                  <Link href={`/driver/stop/${s.shipmentId}`} className="flex items-center gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-bw-sunken font-semibold"><Code>{s.sequence}</Code></span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-semibold">{s.recipientName} · {s.area ?? ''}</p>
                      <p className="flex flex-wrap items-center gap-2 text-bw-small">
                        <Code>{s.orderNumber}</Code> · تحصيل <Egp value={s.codDue} />
                      </p>
                      <p className="flex flex-wrap gap-2">
                        {s.attemptStatus === 'active' && s.status !== 'failed' ? (
                          s.handedOver ? <StatusLabel tone="ok">في عهدتك</StatusLabel> : <StatusLabel tone="pending">لسه ماستلمتهوش</StatusLabel>
                        ) : <Status map={SHIPMENT_STATUS} value={s.status} />}
                      </p>
                    </div>
                    <ChevronLeft className="size-5 text-bw-ink-soft" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </RoleShell>
  )
}
