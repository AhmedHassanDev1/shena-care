'use client'

import * as React from 'react'
import { Check, Clock } from 'lucide-react'
import { ProductIdentity } from '@/components/bw/product-card'
import { egp } from '@/components/workspace/buy-costs'
import { cn } from '@/lib/utils'
import { type DeskLine, imageSrc, productTitle } from './model'

/** The product photo from the catalog; without one the product's first letters stand in (never a drawn product). */
export function Thumb({ line, size = 'md' }: { line: DeskLine; size?: 'md' | 'lg' | 'xl' }) {
  const [broken, setBroken] = React.useState(false)
  const src = imageSrc(line.imageUrl)
  const img = React.useRef<HTMLImageElement>(null)
  // A photo that already failed before this component hydrated never fires onError: check it once mounted.
  React.useEffect(() => { const el = img.current; if (el && el.complete && el.naturalWidth === 0) setBroken(true) }, [src])
  const box = size === 'xl' ? 'size-48' : size === 'lg' ? 'size-20 sm:size-24' : 'size-12 sm:size-14'
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
      ref={img}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className={cn(box, 'shrink-0 rounded-bw-field border border-bw-line bg-bw-surface', size === 'xl' ? 'object-contain' : 'object-cover')}
    />
  )
}

/**
 * Standardized order line card:
 * - Product identity identical to purchases (bold brand, name, category, texture, size tags, barcode)
 * - Selling price & required vs received quantities clearly displayed beside the item
 */
export function ProductRow({
  line,
  pending = 0,
  children,
}: {
  line: DeskLine
  pending?: number
  children?: React.ReactNode
}) {
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

    </li>
  )
}
