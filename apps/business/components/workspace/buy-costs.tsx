'use client'

import * as React from 'react'
import { Button } from '@/components/bw/primitives'
import { Code } from '@/components/bw/primitives'
import { CommandError } from '@/components/workspace/kit'
import { api } from '@/lib/api'
import { formatDateTime, shortId } from '@/lib/labels'
import { useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

/** Actual acquisition cost of Buy List purchases: list price and discount per unit give the final unit cost. */

const MONEY = /^\d+(\.\d{1,2})?$/

/** The cost typed for one purchase. Null when blank or invalid (the discount must stay below the list price). */
export function costFrom(listText: string, discountText: string): { listUnitPrice: number; discountPerUnit: number; final: number } | null {
  if (!MONEY.test(listText) || (discountText !== '' && !MONEY.test(discountText))) return null
  const list = Number(listText)
  const discount = discountText === '' ? 0 : Number(discountText)
  const final = Math.round((list - discount) * 100) / 100
  return list > 0 && discount >= 0 && final > 0 ? { listUnitPrice: list, discountPerUnit: discount, final } : null
}

export const egp = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ج.م`

export function CostInput({ id, label, placeholder, value, onChange, invalid }: { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void; invalid?: boolean }) {
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id} dir="ltr" inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value} aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ''))}
        className={cn('bw-control h-10 w-24 rounded-bw-field border bg-bw-page/60 px-2 text-center text-bw-small tabular-nums text-bw-ink placeholder:text-bw-ink-subtle', invalid ? 'border-bw-danger' : 'border-bw-line-field')}
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

export type PendingCost = { acquireKey: string; skuId: string; skuCode: string | null; variantName: string | null; size: number | null; sizeUnit: string | null; quantity: number; acquiredAt: string }

/** Receipts that were recorded without a cost. Recording it later is the same list price and discount, against that receipt. */
export function PendingCosts({ items, onSaved }: { items: PendingCost[]; onSaved: () => void }) {
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
