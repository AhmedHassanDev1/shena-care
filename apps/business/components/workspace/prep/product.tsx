'use client'

import * as React from 'react'
import { Camera, Check, ChevronUp, Clock, Edit3, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/bw/primitives'
import { Flash } from '@/components/bw/ops'
import { ProductIdentity } from '@/components/bw/product-card'
import { CameraScanner } from '@/components/workspace/camera-scanner'
import { egp } from '@/components/workspace/buy-costs'
import { api } from '@/lib/api'
import { useCommand } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { type DeskLine, imageSrc, productTitle } from './model'

/** The product photo from the catalog; without one the product's first letters stand in. */
export function Thumb({ line, size = 'md' }: { line: DeskLine; size?: 'md' | 'lg' }) {
  const [broken, setBroken] = React.useState(false)
  const src = imageSrc(line.imageUrl)
  const box = size === 'lg' ? 'size-20 sm:size-24' : 'size-12 sm:size-14'
  if (!src || broken) {
    return (
      <span
        aria-hidden
        className={cn(
          box,
          'grid shrink-0 place-items-center rounded-bw-field bg-bw-sunken text-bw-heading font-semibold text-bw-ink-subtle'
        )}
      >
        {productTitle(line).slice(0, 1)}
      </span>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className={cn(box, 'shrink-0 rounded-bw-field border border-bw-line bg-bw-surface object-cover')}
    />
  )
}

/**
 * Standardized order line card:
 * - Product identity identical to purchases (bold brand, name, category, texture, size tags, barcode)
 * - Selling price & required vs received quantities clearly displayed beside the item
 * - Expandable quiet quick card under the item with inputs side-by-side and barcode scanning
 */
export function ProductRow({
  line,
  pending = 0,
  hubId,
  orderId,
  onChanged,
  children,
}: {
  line: DeskLine
  pending?: number
  hubId?: string
  orderId?: string
  onChanged?: () => void
  children?: React.ReactNode
}) {
  const [expanded, setExpanded] = React.useState(false)
  const done = line.received >= line.required
  const waiting = Math.max(line.required - line.purchased, 0)
  const have = Math.min(line.received + pending, line.required)

  return (
    <li className={cn('space-y-2 px-3 py-3 sm:px-4', done && 'bg-bw-emerald-soft/20')}>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <ProductIdentity item={line} showBarcode size="md" />

        {/* Pricing, Quantity & Expand Toggle */}
        <div className="flex items-center justify-between gap-3 border-t border-bw-line/40 pt-2 sm:border-0 sm:pt-0">
          <div className="flex flex-col text-start sm:text-end">
            {line.unitPrice != null ? (
              <span className="text-bw-small font-semibold tabular-nums text-bw-ink">
                {egp(line.unitPrice)}
              </span>
            ) : null}
            <div className="flex items-center gap-2 text-[12px] text-bw-ink-soft">
              <span>
                مطلوب: <bdi className="font-semibold text-bw-ink">{line.required}</bdi>
              </span>
              <span>·</span>
              <span>
                وصل: <bdi className="font-semibold text-bw-ink">{have}</bdi>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="shrink-0 text-center" aria-label={`${have} من ${line.required}`}>
              {done ? (
                <span className="grid size-9 place-items-center rounded-full bg-bw-emerald-soft text-bw-emerald">
                  <Check className="size-4" aria-label="كملت" />
                </span>
              ) : (
                <span className="block min-w-9 text-bw-heading font-semibold tabular-nums text-bw-ink" dir="ltr">
                  {have}
                  <span className="text-bw-ink-subtle">/{line.required}</span>
                </span>
              )}
            </div>

            {hubId && orderId ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="grid size-9 place-items-center rounded-bw-field border border-bw-line text-bw-ink-soft transition-colors hover:bg-bw-sunken hover:text-bw-ink"
                title={expanded ? 'إخفاء' : 'تعديل السعر / الكمية / الباركود'}
                aria-label={expanded ? 'إخفاء' : 'تعديل السعر / الكمية / الباركود'}
                aria-expanded={expanded}
              >
                {expanded ? <ChevronUp className="size-4" /> : <Edit3 className="size-4" />}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {waiting > 0 && !done ? (
        <p className="inline-flex items-center gap-1 text-[12px] text-bw-amber">
          <Clock className="size-3.5" aria-hidden />
          مستني شراء {waiting} قطعة
        </p>
      ) : null}

      {children}

      {/* Expandable Quick Card: side-by-side compact inputs & barcode scanner */}
      {expanded && hubId && orderId ? (
        <LineQuickEdit
          line={line}
          hubId={hubId}
          orderId={orderId}
          onClose={() => setExpanded(false)}
          onChanged={() => {
            onChanged?.()
            setExpanded(false)
          }}
        />
      ) : null}
    </li>
  )
}

function LineQuickEdit({
  line,
  hubId,
  orderId,
  onClose,
  onChanged,
}: {
  line: DeskLine
  hubId: string
  orderId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [price, setPrice] = React.useState(line.unitPrice != null ? String(line.unitPrice) : '')
  const [discountPercent, setDiscountPercent] = React.useState('')
  const [qty, setQty] = React.useState(String(line.required))
  const [barcode, setBarcode] = React.useState(line.barcode ?? '')
  const [syncStorefront, setSyncStorefront] = React.useState(true)
  const [cameraOpen, setCameraOpen] = React.useState(false)
  const [statusMsg, setStatusMsg] = React.useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)

  const numPrice = Number(price) || 0
  const numDiscount = Number(discountPercent) || 0
  const finalUnitPrice =
    numDiscount > 0 ? Math.max(0, Math.round(numPrice * (1 - numDiscount / 100) * 100) / 100) : numPrice

  const saveCmd = useCommand(async () => {
    setStatusMsg(null)
    const newQty = Number(qty)
    if (!newQty || newQty < 1) {
      setStatusMsg({ tone: 'danger', text: 'الكمية لازم تكون ١ على الأقل' })
      return
    }

    // 1. Update line quantity & unit price on this order
    const priceToSet = finalUnitPrice > 0 ? finalUnitPrice : numPrice
    await api(`/fulfillment/locations/${hubId}/desk/orders/${orderId}/lines/${line.orderItemId}`, {
      method: 'PATCH',
      body: {
        quantity: newQty,
        unitPrice: priceToSet,
      },
    })

    // 2. If storefront sync is requested (checked by default), update active selling price in catalog
    if (syncStorefront && numPrice > 0) {
      await api('/commerce/prices', {
        method: 'POST',
        body: {
          skuId: line.skuId,
          amount: numPrice,
          currency: 'EGP',
        },
      }).catch(() => undefined)
    }

    // 3. If barcode changed or newly added, update SKU barcode
    const cleanBarcode = barcode.trim()
    if (cleanBarcode && cleanBarcode !== (line.barcode ?? '')) {
      await api(`/products/skus/${line.skuId}`, {
        method: 'PATCH',
        body: { barcode: cleanBarcode },
      }).catch(() => undefined)
    }

    setStatusMsg({ tone: 'ok', text: 'اتحفظت التعديلات' })
    window.setTimeout(() => {
      onChanged()
    }, 300)
  })

  return (
    <div className="mt-2 space-y-2 rounded-bw-field border border-bw-line/60 bg-bw-surface/60 p-2.5 text-start sm:p-3">
      {/* 3 Forms side-by-side even on mobile */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-bw-ink-soft">السعر (ج.م)</label>
          <input
            type="text"
            dir="ltr"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
            className="bw-control h-8 w-full rounded-bw-field border border-bw-line-field bg-bw-page px-2 text-center text-bw-small tabular-nums text-bw-ink"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-bw-ink-soft">الخصم %</label>
          <div className="relative flex items-center">
            <input
              type="text"
              dir="ltr"
              inputMode="decimal"
              placeholder="0"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value.replace(/[^\d.]/g, ''))}
              className="bw-control h-8 w-full rounded-bw-field border border-bw-line-field bg-bw-page px-2 pe-5 text-center text-bw-small tabular-nums text-bw-ink"
            />
            <span className="pointer-events-none absolute end-1.5 text-[10px] text-bw-ink-subtle">%</span>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-bw-ink-soft">الكمية</label>
          <input
            type="number"
            min="1"
            dir="ltr"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))}
            className="bw-control h-8 w-full rounded-bw-field border border-bw-line-field bg-bw-page px-2 text-center text-bw-small tabular-nums text-bw-ink"
          />
        </div>
      </div>

      {numDiscount > 0 ? (
        <p className="text-[11px] text-bw-ink-subtle">
          السعر بعد الخصم: <span className="tabular-nums font-semibold text-bw-ink">{egp(finalUnitPrice)}</span>
        </p>
      ) : null}

      {/* Barcode row: text input + quick scan button */}
      <div className="space-y-1 pt-0.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-bw-ink-soft">الباركود</span>
          {line.barcode ? <span className="font-mono text-bw-ink-subtle">{line.barcode}</span> : null}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            dir="ltr"
            inputMode="numeric"
            placeholder={line.barcode ?? 'امسح أو اكتب'}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value.replace(/\s/g, ''))}
            className="bw-control h-8 min-w-0 flex-1 rounded-bw-field border border-bw-line-field bg-bw-page px-2.5 font-mono text-bw-small text-bw-ink"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 shrink-0 gap-1 px-2.5 text-[11px]"
            onClick={() => setCameraOpen(true)}
            title="امسح الباركود بالكاميرا"
          >
            <Camera className="size-3.5" aria-hidden />
            <span>مسح</span>
          </Button>
        </div>
      </div>

      {/* Checkbox (checked by default) & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bw-line/40 pt-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-bw-ink-soft">
          <input
            type="checkbox"
            className="size-3.5 accent-bw-action"
            checked={syncStorefront}
            onChange={(e) => setSyncStorefront(e.target.checked)}
          />
          <span>تحديث السعر في المتجر</span>
        </label>

        <div className="ms-auto flex items-center gap-1.5">
          <Button size="sm" className="h-8 px-3 text-[11px]" loading={saveCmd.pending} onClick={() => void saveCmd.execute()}>
            <Save className="size-3.5" aria-hidden />
            حفظ
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-[11px]" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </div>

      {statusMsg ? <Flash tone={statusMsg.tone}>{statusMsg.text}</Flash> : null}
      {saveCmd.error ? <Flash tone="danger">{saveCmd.error.message}</Flash> : null}

      {/* Camera scanner for scanning barcode directly */}
      {cameraOpen ? (
        <CameraScanner
          onClose={() => setCameraOpen(false)}
          onCode={(scanned) => {
            setBarcode(scanned)
            setCameraOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}
