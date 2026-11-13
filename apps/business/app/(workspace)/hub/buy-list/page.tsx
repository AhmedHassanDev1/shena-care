'use client'

import * as React from 'react'
import { ChevronDown, Copy, Printer, RefreshCw, Undo2 } from 'lucide-react'
import { Button, Code, Notice, PageHeader, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { Flash, Meter, Segmented, SearchField, Stat, StatStrip, Toolbar } from '@/components/bw/ops'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, ApiError, newKey } from '@/lib/api'
import { buyListPrintHtml, buyListText, type BuyListData, type BuyListItem, variantLabel } from '@/lib/buy-list'
import { formatDateTime, shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

/**
 * Internal Buy List (GLO-296). Demand comes from the server (open COD orders, summed per exact SKU); buying happens outside the
 * system. Staff only record what they actually obtained or could not find. Not a supplier order, no supplier identity.
 */
export default function BuyListPage() {
  return (
    <RoleShell role="hub" active="buy-list" mode="desktop">
      <BuyListBody />
    </RoleShell>
  )
}

type View = 'to_buy' | 'unavailable' | 'done'

const MONEY = /^\d+(\.\d{1,2})?$/
/** The cost typed for one purchase: list price and discount per unit give the final unit cost. Null when blank or invalid. */
function costFrom(listText: string, discountText: string): { listUnitPrice: number; discountPerUnit: number; final: number } | null {
  if (!MONEY.test(listText) || (discountText !== '' && !MONEY.test(discountText))) return null
  const list = Number(listText)
  const discount = discountText === '' ? 0 : Number(discountText)
  const final = Math.round((list - discount) * 100) / 100
  return list > 0 && discount >= 0 && final > 0 ? { listUnitPrice: list, discountPerUnit: discount, final } : null
}
const egp = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ج.م`

type PendingCost = { acquireKey: string; skuId: string; skuCode: string | null; variantName: string | null; size: number | null; sizeUnit: string | null; quantity: number; acquiredAt: string }

const viewOf = (item: BuyListItem): View => (item.toBuy > 0 ? 'to_buy' : item.unavailable > 0 ? 'unavailable' : 'done')
const needOf = (item: BuyListItem) => item.orders.reduce((sum, order) => sum + order.required, 0) || item.toBuy + item.acquired + item.unavailable

function BuyListBody() {
  const { data, error, loading, reload } = useApi<BuyListData>('/buy-list', { pollMs: 30000 })
  const [copied, setCopied] = React.useState(false)
  const [view, setView] = React.useState<View>('to_buy')
  const [query, setQuery] = React.useState('')

  const copy = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(buyListText(data))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch { setCopied(false) }
  }
  const print = () => {
    if (!data) return
    // A self-contained document in its own window, so the app chrome and controls never reach the paper.
    const url = URL.createObjectURL(new Blob([buyListPrintHtml(data)], { type: 'text/html' }))
    const win = window.open(url, 'buy-list-print', 'width=900,height=700')
    if (!win) { URL.revokeObjectURL(url); return }
    win.addEventListener('load', () => { win.focus(); win.print(); URL.revokeObjectURL(url) })
  }

  const counts = React.useMemo(() => {
    const c: Record<View, number> = { to_buy: 0, unavailable: 0, done: 0 }
    data?.items.forEach((item) => { c[viewOf(item)] += 1 })
    return c
  }, [data])
  // A view that has emptied out (everything bought) hands over to the next one that has work, so the screen never looks empty by accident.
  const activeView: View = data && counts[view] === 0 && view === 'to_buy' && !query ? (counts.unavailable ? 'unavailable' : counts.done ? 'done' : 'to_buy') : view
  const needle = query.trim().toLowerCase()
  const visible = (data?.items ?? []).filter((item) => viewOf(item) === activeView
    && (!needle || [item.productName, item.skuCode, item.barcode, variantLabel(item)].some((part) => part?.toLowerCase().includes(needle))))

  const pendingCosts = useApi<{ pending: number; items: PendingCost[] }>('/buy-list/costs?pending=true&take=50', { pollMs: 30000 })
  const active = data?.mode === 'INTERNAL_BUY_LIST'
  const overallNeed = data?.items.reduce((sum, item) => sum + needOf(item), 0) ?? 0
  const overallDone = data?.items.reduce((sum, item) => sum + item.acquired, 0) ?? 0

  return (
    <Page>
      <PageHeader
        title="قائمة المشتريات"
        meta="الكميات المطلوب شراؤها من كل صنف، مجمّعة من الطلبات المفتوحة."
        actions={<>
          <Button variant="secondary" size="sm" onClick={reload} loading={loading && !!data}>{!(loading && !!data) ? <RefreshCw className="size-4" aria-hidden /> : null}تحديث</Button>
          <Button variant="secondary" size="sm" disabled={!data} onClick={copy}><Copy className="size-4" aria-hidden />{copied ? 'اتنسخت' : 'نسخ'}</Button>
          <Button variant="secondary" size="sm" disabled={!data} onClick={print}><Printer className="size-4" aria-hidden />طباعة</Button>
        </>}
      />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {data && !active ? (
        <Notice tone="warn" title="قائمة المشتريات الداخلية مش مفعّلة">وضع التوريد الحالي مش «شراء داخلي». غيّره من الإعدادات ← العمليات لو ده المطلوب.</Notice>
      ) : null}

      {!data && loading ? (
        <>
          <Skeleton className="h-24 w-full" />
          <div className="space-y-2"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>
        </>
      ) : null}

      {data ? (
        <>
          <StatStrip>
            <Stat label="قطع لازم تتشترى" value={data.totals.toBuy} tone="amber" hint={`في ${data.totals.skus} صنف`} />
            <Stat label="أصناف" value={data.totals.skus} tone="neutral" hint={`من ${data.totals.orders} طلب`} />
            <Stat label="مستنية الاستلام" value={data.totals.awaitingHub} tone="cobalt" hint="اتشترت ولسه ماوصلتش المخزن" />
            <Stat label="مش متاحة" value={data.totals.unavailable} tone="rose" hint="العميل هيتسأل" />
            <div className="bg-bw-surface p-4">
              <p className="text-bw-small text-bw-ink-soft">تقدّم الشراء</p>
              <p className="mt-2.5 text-[1.75rem] font-semibold leading-none tabular-nums text-bw-ink">
                <span dir="ltr" className="bw-code">{overallNeed ? Math.round((overallDone / overallNeed) * 100) : 0}<span className="text-bw-small font-normal text-bw-ink-subtle">%</span></span>
              </p>
              <Meter className="mt-2.5" value={overallDone} max={overallNeed} tone="emerald" label="نسبة ما اتشترى من إجمالي المطلوب" />
            </div>
          </StatStrip>

          {pendingCosts.data && pendingCosts.data.items.length > 0 ? <PendingCosts items={pendingCosts.data.items} onSaved={() => { pendingCosts.reload(); reload() }} /> : null}

          <Toolbar>
            <SearchField value={query} onChange={setQuery} label="بحث في القائمة" placeholder="اسم الصنف أو الكود أو الباركود" />
            <Segmented
              label="عرض القائمة"
              value={activeView}
              onChange={setView}
              className="min-w-0 basis-full sm:basis-0 sm:flex-1"
              items={[
                { value: 'to_buy', label: 'لازم يتشترى', count: counts.to_buy },
                { value: 'unavailable', label: 'مش متاح', count: counts.unavailable },
                { value: 'done', label: 'اتغطّى', count: counts.done },
              ]}
            />
          </Toolbar>

          {data.items.length === 0 ? (
            <div className="bw-panel"><StateBlock kind="empty" title="مفيش مشتريات مطلوبة دلوقتي" body="الطلبات الجديدة المؤكدة (دفع عند الاستلام) بتظهر هنا لحد ما تتشترى وتتستلم." /></div>
          ) : visible.length === 0 ? (
            <div className="bw-panel"><StateBlock kind="empty" title={query ? 'مفيش صنف مطابق' : activeView === 'to_buy' ? 'كل الأصناف اتشترت' : 'مفيش أصناف هنا'} body={query ? 'جرّب اسم أو كود تاني.' : undefined} /></div>
          ) : (
            <ul className="space-y-3">
              {visible.map((item) => <BuyRow key={item.skuId} item={item} active={active} onChanged={reload} />)}
            </ul>
          )}
        </>
      ) : null}
    </Page>
  )
}

function BuyRow({ item, active, onChanged }: { item: BuyListItem; active: boolean; onChanged: () => void }) {
  const [quantity, setQuantity] = React.useState(String(item.toBuy))
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [showOrders, setShowOrders] = React.useState(false)
  const [listPrice, setListPrice] = React.useState('')
  const [discount, setDiscount] = React.useState('')
  const inputId = React.useId()
  // One key per physical count: a retry after a lost response replays instead of counting twice; a new number is a new count.
  const key = React.useRef(newKey())
  React.useEffect(() => { setQuantity(String(item.toBuy)); key.current = newKey() }, [item.toBuy])

  const acquire = useCommand(() => api<{ acquired: number; replayed: boolean; remainingToBuy: number }>('/buy-list/acquire', {
    body: { skuId: item.skuId, quantity: Number(quantity), idempotencyKey: key.current,
      ...(costFrom(listPrice, discount) ? { cost: { listUnitPrice: costFrom(listPrice, discount)!.listUnitPrice, discountPerUnit: costFrom(listPrice, discount)!.discountPerUnit } } : {}) },
  }))
  const unavailable = useCommand(() => api<{ flagged: number; units: number }>('/buy-list/unavailable', { body: { skuId: item.skuId } }))
  const reopen = useCommand(() => api<{ reopened: number }>('/buy-list/reopen', { body: { skuId: item.skuId } }))

  const qty = Number(quantity)
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= item.toBuy
  const over = Number.isInteger(qty) && qty > item.toBuy
  const need = needOf(item)
  const staleNote = (error: ApiError | null) => (error?.code === 'EXCEEDS_OUTSTANDING' || error?.code === 'NOTHING_OUTSTANDING')
    ? 'القائمة اتغيّرت (حد تاني سجّل أو طلب اتلغى). اتحدّثت بالكميات الحالية.' : null

  const run = async (action: 'acquire' | 'unavailable' | 'reopen') => {
    setMessage(null)
    if (action === 'acquire') {
      const result = await acquire.execute()
      if (result) { key.current = newKey(); setMessage({ tone: 'ok', text: `${result.remainingToBuy ? `اتسجّل ${result.acquired} قطعة — باقي ${result.remainingToBuy}` : `اتسجّل ${result.acquired} قطعة — الصنف اتغطّى`}${costFrom(listPrice, discount) ? ' بتكلفتها' : ' — التكلفة لسه مش مسجّلة'}` }); setListPrice(''); setDiscount(''); onChanged() } else onChanged()
    } else if (action === 'unavailable') {
      if (await unavailable.execute()) { setMessage({ tone: 'warn', text: 'اتسجّل إنه مش متاح — العميل هيتسأل يستبدل أو يكمّل من غيره' }); onChanged() }
    } else if (await reopen.execute()) { setMessage({ tone: 'ok', text: 'رجع للقائمة' }); onChanged() }
  }
  const stale = staleNote(acquire.error)
  const typedCost = costFrom(listPrice, discount)
  const costInvalid = (listPrice !== '' || discount !== '') && !typedCost
  const busy = acquire.pending || unavailable.pending || reopen.pending
  const partial = item.acquired > 0 && item.toBuy > 0

  return (
    <li className="bw-panel bw-arrive overflow-hidden">
      <div className="grid gap-x-5 gap-y-4 p-4 md:grid-cols-[7.5rem_minmax(0,1fr)] md:items-center xl:grid-cols-[7.5rem_minmax(0,1fr)_auto]">
        {/* What is still to buy: the number the whole screen is about. */}
        <div className="flex items-end gap-3 md:block">
          <p className={cn('text-[2.75rem] font-semibold leading-none tabular-nums', item.toBuy > 0 ? 'text-bw-amber' : item.unavailable > 0 ? 'text-bw-rose' : 'text-bw-emerald')}><bdi className="bw-code">{item.toBuy > 0 ? item.toBuy : item.unavailable > 0 ? item.unavailable : item.acquired}</bdi></p>
          <div className="min-w-0 flex-1 md:mt-2">
            <p className="text-[12px] text-bw-ink-soft">{item.toBuy > 0 ? 'لسه مطلوب' : item.unavailable > 0 ? 'مش متاح' : 'اتشترى'}</p>
            <Meter className="mt-1.5" value={item.acquired} max={need} tone={item.toBuy === 0 ? 'emerald' : 'amber'} label={`اتشترى ${item.acquired} من ${need}`} />
            <p className="mt-1 text-[11px] text-bw-ink-subtle">اتشترى <bdi className="bw-code">{item.acquired}</bdi> من <bdi className="bw-code">{need}</bdi></p>
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="text-bw-body font-semibold text-bw-ink"><bdi>{item.productName ?? shortId(item.skuId)}</bdi></h3>
          {variantLabel(item) ? <p className="mt-0.5 text-bw-small text-bw-ink-soft"><bdi>{variantLabel(item)}</bdi></p> : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-bw-ink-subtle">
            <Code>{item.skuCode ?? shortId(item.skuId)}</Code>
            {item.barcode ? <Code>{item.barcode}</Code> : null}
            <span><bdi className="bw-code">{item.orderCount}</bdi> طلب</span>
            {item.awaitingHub > 0 ? <span className="text-bw-cobalt">مستني الاستلام <bdi className="bw-code">{item.awaitingHub}</bdi></span> : null}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!item.skuActive ? <StatusLabel tone="warn">الصنف مش فعّال في الكتالوج</StatusLabel> : null}
            {item.unavailable > 0 ? <StatusLabel tone="danger">مش متاح <bdi className="bw-code">{item.unavailable}</bdi></StatusLabel> : null}
            {partial ? <StatusLabel tone="info">شراء جزئي</StatusLabel> : null}
          </div>
        </div>

        {item.toBuy > 0 && active ? (
          <form className="flex flex-wrap items-center gap-2 md:col-span-2 md:border-t md:border-bw-line md:pt-4 xl:col-span-1 xl:flex-nowrap xl:border-0 xl:pt-0" onSubmit={(event) => { event.preventDefault(); void run('acquire') }}>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 md:flex-none">
              <label htmlFor={inputId} className="sr-only">الكمية اللي اتشترت</label>
              <input
                id={inputId}
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                value={quantity}
                aria-invalid={over || undefined}
                onChange={(event) => { setQuantity(event.target.value.replace(/[^\d]/g, '')); key.current = newKey() }}
                className={cn('bw-control h-12 w-20 rounded-bw-field border bg-bw-page/60 text-center text-lg font-semibold tabular-nums text-bw-ink md:h-bw-control md:text-bw-body', over ? 'border-bw-danger' : 'border-bw-line-field')}
              />
              {item.toBuy > 1 ? (
                <button type="button" onClick={() => { setQuantity(String(item.toBuy)); key.current = newKey() }} className="h-9 rounded-bw-field px-2 text-[12px] font-semibold text-bw-cobalt transition-colors hover:bg-bw-veil-3">الكل</button>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 md:flex-none">
              <CostInput id={`${inputId}-list`} label="سعر القائمة للقطعة" placeholder="سعر القطعة" value={listPrice} onChange={setListPrice} invalid={costInvalid} />
              <CostInput id={`${inputId}-discount`} label="الخصم للقطعة" placeholder="خصم" value={discount} onChange={setDiscount} invalid={costInvalid} />
            </div>
            {typedCost ? <span className="basis-full text-[12px] text-bw-ink-soft md:basis-auto" aria-live="polite">التكلفة <strong className="text-bw-ink tabular-nums">{egp(typedCost.final)}</strong> للقطعة</span> : null}
            <Button type="submit" loading={acquire.pending} disabled={!valid || busy || costInvalid} className="h-12 flex-1 md:h-bw-control md:flex-none">تم الشراء</Button>
            <Button type="button" variant="ghost" loading={unavailable.pending} disabled={busy} onClick={() => void run('unavailable')} className="h-12 text-bw-danger hover:text-bw-danger md:h-bw-control">مش متاح</Button>
            {over ? <p role="alert" className="basis-full text-[12px] text-bw-danger md:text-end">أكتر من المطلوب (<bdi className="bw-code">{item.toBuy}</bdi>)</p> : null}
            {costInvalid ? <p role="alert" className="basis-full text-[12px] text-bw-danger md:text-end">الخصم لازم يكون أقل من سعر القائمة، والاتنين أرقام.</p> : null}
          </form>
        ) : null}
        {item.unavailable > 0 && active ? (
          <div className="md:col-span-2 xl:col-span-1 xl:justify-self-end">
            <Button variant="secondary" loading={reopen.pending} disabled={busy} onClick={() => void run('reopen')}><Undo2 className="size-4" aria-hidden />لقيته — رجّعه</Button>
          </div>
        ) : null}
      </div>

      {message || stale || acquire.error || unavailable.error || reopen.error ? (
        <div className="space-y-2 border-t border-bw-line px-4 py-3">
          {message ? <Flash tone={message.tone}>{message.text}</Flash> : null}
          {stale ? <Flash tone="warn">{stale}</Flash> : <CommandError error={acquire.error ?? unavailable.error ?? reopen.error} />}
        </div>
      ) : null}

      <div className="border-t border-bw-line">
        <button
          type="button"
          aria-expanded={showOrders}
          onClick={() => setShowOrders((v) => !v)}
          className="bw-row flex w-full items-center gap-2 px-4 py-2.5 text-start text-[12px] font-semibold text-bw-ink-soft hover:text-bw-ink"
        >
          الطلبات (<bdi className="bw-code">{item.orderCount}</bdi>)
          <ChevronDown className={cn('ms-auto size-4 transition-transform duration-200', showOrders && 'rotate-180')} aria-hidden />
        </button>
        {showOrders ? (
          <ul className="divide-y divide-bw-line border-t border-bw-line bg-bw-veil-1">
            {item.orders.map((order) => (
              <li key={order.orderItemId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-bw-small">
                <Code className="font-semibold text-bw-ink">{order.orderNumber.replace(/^ORD-/, '#')}</Code>
                <span className="text-bw-ink-soft">مطلوب <Code>{order.required}</Code></span>
                <span className="text-bw-ink-soft">اتشترى <Code>{order.acquired}</Code></span>
                <span className="text-bw-ink-soft">استُلم <Code>{order.receivedAtHub}</Code></span>
                <span className="ms-auto">
                  {order.state === 'unavailable' ? <StatusLabel tone="warn">مش متاح</StatusLabel> : order.state === 'covered' ? <StatusLabel tone="ok">مغطّى</StatusLabel> : <StatusLabel tone="pending">لسه</StatusLabel>}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  )
}

function CostInput({ id, label, placeholder, value, onChange, invalid }: { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void; invalid?: boolean }) {
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id} dir="ltr" inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value} aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ''))}
        className={cn('bw-control h-12 w-24 rounded-bw-field border bg-bw-page/60 px-2 text-center text-bw-small tabular-nums text-bw-ink placeholder:text-bw-ink-subtle md:h-bw-control', invalid ? 'border-bw-danger' : 'border-bw-line-field')}
      />
    </>
  )
}

function CostField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12px] font-semibold text-bw-ink-soft">{label}</label>
      <input
        id={id} dir="ltr" inputMode="decimal" autoComplete="off" value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ''))}
        className="bw-control h-10 w-full rounded-bw-field border border-bw-line-field bg-bw-page/60 px-3 text-bw-small tabular-nums text-bw-ink"
      />
    </div>
  )
}

/** Purchases that were counted without a cost. Recording it later is the same list price and discount, against that purchase. */
function PendingCosts({ items, onSaved }: { items: PendingCost[]; onSaved: () => void }) {
  const [all, setAll] = React.useState(false)
  const shown = all ? items : items.slice(0, 3)
  return (
    <section aria-label="مشتريات بلا تكلفة مسجّلة" className="bw-panel border-bw-amber/30">
      <div className="flex items-center gap-2 border-b border-bw-line px-4 py-3">
        <h2 className="text-bw-body font-semibold text-bw-ink">مشتريات بلا تكلفة مسجّلة</h2>
        <span className="rounded-full border border-bw-amber/30 bg-bw-amber-soft px-2 text-[11px] font-semibold text-bw-amber"><bdi className="bw-code">{items.length}</bdi></span>
        <p className="ms-auto hidden text-[12px] text-bw-ink-subtle sm:block">لازم تتسجّل عشان الربح يكتمل</p>
      </div>
      <ul className="divide-y divide-bw-line">
        {shown.map((row) => <PendingCostRow key={row.acquireKey} row={row} onSaved={onSaved} />)}
      </ul>
      {items.length > 3 ? <button type="button" onClick={() => setAll((v) => !v)} className="bw-row w-full border-t border-bw-line px-4 py-2.5 text-start text-[12px] font-semibold text-bw-cobalt">{all ? 'عرض أقل' : `عرض الكل (${items.length})`}</button> : null}
    </section>
  )
}

function PendingCostRow({ row, onSaved }: { row: PendingCost; onSaved: () => void }) {
  const [listPrice, setListPrice] = React.useState('')
  const [discount, setDiscount] = React.useState('')
  const id = React.useId()
  const typed = costFrom(listPrice, discount)
  const save = useCommand(() => api('/buy-list/costs', { body: { acquireKey: row.acquireKey, listUnitPrice: typed!.listUnitPrice, discountPerUnit: typed!.discountPerUnit } }))
  const size = row.size != null ? `${row.size}${row.sizeUnit ? ` ${row.sizeUnit}` : ''}` : ''
  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_repeat(2,8rem)_auto] md:items-end">
      <div className="min-w-0">
        <p className="text-bw-small font-semibold text-bw-ink"><Code>{row.skuCode ?? shortId(row.skuId)}</Code> <bdi className="font-normal text-bw-ink-soft">{[row.variantName, size].filter(Boolean).join(' · ')}</bdi></p>
        <p className="text-[12px] text-bw-ink-subtle"><bdi className="bw-code">{row.quantity}</bdi> قطعة · {formatDateTime(row.acquiredAt)}</p>
      </div>
      <CostField id={`${id}-l`} label="سعر القائمة · ج.م" value={listPrice} onChange={setListPrice} />
      <CostField id={`${id}-d`} label="الخصم للقطعة · ج.م" value={discount} onChange={setDiscount} />
      <div className="flex items-center gap-3">
        {typed ? <span className="text-[12px] text-bw-ink-soft tabular-nums">= {egp(typed.final)}</span> : null}
        <Button size="sm" loading={save.pending} disabled={!typed} onClick={async () => { if (await save.execute()) onSaved() }}>تسجيل التكلفة</Button>
      </div>
      {save.error ? <div className="md:col-span-4"><CommandError error={save.error} /></div> : null}
    </li>
  )
}
