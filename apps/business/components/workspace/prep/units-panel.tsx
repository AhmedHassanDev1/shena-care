'use client'

import * as React from 'react'
import { Button, Field, Select as BwSelect } from '@/components/bw/primitives'
import { Flash } from '@/components/bw/ops'
import { api, newKey } from '@/lib/api'
import { useCommand } from '@/lib/use-api'
import { type DeskOrder, productTitle } from './model'

const CORRECTION_REASONS: Array<[string, string]> = [
  ['WRONG_UNIT_SCANNED', 'مسحت قطعة غلط'], ['DUPLICATE_SCAN', 'اتمسحت مرتين'], ['DAMAGED_ON_INSPECTION', 'لقيتها تالفة'],
  ['WRONG_ORDER', 'اتحسبت على طلب غلط'], ['OTHER', 'سبب تاني'],
]

/** Units already counted, each correctable with an audited compensating event until the parcel is printed or packed. Tucked away: it is the exception, not the flow. */
export function UnitsPanel({ order, hubId, onOrder, onChanged }: { order: DeskOrder; hubId: string; onOrder: (order: DeskOrder) => void; onChanged: () => void }) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('WRONG_UNIT_SCANNED')
  const [note, setNote] = React.useState('')
  const [done, setDone] = React.useState<string | null>(null)
  const key = React.useRef(newKey())
  const reverse = useCommand((receiptId: string) => api<{ order: DeskOrder | null }>(`/fulfillment/locations/${hubId}/desk/receipts/${receiptId}/reverse`, { body: { idempotencyKey: key.current, reason, note: note.trim() } }))
  const nameOf = (skuId: string) => { const line = order.lines.find((l) => l.skuId === skuId); return line ? productTitle(line) : 'منتج' }
  if (!order.units.length) return null
  return (
    <details className="rounded-bw-card border border-bw-line">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-bw-small font-semibold text-bw-ink-soft">مسحت قطعة غلط؟ صحّحها</summary>
      <div className="space-y-3 border-t border-bw-line p-4">
        {done ? <Flash tone="ok">{done}</Flash> : null}
        <ul className="divide-y divide-bw-line">
          {order.units.map((unit) => (
            <li key={unit.receiptId} className="space-y-2 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-bw-small">
                <span className="font-semibold text-bw-ink"><bdi>{nameOf(unit.skuId)}</bdi></span>
                {unit.correctable
                  ? <button type="button" className="ms-auto min-h-9 text-bw-small font-semibold text-bw-cobalt underline-offset-4 hover:underline" onClick={() => { setOpenId(openId === unit.receiptId ? null : unit.receiptId); key.current = newKey(); setDone(null) }}>تصحيح</button>
                  : <span className="ms-auto text-[12px] text-bw-ink-subtle">اتطبع أو اتغلّف — مايتصحّحش</span>}
              </div>
              {openId === unit.receiptId ? (
                <form className="space-y-3 rounded-bw-field border border-bw-line p-3" onSubmit={async (event) => {
                  event.preventDefault()
                  const result = await reverse.execute(unit.receiptId)
                  if (result) { if (result.order) onOrder(result.order); setOpenId(null); setNote(''); setDone('اتصحّحت القطعة: رجعت تتمسح من جديد، والتأكيد اتلغى لحد ما الطلب يكمل.'); onChanged() }
                }}>
                  <BwSelect label="السبب" value={reason} onChange={(event) => { setReason(event.target.value); key.current = newKey() }} options={CORRECTION_REASONS.map(([value, label]) => ({ value, label }))} />
                  <Field label="اشرح اللي حصل (٥ حروف على الأقل)" value={note} onChange={(event) => { setNote(event.target.value); key.current = newKey() }} />
                  {reverse.error ? <Flash tone="danger">{reverse.error.message}</Flash> : null}
                  <Button type="submit" variant="danger" loading={reverse.pending} disabled={note.trim().length < 5}>تأكيد التصحيح</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {order.corrections.length ? (
          <div>
            <p className="mb-1 text-[12px] font-semibold text-bw-ink-soft">سجل التصحيحات (مش بيتمسح)</p>
            <ul className="space-y-1 text-[12px] text-bw-ink-soft">
              {order.corrections.map((c) => <li key={c.receiptId}><bdi>{nameOf(c.skuId)}</bdi> — {CORRECTION_REASONS.find(([v]) => v === c.reason)?.[1] ?? c.reason}{c.note ? <> · <bdi>{c.note}</bdi></> : null}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  )
}
