'use client'

import * as React from 'react'
import { Copy, Printer, RefreshCw } from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Page } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api, ApiError, newKey } from '@/lib/api'
import { buyListPrintHtml, buyListText, type BuyListData, type BuyListItem, variantLabel } from '@/lib/buy-list'
import { shortId } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'

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

function BuyListBody() {
  const { data, error, loading, reload } = useApi<BuyListData>('/buy-list', { pollMs: 30000 })
  const [copied, setCopied] = React.useState(false)

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

  return (
    <Page>
      <PageHeader title="قائمة المشتريات" meta="الكميات المطلوبة من كل صنف (نفس النوع والحجم بالظبط) مجمّعة من الطلبات المفتوحة. الشراء بيتم برّه النظام، وهنا بتسجّل اللي اتشترى واللي مالقيتوش."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={reload}><RefreshCw className="size-4" aria-hidden />تحديث</Button>
          <Button variant="secondary" disabled={!data} onClick={copy}><Copy className="size-4" aria-hidden />{copied ? 'اتنسخت' : 'نسخ القائمة'}</Button>
          <Button variant="secondary" disabled={!data} onClick={print}><Printer className="size-4" aria-hidden />طباعة</Button>
        </div>} />
      {error ? <LoadError message={error.message} onRetry={reload} /> : null}
      {!data && loading ? <Skeleton className="h-40 w-full" /> : null}
      {data && data.mode !== 'INTERNAL_BUY_LIST' ? (
        <Notice tone="warn" title="قائمة المشتريات الداخلية مش مفعّلة" >وضع التوريد الحالي مش «شراء داخلي». غيّره من الإعدادات → العمليات لو ده المطلوب.</Notice>
      ) : null}
      {data ? <Totals data={data} /> : null}
      {data && data.items.length === 0 ? <StateBlock kind="empty" title="مفيش مشتريات مطلوبة دلوقتي" body="الطلبات الجديدة المؤكدة (دفع عند الاستلام) بتظهر هنا لحد ما تتشترى وتتستلم." /> : null}
      <div className="space-y-4">
        {data?.items.map((item) => <BuyRow key={item.skuId} item={item} active={data.mode === 'INTERNAL_BUY_LIST'} onChanged={reload} />)}
      </div>
    </Page>
  )
}

function Totals({ data }: { data: BuyListData }) {
  const cells: Array<[string, number]> = [['أصناف', data.totals.skus], ['قطع مطلوب شراؤها', data.totals.toBuy], ['اتشترت ومستنية الاستلام', data.totals.awaitingHub], ['مش متاحة', data.totals.unavailable], ['طلبات', data.totals.orders]]
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-bw-field border border-bw-line p-3">
          <dt className="text-bw-small text-bw-ink-soft">{label}</dt>
          <dd className="text-xl font-bold"><Code>{value}</Code></dd>
        </div>
      ))}
    </dl>
  )
}

function BuyRow({ item, active, onChanged }: { item: BuyListItem; active: boolean; onChanged: () => void }) {
  const [quantity, setQuantity] = React.useState(String(item.toBuy))
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  // One key per physical count: a retry after a lost response replays instead of counting twice; a new number is a new count.
  const key = React.useRef(newKey())
  React.useEffect(() => { setQuantity(String(item.toBuy)); key.current = newKey() }, [item.toBuy])

  const acquire = useCommand(() => api<{ acquired: number; replayed: boolean; remainingToBuy: number }>('/buy-list/acquire', {
    body: { skuId: item.skuId, quantity: Number(quantity), idempotencyKey: key.current },
  }))
  const unavailable = useCommand(() => api<{ flagged: number; units: number }>('/buy-list/unavailable', { body: { skuId: item.skuId } }))
  const reopen = useCommand(() => api<{ reopened: number }>('/buy-list/reopen', { body: { skuId: item.skuId } }))

  const qty = Number(quantity)
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= item.toBuy
  const staleNote = (error: ApiError | null) => (error?.code === 'EXCEEDS_OUTSTANDING' || error?.code === 'NOTHING_OUTSTANDING')
    ? 'القائمة اتغيّرت (حد تاني سجّل أو طلب اتلغى). اتحدّثت بالكميات الحالية.' : null

  const run = async (action: 'acquire' | 'unavailable' | 'reopen') => {
    setMessage(null)
    if (action === 'acquire') {
      const result = await acquire.execute()
      if (result) { key.current = newKey(); setMessage({ tone: 'ok', text: result.remainingToBuy ? `اتسجّل ${result.acquired} قطعة — باقي ${result.remainingToBuy}` : `اتسجّل ${result.acquired} قطعة — الصنف اتغطّى` }); onChanged() } else onChanged()
    } else if (action === 'unavailable') {
      if (await unavailable.execute()) { setMessage({ tone: 'warn', text: 'اتسجّل إنه مش متاح — العميل هيتسأل يستبدل أو يكمّل من غيره' }); onChanged() }
    } else if (await reopen.execute()) { setMessage({ tone: 'ok', text: 'رجع للقائمة' }); onChanged() }
  }
  const stale = staleNote(acquire.error)

  return (
    <Section title={<span className="flex flex-wrap items-center gap-2">
      <bdi>{item.productName ?? shortId(item.skuId)}</bdi>
      <span className="font-normal text-bw-ink-soft">{variantLabel(item)}</span>
      {!item.skuActive ? <StatusLabel tone="warn">الصنف مش فعّال في الكتالوج</StatusLabel> : null}
    </span>}
      aside={<span className="text-bw-small text-bw-ink-soft"><Code>{item.skuCode ?? shortId(item.skuId)}</Code>{item.barcode ? <> · <Code>{item.barcode}</Code></> : null}</span>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-bw-small">
          <span>مطلوب شراؤه <strong className="text-base"><Code>{item.toBuy}</Code></strong></span>
          <span>اتشترى <Code>{item.acquired}</Code></span>
          <span>مستني الاستلام في المخزن <Code>{item.awaitingHub}</Code></span>
          {item.unavailable ? <span className="text-bw-warn">مش متاح <Code>{item.unavailable}</Code></span> : null}
          <span>في <Code>{item.orderCount}</Code> طلب</span>
        </div>
        {item.toBuy > 0 && active ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run('acquire') }}>
            <Field label="الكمية اللي اتشترت" ltr inputMode="numeric" value={quantity} className="w-40"
              onChange={(event) => { setQuantity(event.target.value); key.current = newKey() }}
              error={Number.isInteger(qty) && qty > item.toBuy ? `أكتر من المطلوب (${item.toBuy})` : undefined} />
            <Button type="submit" loading={acquire.pending} disabled={!valid}>تم الشراء</Button>
            <Button type="button" variant="danger" loading={unavailable.pending} onClick={() => void run('unavailable')}>مش متاح</Button>
          </form>
        ) : null}
        {item.unavailable > 0 && active ? (
          <Button variant="secondary" loading={reopen.pending} onClick={() => void run('reopen')}>لقيته — رجّعه للقائمة</Button>
        ) : null}
        {message ? <Notice tone={message.tone} title={message.text} /> : null}
        {stale ? <Notice tone="warn" title={stale} /> : <CommandError error={acquire.error ?? unavailable.error ?? reopen.error} />}
        <details className="text-bw-small">
          <summary className="cursor-pointer font-semibold">الطلبات ({item.orderCount})</summary>
          <ul className="mt-2 space-y-1">
            {item.orders.map((order) => (
              <li key={order.orderItemId} className="flex flex-wrap items-center gap-3">
                <Code>{order.orderNumber}</Code>
                <span>مطلوب <Code>{order.required}</Code></span>
                <span>اتشترى <Code>{order.acquired}</Code></span>
                <span>استُلم <Code>{order.receivedAtHub}</Code></span>
                {order.state === 'unavailable' ? <StatusLabel tone="warn">مش متاح</StatusLabel> : order.state === 'covered' ? <StatusLabel tone="ok">مغطّى</StatusLabel> : <StatusLabel tone="pending">لسه</StatusLabel>}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Section>
  )
}
