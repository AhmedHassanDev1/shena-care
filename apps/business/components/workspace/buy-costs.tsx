'use client'

import * as React from 'react'
import { ArrowUpRight, Check, Percent } from 'lucide-react'
import { Button } from '@/components/bw/primitives'
import { CommandError } from '@/components/workspace/kit'
import { ProductIdentity } from '@/components/bw/product-card'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/labels'
import { useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'

/** Actual acquisition cost of Buy List purchases: list price and discount per unit give the final unit cost. */

const MONEY = /^\d+(\.\d{1,2})?$/
const PERCENT = /^\d+(\.\d{1,2})?$/

/** Backward-compatible costFrom in EGP. */
export function costFrom(listText: string, discountText: string): { listUnitPrice: number; discountPerUnit: number; final: number } | null {
  if (!MONEY.test(listText) || (discountText !== '' && !MONEY.test(discountText))) return null
  const list = Number(listText)
  const discount = discountText === '' ? 0 : Number(discountText)
  const final = Math.round((list - discount) * 100) / 100
  return list > 0 && discount >= 0 && final > 0 ? { listUnitPrice: list, discountPerUnit: discount, final } : null
}

/** Cost calculation where discount is entered as a percentage (e.g. 20 for 20%). */
export function costFromPercent(listText: string, discountPercentText: string): { listUnitPrice: number; discountPercent: number; discountPerUnit: number; final: number } | null {
  if (!MONEY.test(listText) || (discountPercentText !== '' && !PERCENT.test(discountPercentText))) return null
  const list = Number(listText)
  const discountPercent = discountPercentText === '' ? 0 : Number(discountPercentText)
  if (list <= 0 || discountPercent < 0 || discountPercent >= 100) return null
  const discountPerUnit = Math.round(list * (discountPercent / 100) * 100) / 100
  const final = Math.round((list - discountPerUnit) * 100) / 100
  return final > 0 ? { listUnitPrice: list, discountPercent, discountPerUnit, final } : null
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

function CostField({ id, label, value, onChange, adornment }: { id: string; label: string; value: string; onChange: (value: string) => void; adornment?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[12px] font-semibold text-bw-ink-soft">{label}</label>
      <div className="relative flex items-center">
        <input
          id={id} dir="ltr" inputMode="decimal" autoComplete="off" value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ''))}
          className={cn(
            'bw-control h-10 w-full rounded-bw-field border border-bw-line-field bg-bw-page px-3 text-bw-small tabular-nums text-bw-ink',
            adornment && 'pe-8'
          )}
        />
        {adornment ? <span className="pointer-events-none absolute end-2.5 text-bw-small font-semibold text-bw-ink-subtle">{adornment}</span> : null}
      </div>
    </div>
  )
}

export type PendingCost = {
  acquireKey: string
  skuId: string
  skuCode: string | null
  productName?: string | null
  brandName?: string | null
  variantName: string | null
  size: number | null
  sizeUnit: string | null
  texture?: string | null
  categoryName?: string | null
  imageUrl?: string | null
  productSlug?: string | null
  barcode?: string | null
  defaultPrice?: number | null
  quantity: number
  acquiredAt: string
}

/** Receipts that were recorded without a cost. Recording it later is the same list price and discount, against that receipt. */
export function PendingCosts({ items, onSaved }: { items: PendingCost[]; onSaved: () => void }) {
  const [all, setAll] = React.useState(false)
  const shown = all ? items : items.slice(0, 5)
  return (
    <section aria-label="مشتريات بلا تكلفة مسجّلة" className="bw-panel border-bw-amber/30">
      <div className="flex flex-wrap items-center gap-2 border-b border-bw-line px-4 py-3">
        <h2 className="text-bw-body font-semibold text-bw-ink">مشتريات بلا تكلفة مسجّلة</h2>
        <span className="rounded-full border border-bw-amber/30 bg-bw-amber-soft px-2 text-[11px] font-semibold text-bw-amber"><bdi className="bw-code">{items.length}</bdi></span>
        <p className="ms-auto text-[12px] text-bw-ink-subtle">لازم تتسجّل عشان الربح يكتمل</p>
      </div>
      <ul className="divide-y divide-bw-line">
        {shown.map((row) => <PendingCostRow key={row.acquireKey} row={row} onSaved={onSaved} />)}
      </ul>
      {items.length > 5 ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="bw-row w-full border-t border-bw-line px-4 py-2.5 text-start text-[12px] font-semibold text-bw-cobalt">
          {all ? 'عرض أقل' : `عرض الكل (${items.length})`}
        </button>
      ) : null}
    </section>
  )
}

function PendingCostRow({ row, onSaved }: { row: PendingCost; onSaved: () => void }) {
  const [listPrice, setListPrice] = React.useState(row.defaultPrice != null ? String(row.defaultPrice) : '')
  const [discountPercent, setDiscountPercent] = React.useState('')
  const [syncStorefront, setSyncStorefront] = React.useState(false)
  const [syncedOk, setSyncedOk] = React.useState(false)
  const id = React.useId()

  const typed = costFromPercent(listPrice, discountPercent)
  const save = useCommand(async () => {
    if (!typed) return
    await api('/buy-list/costs', {
      body: {
        acquireKey: row.acquireKey,
        listUnitPrice: typed.listUnitPrice,
        discountPerUnit: typed.discountPerUnit,
      },
    })
    if (syncStorefront) {
      await api('/commerce/prices', {
        method: 'POST',
        body: {
          skuId: row.skuId,
          amount: typed.listUnitPrice,
          currency: 'EGP',
        },
      }).catch(() => undefined)
      setSyncedOk(true)
    }
  })

  return (
    <li className="space-y-3 px-4 py-3 sm:space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ProductIdentity item={row} size="sm" showBarcode />
        <div className="shrink-0 text-start sm:text-end">
          <p className="text-[12px] text-bw-ink-subtle">
            <bdi className="bw-code font-semibold text-bw-ink">{row.quantity}</bdi> قطعة · {formatDateTime(row.acquiredAt)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[repeat(2,minmax(7rem,10rem))_minmax(0,1fr)_auto] sm:items-end">
        <CostField id={`${id}-l`} label="سعر القائمة (البيع) · ج.م" value={listPrice} onChange={setListPrice} />
        <CostField id={`${id}-d`} label="الخصم للقطعة %" value={discountPercent} onChange={setDiscountPercent} adornment="%" />

        <div className="min-w-0 py-1">
          {typed ? (
            <div className="space-y-0.5 text-[12px]">
              <p className="text-bw-ink-soft">
                التكلفة: <strong className="tabular-nums text-bw-ink">{egp(typed.final)}</strong> للقطعة
              </p>
              {typed.discountPerUnit > 0 ? (
                <p className="text-bw-ink-subtle tabular-nums">
                  (خصم {typed.discountPercent}% = {egp(typed.discountPerUnit)})
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[12px] text-bw-ink-subtle">اكتب سعر القائمة ونسبة الخصم</p>
          )}
        </div>

        <div className="flex flex-col gap-1 sm:items-end">
          <Button
            size="sm"
            className="w-full sm:w-auto"
            loading={save.pending}
            disabled={!typed}
            onClick={async () => {
              if (await save.execute()) onSaved()
            }}
          >
            تسجيل التكلفة
          </Button>

          {typed && Number(listPrice) !== row.defaultPrice ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-bw-ink-soft">
              <input
                type="checkbox"
                className="size-3.5 accent-bw-action"
                checked={syncStorefront}
                onChange={(e) => setSyncStorefront(e.target.checked)}
              />
              <span>تحديث السعر في الموقع</span>
              {syncedOk ? <Check className="size-3 text-bw-emerald" aria-hidden /> : null}
            </label>
          ) : null}
        </div>
      </div>

      {save.error ? <CommandError error={save.error} /> : null}
    </li>
  )
}
