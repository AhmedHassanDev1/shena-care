'use client'

import * as React from 'react'
import { Barcode, ExternalLink, Package } from 'lucide-react'
import { shortId } from '@/lib/labels'
import { categoryLabel, productUrl, purchaseLineName, textureLabel } from '@/lib/purchase-batch'
import { cn } from '@/lib/utils'

export const tagTone = {
  violet: 'bg-bw-violet-soft text-bw-violet border-bw-violet/25',
  amber: 'bg-bw-amber-soft text-bw-amber border-bw-amber/25',
  cobalt: 'bg-bw-cobalt-soft text-bw-cobalt border-bw-cobalt/25',
  emerald: 'bg-bw-emerald-soft text-bw-emerald border-bw-emerald/25',
  neutral: 'bg-bw-sunken text-bw-ink-soft border-bw-line',
} as const

export function Tag({ tone, children, className }: { tone: keyof typeof tagTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 text-[11px] font-semibold leading-5', tagTone[tone], className)}>
      {children}
    </span>
  )
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')
export const imageSrc = (url: string | null | undefined) => {
  if (!url) return null
  const stored = url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+(\/storage\/.*)$/)
  if (stored) return `${API_URL}${stored[1]}`
  return url.startsWith('/') ? `${API_URL}${url}` : url
}

export interface StandardProductItem {
  skuId?: string
  productName?: string | null
  brandName?: string | null
  variantName?: string | null
  size?: number | string | null
  sizeUnit?: string | null
  packCount?: number | null
  texture?: string | null
  categoryName?: string | null
  imageUrl?: string | null
  productSlug?: string | null
  skuCode?: string | null
  barcode?: string | null
}

export function ProductIdentity({
  item,
  size = 'md',
  showBarcode = false,
  className,
}: {
  item: StandardProductItem
  size?: 'sm' | 'md' | 'lg'
  showBarcode?: boolean
  className?: string
}) {
  const lineInput = {
    productName: item.productName ?? null,
    brandName: item.brandName ?? null,
    variantName: item.variantName ?? null,
    size: item.size != null ? Number(item.size) || null : null,
    sizeUnit: item.sizeUnit ?? null,
    packCount: item.packCount ?? null,
  }
  const name = purchaseLineName(lineInput)
  const texture = textureLabel(item.texture)
  const category = categoryLabel(item.categoryName)
  const href = productUrl({ productSlug: item.productSlug ?? null, skuId: item.skuId ?? '' })
  const [broken, setBroken] = React.useState(false)
  const imageRef = React.useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth === 0) setBroken(true)
  }, [])

  const box = size === 'lg' ? 'size-16 sm:size-20' : size === 'sm' ? 'size-10' : 'size-12 sm:size-14'
  const src = imageSrc(item.imageUrl)

  const title = (
    <bdi>
      {name.brand ? (
        <>
          <strong className="font-bold text-bw-ink">{name.brand}</strong>{' '}
        </>
      ) : null}
      <span className="font-medium text-bw-ink">{name.name || (item.skuCode ?? shortId(item.skuId ?? ''))}</span>
    </bdi>
  )

  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3', className)}>
      {src && !broken ? (
        <img
          ref={imageRef}
          src={src}
          alt={name.full}
          loading="lazy"
          onError={() => setBroken(true)}
          className={cn(box, 'shrink-0 rounded-bw-field border border-bw-line bg-bw-surface object-cover')}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            box,
            'flex shrink-0 items-center justify-center rounded-bw-field border border-bw-line bg-bw-sunken text-bw-ink-subtle'
          )}
        >
          <Package className={size === 'lg' ? 'size-7' : 'size-5'} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-bw-body leading-5">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`فتح صفحة ${name.full}`}
              title="فتح صفحة المنتج"
              className="group/link hover:underline hover:underline-offset-4"
            >
              {title}
              <ExternalLink className="ms-1.5 inline size-3.5 align-[-1px] text-bw-ink-subtle transition-colors group-hover/link:text-bw-ink" aria-hidden />
            </a>
          ) : (
            title
          )}
        </h3>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {category ? <Tag tone="violet"><bdi>{category}</bdi></Tag> : null}
          {texture ? <Tag tone="amber"><bdi>{texture}</bdi></Tag> : null}
          {name.tags.map((tag) => (
            <Tag key={tag} tone="cobalt"><bdi>{tag}</bdi></Tag>
          ))}
          {showBarcode && (
            item.barcode ? (
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-bw-ink-subtle">
                <Barcode className="size-3" aria-hidden />
                <bdi>{item.barcode}</bdi>
              </span>
            ) : (
              <Tag tone="neutral">ملوش باركود</Tag>
            )
          )}
        </div>
      </div>
    </div>
  )
}
