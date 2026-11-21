'use client'

import * as React from 'react'
import { Button, Field } from '@/components/bw/primitives'
import { CopyId } from '@/components/workspace/copy-id'
import { ParcelId } from './trip-ui'
import { CommandError } from '@/components/workspace/kit'
import { api } from '@/lib/api'
import { shortId } from '@/lib/labels'
import { useCommand } from '@/lib/use-api'

export interface ReturnParcel {
  shipmentId: string
  orderId: string
  orderNumber: string | null
  area: string | null
}

/**
 * A parcel the courier failed to deliver and still holds. The hub takes it back only by matching its printed label, so custody
 * is verified (never a bare "received" tap). One calm row; the scan field is the only input.
 */
export function ReturnScanRow({ parcel, onDone }: { parcel: ReturnParcel; onDone: () => void }) {
  const [barcode, setBarcode] = React.useState('')
  const [confirmFinal, setConfirmFinal] = React.useState(false)

  // A pending "final return" confirmation lapses on its own so a stray tap cannot linger.
  React.useEffect(() => {
    if (!confirmFinal) return
    const t = setTimeout(() => setConfirmFinal(false), 5000)
    return () => clearTimeout(t)
  }, [confirmFinal])

  const event = useCommand((type: 'RECEIVED_BACK' | 'RETURNED') =>
    api(`/fulfillment/shipments/${parcel.shipmentId}/events`, { body: { type, barcode: barcode.trim() } }),
  )

  const run = async (type: 'RECEIVED_BACK' | 'RETURNED') => {
    if (!barcode.trim()) return
    if (await event.execute(type)) {
      setBarcode('')
      setConfirmFinal(false)
      onDone()
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-bw-small">
        <div className="flex min-w-0 items-center gap-2">
          <CopyId value={parcel.orderNumber ?? parcel.orderId} display={parcel.orderNumber ?? shortId(parcel.orderId)} label="رقم الطلب" className="font-semibold text-bw-ink" />
          {parcel.area ? <span className="truncate text-bw-ink-soft">{parcel.area}</span> : null}
        </div>
        <ParcelId id={parcel.shipmentId} />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="امسح باركود الطرد"
          ltr
          autoComplete="off"
          placeholder="SHP-…"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          className="min-w-48 flex-1"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" loading={event.pending} disabled={!barcode.trim()} onClick={() => run('RECEIVED_BACK')}>
          استلام في المخزن
        </Button>
        <Button
          size="sm"
          variant={confirmFinal ? 'danger' : 'ghost'}
          loading={event.pending}
          disabled={!barcode.trim()}
          onClick={() => (confirmFinal ? run('RETURNED') : setConfirmFinal(true))}
        >
          {confirmFinal ? 'تأكيد الإرجاع النهائي' : 'إرجاع نهائي'}
        </Button>
        {confirmFinal ? <span className="text-[11px] text-bw-ink-subtle">يُغلق الطلب كمرتجع نهائيًا.</span> : null}
      </div>
      <CommandError error={event.error} />
    </li>
  )
}
