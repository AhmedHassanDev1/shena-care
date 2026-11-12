'use client'

import * as React from 'react'
import { AlertCircle, Clock, ImageOff } from 'lucide-react'
import { ProductMediaStatus, resolveCatalogMediaUrl } from './catalog-helpers'

export * from './catalog-helpers'

export function CatalogThumbnail({
  url,
  alt,
  mediaStatus,
  size = 'sm',
}: {
  url: string | null | undefined
  alt: string
  mediaStatus?: ProductMediaStatus
  size?: 'sm' | 'md' | 'lg'
}) {
  const resolved = resolveCatalogMediaUrl(url)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [resolved])

  const dims =
    size === 'lg'
      ? 'h-48 w-full rounded-bw-card'
      : size === 'md'
        ? 'size-16 rounded-bw-field'
        : 'size-11 rounded-bw-field'

  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden border border-bw-line bg-bw-sunken ${dims}`}
    >
      {resolved && !failed ? (
        <img
          src={resolved}
          alt={alt}
          onError={() => setFailed(true)}
          className="size-full object-contain"
        />
      ) : failed ? (
        <span
          className="flex flex-col items-center gap-0.5 px-1 text-center text-bw-rose"
          title="تعذر تحميل الصورة من الخادم"
        >
          <AlertCircle className={size === 'lg' ? 'size-6' : 'size-3.5'} aria-hidden />
          <span className="text-[9px] font-semibold">تعذر التحميل</span>
        </span>
      ) : mediaStatus === 'PENDING_REVIEW' ? (
        <span className="flex flex-col items-center gap-0.5 px-1 text-center text-bw-amber">
          <Clock className={size === 'lg' ? 'size-6' : 'size-3.5'} aria-hidden />
          <span className="text-[9px] font-semibold">قيد المراجعة</span>
        </span>
      ) : (
        <span className="flex flex-col items-center gap-0.5 px-1 text-center text-bw-ink-subtle">
          <ImageOff className={size === 'lg' ? 'size-6' : 'size-3.5'} aria-hidden />
          <span className="text-[9px]">بلا صورة</span>
        </span>
      )}
    </span>
  )
}
