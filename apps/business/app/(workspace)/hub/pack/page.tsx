'use client'

import * as React from 'react'
import { Printer } from 'lucide-react'
import { Button, Code, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { HubShell, useHub } from '@/components/workspace/hub'
import { CommandError, Page, Status } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { SHIPMENT_STATUS } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import type { HubShipment } from '../prepare/page'

type PackShipment = HubShipment & { printEvents: string[] }

/**
 * Print + pack (W4). Two thermal outputs on the pharmacy's narrow receipt printer: the customer receipt
 * (inside the parcel) and the external shipping slip with the shipment barcode (taped/sleeved outside).
 * A browser preview is never treated as a print: the operator confirms the paper outcome.
 */
export default function HubPack() {
  return (
    <HubShell active="pack">
      <PackBody />
    </HubShell>
  )
}

function PackBody() {
  const hub = useHub()
  const { data, error, loading, reload } = useApi<{ total: number; items: PackShipment[] }>(`/fulfillment/locations/${hub.id}/shipments?status=prepared,ready_to_pack,packing&take=100`, { pollMs: 20000 })
  return (
    <Page>
      <PageHeader title="الطباعة والتغليف" meta="إيصال للعميل جوه الطرد + بوليصة شحن بالباركود برّه الطرد. إعادة الطباعة مابتغيّرش رقم الشحنة." />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
      {data && data.items.length === 0 ? <StateBlock kind="empty" title="مافيش طرود مستنية طباعة أو تغليف" /> : null}
      <div className="space-y-4">{data?.items.map((s) => <PackCard key={s.shipmentId} s={s} onChanged={reload} />)}</div>
    </Page>
  )
}

function PackCard({ s, onChanged }: { s: PackShipment; onChanged: () => void }) {
  const [barcode, setBarcode] = React.useState<string | null>(null)
  const label = useCommand(() => api<{ barcode: string }>(`/fulfillment/shipments/${s.shipmentId}/label`, { method: 'POST' }))
  const event = useCommand((type: string, notes?: string) => api(`/fulfillment/shipments/${s.shipmentId}/events`, { body: { type, ...(notes ? { notes } : {}) } }))
  const has = (type: string) => s.printEvents.includes(type)
  const record = async (type: string, notes?: string) => { if (await event.execute(type, notes)) onChanged() }
  const open = (doc: 'receipt' | 'slip') => window.open(`/print/${s.shipmentId}?doc=${doc}`, `print-${doc}-${s.shipmentId}`, 'width=420,height=760')

  return (
    <Section title={<span className="flex flex-wrap items-center gap-2">طلب <Code>{s.orderNumber ?? '—'}</Code> · <Code>{s.itemCount}</Code> قطعة <Status map={SHIPMENT_STATUS} value={s.status} /></span>}>
      <div className="space-y-3">
        <ol className="grid gap-3 md:grid-cols-3">
          <li className="space-y-2 rounded-bw-field border border-bw-line p-3">
            <p className="font-semibold">١. بيانات البوليصة</p>
            {has('LABEL_GENERATED') || barcode ? <StatusLabel tone="ok">اتعملت{barcode ? <> · <Code>{barcode}</Code></> : null}</StatusLabel> : null}
            <Button variant="secondary" loading={label.pending} onClick={async () => { const r = await label.execute(); if (r) { setBarcode(r.barcode); onChanged() } }}>
              {has('LABEL_GENERATED') ? 'إعادة توليد (نفس الباركود)' : 'توليد البوليصة'}
            </Button>
          </li>
          <li className="space-y-2 rounded-bw-field border border-bw-line p-3">
            <p className="font-semibold">٢. الطباعة على الطابعة الحرارية</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => open('receipt')}><Printer className="size-4" aria-hidden />إيصال العميل</Button>
              <Button variant="secondary" disabled={!has('LABEL_GENERATED') && !barcode} onClick={() => open('slip')}><Printer className="size-4" aria-hidden />بوليصة الشحن</Button>
            </div>
            <div className="flex flex-wrap gap-2 text-bw-small">
              {has('RECEIPT_PRINTED') ? <StatusLabel tone="ok">الإيصال اتطبع</StatusLabel> : <button type="button" className="underline" onClick={() => record('RECEIPT_PRINTED')}>الإيصال طلع سليم</button>}
              {has('LABEL_PRINTED') ? <StatusLabel tone="ok">البوليصة اتطبعت</StatusLabel> : <button type="button" className="underline" disabled={!has('LABEL_GENERATED')} onClick={() => record('LABEL_PRINTED')}>البوليصة طلعت سليمة</button>}
              <button type="button" className="text-bw-danger underline" onClick={() => record('PRINT_FAILED', window.prompt('إيه اللي حصل في الطباعة؟') ?? undefined)}>الطباعة فشلت</button>
            </div>
            {has('PRINT_FAILED') ? <StatusLabel tone="warn">اتسجّل فشل طباعة قبل كده — أعد الطباعة</StatusLabel> : null}
          </li>
          <li className="space-y-2 rounded-bw-field border border-bw-line p-3">
            <p className="font-semibold">٣. التغليف</p>
            <p className="text-bw-small text-bw-ink-soft">حط الإيصال جوه، والبوليصة برّه بشريط أو جراب.</p>
            <Button loading={event.pending} disabled={!has('LABEL_PRINTED') || !has('RECEIPT_PRINTED')} onClick={() => record('PACKED')}>اتغلّف — جاهز للتسليم</Button>
          </li>
        </ol>
        {!has('LABEL_PRINTED') || !has('RECEIPT_PRINTED') ? <Notice tone="neutral" title="التغليف بيتفتح بعد ما تأكد إن الورقتين طلعوا سليمين من الطابعة" /> : null}
        <CommandError error={label.error ?? event.error} />
      </div>
    </Section>
  )
}
