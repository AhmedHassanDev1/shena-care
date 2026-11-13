'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Code, PageHeader, Skeleton, StateBlock } from '@/components/bw/primitives'
import { Flash } from '@/components/bw/ops'
import { HubShell } from '@/components/workspace/hub'
import { CommandError, Egp, Page, Status } from '@/components/workspace/kit'
import { LoadError } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { ORDER_STATUS } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Pending = {
  total: number
  suggestedCourierCost: number | null
  packagingCosts: { BAG: number | null; BOX: number | null }
  items: Array<{
    orderId: string; orderNumber: string; status: string; customerName: string; customerDeliveryFee: string
    missing: Array<'courier' | 'packaging'>; courierCost: string | null; packagingType: 'BAG' | 'BOX' | null; packagingCost: string | null
  }>
}

const TYPE_LABEL = { BAG: 'شنطة', BOX: 'كرتونة' } as const

/**
 * Actual delivery and packaging cost of each order, recorded by Hub staff. The packaging cost is the configured cost of the chosen type at
 * this moment (frozen on the order); the courier cost is what the courier really cost, not the customer's fee. Without them profit stays incomplete.
 */
export default function HubOrderCosts() {
  return <HubShell active="order-costs"><Body /></HubShell>
}

function Body() {
  const { data, error, loading, reload } = useApi<Pending>('/order-costs/pending', { pollMs: 30000 })
  return (
    <Page>
      <PageHeader
        title="تكلفة الطلبات"
        meta="سجّل تكلفة المندوب الفعلية ونوع التغليف المستخدم لكل طلب. من غيرهم الربح مابيكتملش."
        actions={<Button variant="secondary" size="sm" onClick={reload} loading={loading && !!data}>{!(loading && !!data) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>}
      />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <div className="space-y-2"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div> : null}
      {data && data.items.length === 0 ? <div className="bw-panel"><StateBlock kind="empty" title="كل تكاليف الطلبات مسجّلة" body="أي طلب خرج من المخزن ولسه ناقصه تكلفة توصيل أو نوع تغليف هيظهر هنا." /></div> : null}
      {data && data.items.length ? (
        <ul className="space-y-3">
          {data.items.map((order) => <OrderCostRow key={order.orderId} order={order} suggested={data.suggestedCourierCost} packaging={data.packagingCosts} onSaved={reload} />)}
        </ul>
      ) : null}
    </Page>
  )
}

function OrderCostRow({ order, suggested, packaging, onSaved }: { order: Pending['items'][number]; suggested: number | null; packaging: Pending['packagingCosts']; onSaved: () => void }) {
  const needsCourier = order.missing.includes('courier')
  const needsPackaging = order.missing.includes('packaging')
  const [courier, setCourier] = React.useState(suggested === null ? '' : String(suggested))
  const [type, setType] = React.useState<'BAG' | 'BOX' | null>(order.packagingType)
  const [done, setDone] = React.useState<string | null>(null)
  const courierValue = Number(courier)
  const courierOk = !needsCourier || (courier !== '' && Number.isFinite(courierValue) && courierValue >= 0 && /^\d+(\.\d{1,2})?$/.test(courier))
  const packagingOk = !needsPackaging || (type !== null && packaging[type] !== null)
  const save = useCommand(() => api(`/order-costs/${order.orderId}`, { method: 'PUT', body: {
    ...(needsCourier ? { courierCost: courierValue } : {}), ...(needsPackaging && type ? { packagingType: type } : {}),
  } }))
  const fee = Number(order.customerDeliveryFee)
  const funded = needsCourier && courierOk && courier !== '' ? Math.max(courierValue - fee, 0) : null

  return (
    <li className="bw-panel bw-arrive">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-bw-line px-4 py-3">
        <strong className="text-bw-body text-bw-ink"><Code>{order.orderNumber.replace(/^ORD-/, '#')}</Code></strong>
        <Status map={ORDER_STATUS} value={order.status} />
        <span className="text-bw-small text-bw-ink-soft"><bdi>{order.customerName}</bdi></span>
        <span className="ms-auto text-[12px] text-bw-ink-subtle">رسوم التوصيل على العميل <Egp value={fee} /></span>
      </div>
      <form className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={async (event) => { event.preventDefault(); if (await save.execute()) { setDone('اتسجّلت'); onSaved() } }}>
        {needsPackaging ? (
          <fieldset>
            <legend className="mb-1.5 text-bw-small font-semibold text-bw-ink">نوع التغليف المستخدم</legend>
            <div className="flex gap-2">
              {(['BAG', 'BOX'] as const).map((option) => {
                const cost = packaging[option]
                const on = type === option
                return (
                  <button
                    key={option} type="button" aria-pressed={on} disabled={cost === null} onClick={() => setType(option)}
                    className={cn('flex h-bw-control flex-1 items-center justify-between gap-2 rounded-bw-field border px-3 text-bw-small transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      on ? 'border-bw-cobalt/60 bg-bw-cobalt-soft font-semibold text-bw-ink' : 'border-bw-line-field text-bw-ink-soft hover:border-bw-ink-subtle hover:text-bw-ink')}
                  >
                    {TYPE_LABEL[option]}
                    <span className="text-[12px] tabular-nums text-bw-ink-subtle">{cost === null ? 'مالهاش تكلفة' : <Egp value={cost} />}</span>
                  </button>
                )
              })}
            </div>
            {packaging.BAG === null || packaging.BOX === null ? <p className="mt-1.5 text-[12px] text-bw-amber">حدّد تكلفة الشنطة والكرتونة في الإعدادات الأول.</p> : null}
          </fieldset>
        ) : <p className="text-bw-small text-bw-ink-soft">التغليف: {order.packagingType ? TYPE_LABEL[order.packagingType] : '—'} {order.packagingCost ? <>· <Egp value={Number(order.packagingCost)} /></> : null}</p>}
        {needsCourier ? (
          <div>
            <label htmlFor={`courier-${order.orderId}`} className="mb-1.5 block text-bw-small font-semibold text-bw-ink">تكلفة المندوب الفعلية · ج.م</label>
            <input
              id={`courier-${order.orderId}`} dir="ltr" inputMode="decimal" autoComplete="off" value={courier}
              onChange={(event) => setCourier(event.target.value.replace(/[^\d.]/g, ''))}
              className="bw-control h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface px-3 text-bw-body tabular-nums text-bw-ink"
            />
            <p className="mt-1.5 text-[12px] text-bw-ink-subtle">
              {suggested !== null ? 'القيمة المقترحة من الإعدادات؛ عدّلها لو المندوب كلّفك غير كده. ' : ''}
              {funded !== null ? <>الشركة بتتحمّل <Egp value={funded} /> من التوصيل.</> : null}
            </p>
          </div>
        ) : <p className="text-bw-small text-bw-ink-soft">تكلفة المندوب: {order.courierCost ? <Egp value={Number(order.courierCost)} /> : '—'}</p>}
        <Button type="submit" loading={save.pending} disabled={!courierOk || !packagingOk}>تسجيل</Button>
      </form>
      {done || save.error ? <div className="space-y-2 border-t border-bw-line px-4 py-3">{done ? <Flash tone="ok">{done}</Flash> : null}<CommandError error={save.error} /></div> : null}
    </li>
  )
}
