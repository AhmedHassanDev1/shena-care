'use client'

import * as React from 'react'
import { Check, Printer } from 'lucide-react'
import { Button, Code, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { HubShell, useHub } from '@/components/workspace/hub'
import { CommandError, Page, Status } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { SHIPMENT_STATUS } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import type { HubShipment } from '../prepare/page'

type PackShipment = HubShipment & { printEvents: string[] }
type PackagingCosts = { BAG: number | null; BOX: number | null }
const PACKAGING_LABEL = { BAG: 'شنطة', BOX: 'كرتونة' } as const

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
  const costs = useApi<{ packagingCosts: PackagingCosts }>('/order-costs/pending?take=1')
  return (
    <Page>
      <PageHeader title="الطباعة والتغليف" meta="إيصال للعميل جوه الطرد + بوليصة شحن بالباركود برّه الطرد. إعادة الطباعة مابتغيّرش رقم الشحنة." />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
      {data && data.items.length === 0 ? <div className="bw-panel"><StateBlock kind="empty" title="مافيش طرود مستنية طباعة أو تغليف" /></div> : null}
      <div className="space-y-3">{data?.items.map((s) => <PackCard key={s.shipmentId} s={s} onChanged={reload} packagingCosts={costs.data?.packagingCosts ?? null} />)}</div>
    </Page>
  )
}

function PackCard({ s, onChanged, packagingCosts }: { s: PackShipment; onChanged: () => void; packagingCosts: PackagingCosts | null }) {
  const recorded = useApi<{ packagingType: 'BAG' | 'BOX' | null }>(`/order-costs/${s.orderId}`)
  const choose = useCommand((type: 'BAG' | 'BOX') => api(`/order-costs/${s.orderId}`, { method: 'PUT', body: { packagingType: type } }))
  const packagingType = recorded.data?.packagingType ?? null
  const [barcode, setBarcode] = React.useState<string | null>(null)
  const label = useCommand(() => api<{ barcode: string }>(`/fulfillment/shipments/${s.shipmentId}/label`, { method: 'POST' }))
  const event = useCommand((type: string, notes?: string) => api(`/fulfillment/shipments/${s.shipmentId}/events`, { body: { type, ...(notes ? { notes } : {}) } }))
  const has = (type: string) => s.printEvents.includes(type)
  const record = async (type: string, notes?: string) => { if (await event.execute(type, notes)) onChanged() }
  const open = (doc: 'receipt' | 'slip') => window.open(`/print/${s.shipmentId}?doc=${doc}`, `print-${doc}-${s.shipmentId}`, 'width=420,height=760')

  const labelDone = has('LABEL_GENERATED') || !!barcode
  const printed = has('LABEL_PRINTED') && has('RECEIPT_PRINTED')

  return (
    <section className="bw-panel bw-arrive overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-bw-line px-4 py-3">
        <h2 className="text-bw-body font-semibold text-bw-ink">طلب <Code>{(s.orderNumber ?? '—').replace(/^ORD-/, '#')}</Code></h2>
        <span className="text-bw-small text-bw-ink-soft"><Code>{s.itemCount}</Code> قطعة</span>
        <Status map={SHIPMENT_STATUS} value={s.status} />
        {has('PRINT_FAILED') ? <StatusLabel tone="warn">فشل طباعة سابق — أعد الطباعة</StatusLabel> : null}
      </div>
      <ol className="grid md:grid-cols-3 md:[&>li:not(:first-child)]:border-s md:[&>li]:border-bw-line [&>li:not(:first-child)]:border-t md:[&>li:not(:first-child)]:border-t-0 [&>li]:border-bw-line">
        <Step n={1} done={labelDone} title="بيانات البوليصة">
          {labelDone ? <p className="text-[12px] text-bw-emerald">اتعملت{barcode ? <> · <Code>{barcode}</Code></> : null}</p> : null}
          <Button variant="secondary" size="sm" loading={label.pending} onClick={async () => { const r = await label.execute(); if (r) { setBarcode(r.barcode); onChanged() } }}>
            {has('LABEL_GENERATED') ? 'إعادة توليد (نفس الباركود)' : 'توليد البوليصة'}
          </Button>
        </Step>
        <Step n={2} done={printed} title="الطباعة على الطابعة الحرارية">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => open('receipt')}><Printer className="size-4" aria-hidden />إيصال العميل</Button>
            <Button variant="secondary" size="sm" disabled={!labelDone} onClick={() => open('slip')}><Printer className="size-4" aria-hidden />بوليصة الشحن</Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            {has('RECEIPT_PRINTED') ? <span className="inline-flex items-center gap-1 text-bw-emerald"><Check className="size-3.5" aria-hidden />الإيصال اتطبع</span> : <button type="button" className="font-semibold text-bw-cobalt underline-offset-4 hover:underline" onClick={() => record('RECEIPT_PRINTED')}>الإيصال طلع سليم</button>}
            {has('LABEL_PRINTED') ? <span className="inline-flex items-center gap-1 text-bw-emerald"><Check className="size-3.5" aria-hidden />البوليصة اتطبعت</span> : <button type="button" className="font-semibold text-bw-cobalt underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-bw-ink-subtle disabled:no-underline" disabled={!has('LABEL_GENERATED')} onClick={() => record('LABEL_PRINTED')}>البوليصة طلعت سليمة</button>}
            <button type="button" className="text-bw-danger underline-offset-4 hover:underline" onClick={() => record('PRINT_FAILED', window.prompt('إيه اللي حصل في الطباعة؟') ?? undefined)}>الطباعة فشلت</button>
          </div>
        </Step>
        <Step n={3} done={s.status === 'packed'} title="التغليف">
          <p className="text-[12px] text-bw-ink-soft">حط الإيصال جوه، والبوليصة برّه بشريط أو جراب.</p>
          <div role="group" aria-label="نوع التغليف المستخدم" className="flex gap-2">
            {(['BAG', 'BOX'] as const).map((type) => {
              const cost = packagingCosts?.[type] ?? null
              return (
                <button
                  key={type} type="button" aria-pressed={packagingType === type} disabled={choose.pending || cost === null || (!!packagingType && packagingType !== type && !recorded.error)}
                  onClick={async () => { if (await choose.execute(type)) recorded.reload() }}
                  className={cn('inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-bw-field border px-2 text-bw-small transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    packagingType === type ? 'border-bw-cobalt/60 bg-bw-cobalt-soft font-semibold text-bw-ink' : 'border-bw-line-field text-bw-ink-soft hover:border-bw-ink-subtle hover:text-bw-ink')}
                >
                  {PACKAGING_LABEL[type]}{cost !== null ? <span className="text-[11px] tabular-nums text-bw-ink-subtle">{cost}</span> : null}
                </button>
              )
            })}
          </div>
          {packagingCosts && (packagingCosts.BAG === null || packagingCosts.BOX === null) ? <p className="text-[11px] text-bw-amber">حدّد تكلفة الشنطة والكرتونة في الإعدادات.</p> : null}
          <Button size="sm" loading={event.pending} disabled={!printed || !packagingType} onClick={() => record('PACKED')}>اتغلّف — جاهز للتسليم</Button>
          {!printed || !packagingType ? <p className="text-[11px] text-bw-ink-subtle">{!printed ? 'بيتفتح بعد ما تأكد إن الورقتين طلعوا سليمين' : 'اختار نوع التغليف اللي استخدمته'}</p> : null}
          <CommandError error={choose.error} />
        </Step>
      </ol>
      {label.error || event.error ? <div className="border-t border-bw-line p-3"><CommandError error={label.error ?? event.error} /></div> : null}
    </section>
  )
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 p-4">
      <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums', done ? 'border-bw-emerald/40 bg-bw-emerald-soft text-bw-emerald' : 'border-bw-line-field text-bw-ink-soft')}>
        {done ? <Check className="size-3.5" aria-label="تم" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-bw-small font-semibold text-bw-ink">{title}</p>
        {children}
      </div>
    </li>
  )
}
