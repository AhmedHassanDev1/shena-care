'use client'

import * as React from 'react'
import { Wallet } from 'lucide-react'
import { Button, StateBlock } from '@/components/bw/primitives'
import { Egp } from '@/components/workspace/kit'
import { RUN_BLOCKER, RUN_SETTLEMENT_STATE } from '@/lib/labels'
import { tripCounts, type Run } from '@/lib/trip-ops'
import { Fact, OutcomeBar, TripCardShell, TripHeading } from './trip-ui'
import type { SettleTarget } from './settlement-dialog'

/** One thing waiting at the cashier's desk: a trip that is back, or declared cash that belongs to no trip listed here. */
export interface SettleItem {
  id: string
  courierId: string
  courierName: string
  run?: Run
  /** Declared cash outside any listed trip. */
  looseCash?: { orders: string[]; expected: number; declared: number }
}

/* التسوية: trips that came back. Money and returned parcels are reconciled here, nowhere else. */

export function SettleTab({
  items,
  sequence,
  onOpen,
}: {
  items: SettleItem[]
  sequence: Map<string, { n: number; of: number }>
  onOpen: (target: SettleTarget) => void
}) {
  if (items.length === 0) {
    return <StateBlock kind="empty" title="لا توجد مشاوير بانتظار التسوية" body="تظهر هنا المشاوير التي عاد مندوبها بنقدية أو مرتجعات." />
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((item) => (
        <SettleCard key={item.id} item={item} sequence={item.run ? sequence.get(item.run.id) : undefined} onOpen={onOpen} />
      ))}
    </div>
  )
}

function SettleCard({
  item,
  sequence,
  onOpen,
}: {
  item: SettleItem
  sequence?: { n: number; of: number }
  onOpen: (target: SettleTarget) => void
}) {
  const { run, looseCash } = item
  const s = run?.settlement
  const counts = run ? tripCounts(run) : null
  const state = s?.state ?? 'pending'
  const [stateLabel] = RUN_SETTLEMENT_STATE[state] ?? [state]
  const readyToClose = state === 'settled'

  // Exceptions stay visible on the card itself: they are never tucked away.
  const alerts: Array<{ text: string; tone: 'danger' | 'warn' }> = []
  for (const b of s?.blockers ?? []) {
    const text = (RUN_BLOCKER[b.code] ?? (() => b.code))(b.count)
    if (b.code === 'PENDING_RETURNS' || b.code === 'CASH_DISPUTED') alerts.push({ text, tone: 'danger' })
    else if (b.code === 'CASH_UNDECLARED' || b.code === 'NO_STOPS' || b.code === 'NO_OUTCOMES') alerts.push({ text, tone: 'warn' })
  }
  if (s?.cash.variance) {
    alerts.push({ text: `${s.cash.variance < 0 ? 'عجز' : 'زيادة'} مسجّل ${Math.abs(s.cash.variance).toLocaleString('en-US')} ج.م — للمراجعة الإدارية`, tone: 'warn' })
  }

  const openTarget: SettleTarget = {
    courierId: item.courierId,
    courierName: item.courierName,
    runId: run?.id,
    orderIds: looseCash?.orders,
  }

  return (
    <TripCardShell attention={alerts.some((a) => a.tone === 'danger')}>
      <div className="space-y-3">
        {run ? (
          <TripHeading
            courier={item.courierName}
            run={run}
            sequence={sequence}
            trailing={<span className={readyToClose ? 'font-semibold text-bw-emerald' : 'text-bw-ink-soft'}>{readyToClose ? 'جاهز للإغلاق' : stateLabel}</span>}
          />
        ) : (
          <div>
            <h3 className="text-bw-body font-semibold text-bw-ink">{item.courierName}</h3>
            <p className="text-[11px] text-bw-ink-subtle">نقدية خارج المشاوير المعروضة</p>
          </div>
        )}

        {counts ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Fact value={counts.total} label="طلب" strong />
              <Fact value={counts.delivered} label="تم التسليم" tone={counts.delivered > 0 ? 'ok' : undefined} />
              <Fact value={counts.failed} label="مرتجع" tone={counts.failed > 0 ? 'danger' : undefined} />
            </div>
            <OutcomeBar delivered={counts.delivered} failed={counts.failed} total={counts.total} />
          </div>
        ) : null}

        {/* Money is the headline of this tab. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-bw-line pt-3">
          {s ? (
            s.cash.codOrders > 0 ? (
              <>
                <span className="text-bw-small text-bw-ink-soft">
                  المتوقع <Egp value={s.cash.expectedTotal} className="text-bw-heading font-semibold text-bw-ink" />
                </span>
                <span className="text-[11px] text-bw-ink-subtle">
                  {s.cash.awaitingCount > 0 ? `${s.cash.awaitingCount} طلب بانتظار الاستلام` : s.cash.counted === s.cash.codOrders ? 'تم استلام النقدية' : 'التحصيل لم يُعلن بعد'}
                </span>
              </>
            ) : (
              <span className="text-bw-small text-bw-ink-soft">بدون تحصيل نقدي</span>
            )
          ) : looseCash ? (
            <>
              <span className="text-bw-small text-bw-ink-soft">
                المتوقع <Egp value={looseCash.expected} className="text-bw-heading font-semibold text-bw-ink" />
              </span>
              <span className="text-[11px] text-bw-ink-subtle">{looseCash.orders.length} طلب</span>
            </>
          ) : null}
        </div>

        {alerts.length > 0 ? (
          <ul className="space-y-0.5">
            {alerts.map((a) => (
              <li key={a.text} className={a.tone === 'danger' ? 'text-bw-small text-bw-danger' : 'text-bw-small text-bw-warn'}>
                {a.text}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex justify-end">
          <Button size="sm" variant={readyToClose || (s?.cash.awaitingCount ?? looseCash?.orders.length ?? 0) > 0 ? 'primary' : 'secondary'} onClick={() => onOpen(openTarget)}>
            <Wallet className="size-4" aria-hidden />
            {readyToClose ? 'إغلاق المشوار' : 'تسوية المشوار'}
          </Button>
        </div>
      </div>
    </TripCardShell>
  )
}
