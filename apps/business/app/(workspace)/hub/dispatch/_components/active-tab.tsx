'use client'

import * as React from 'react'
import { StateBlock } from '@/components/bw/primitives'
import { Egp } from '@/components/workspace/kit'
import { SHIPMENT_STATUS, formatDateTime, shortId } from '@/lib/labels'
import { tripCounts, type Run, type RunDetail } from '@/lib/trip-ops'
import { useApi } from '@/lib/use-api'
import { Disclosure, Fact, OrderLine, OutcomeBar, StateText, TripCardShell, TripHeading } from './trip-ui'

/* جاري التوصيل: trips on the road. Monitoring only, nothing to press; the numbers come from the server's settlement block. */

export function ActiveTab({
  runs,
  courierName,
  sequence,
}: {
  runs: Run[]
  courierName: Map<string, string>
  sequence: Map<string, { n: number; of: number }>
}) {
  if (runs.length === 0) {
    return <StateBlock kind="empty" title="لا توجد مشاوير في الطريق" body="المشاوير التي خرجت للتوصيل تظهر هنا مع نتيجة كل طلب." />
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {runs.map((run) => (
        <ActiveTripCard
          key={run.id}
          run={run}
          courier={run.driverId ? courierName.get(run.driverId) ?? shortId(run.driverId) : 'بدون مندوب'}
          sequence={sequence.get(run.id)}
        />
      ))}
    </div>
  )
}

function ActiveTripCard({ run, courier, sequence }: { run: Run; courier: string; sequence?: { n: number; of: number } }) {
  const [open, setOpen] = React.useState(false)
  // Order-level rows load only when the card is opened; the headline needs no per-card request.
  const detail = useApi<RunDetail>(open ? `/fulfillment/delivery-batches/${run.id}` : null, { pollMs: 10000 })
  const counts = tripCounts(run)
  const hasFailures = counts.failed > 0

  return (
    <TripCardShell attention={hasFailures}>
      <div className="space-y-3">
        <TripHeading
          courier={courier}
          run={run}
          sequence={sequence}
          trailing={
            <span className="inline-flex items-center gap-1.5 text-bw-ink-soft">
              <span className="size-1.5 rounded-full bg-bw-emerald" aria-hidden />
              في الطريق
            </span>
          }
        />

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Fact value={counts.total} label="طلب" strong />
            <Fact value={counts.delivered} label="تم التسليم" tone={counts.delivered > 0 ? 'ok' : undefined} />
            <Fact value={counts.failed} label="تعذّر" tone={counts.failed > 0 ? 'danger' : undefined} />
            <Fact value={counts.remaining} label="متبقٍ" />
            {run.cod && run.cod.orders > 0 ? (
              <span className="ms-auto inline-flex items-baseline gap-1.5 text-bw-small text-bw-ink-soft">
                تحصيل متوقع <Egp value={run.cod.expectedTotal} className="text-bw-body font-semibold text-bw-ink" />
              </span>
            ) : null}
          </div>
          <OutcomeBar delivered={counts.delivered} failed={counts.failed} total={counts.total} />
        </div>

        {hasFailures ? (
          <p className="text-bw-small text-bw-danger">
            {counts.failed} طلب تعذّر توصيله — سيظهر الطرد للتسوية بعد عودة المندوب.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Disclosure label="الطلبات" open={open} onToggle={() => setOpen((v) => !v)}>
            {!detail.data && !detail.error ? (
              <p className="text-bw-small text-bw-ink-subtle">جارٍ التحميل…</p>
            ) : detail.error ? (
              <p className="text-bw-small text-bw-danger">تعذّر تحميل الطلبات — {detail.error.message}</p>
            ) : (
              <ul className="divide-y divide-bw-line/70">
                {(detail.data?.stops ?? []).map((s) => (
                  <OrderLine
                    key={s.shipmentId}
                    orderNumber={s.orderNumber}
                    fallbackId={s.shipmentId}
                    area={s.area}
                    parcelId={s.shipmentId}
                    meta={<StateText map={SHIPMENT_STATUS} value={s.shipmentStatus} />}
                  />
                ))}
              </ul>
            )}
          </Disclosure>
          <span className="text-[11px] text-bw-ink-subtle">خرج {formatDateTime(run.dispatchedAt)}</span>
        </div>
      </div>
    </TripCardShell>
  )
}
