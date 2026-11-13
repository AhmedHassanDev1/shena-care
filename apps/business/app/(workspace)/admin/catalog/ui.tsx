'use client'

import * as React from 'react'
import { AlertCircle, ImageOff, Search } from 'lucide-react'
import { useAuthedImage } from '@/lib/authed-image'
import { cn } from '@/lib/utils'
import { CatalogMedia, adminMediaPath, mediaHiddenLabel } from './catalog-model'

const DEFAULT_API_URL = 'http://localhost:3001'

export function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const base = (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '')
  return url.startsWith('/') ? `${base}${url}` : url
}

/**
 * Product image. Images the storefront serves load directly; images it does not serve yet (draft products, a review
 * that no longer matches the SKU) are previewed through the Admin-only route, so a draft never looks "broken".
 */
export function Thumb({ media, alt, size = 'sm' }: { media: CatalogMedia | undefined; alt: string; size?: 'sm' | 'lg' }) {
  const viaAdmin = media && !media.publiclyServed ? adminMediaPath(media.id) : null
  const authed = useAuthedImage(viaAdmin)
  const direct = media && media.publiclyServed ? absoluteUrl(media.url) : null
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [direct])
  const src = direct && !failed ? direct : authed
  const dims = size === 'lg' ? 'size-28 rounded-bw-card' : 'size-12 rounded-bw-field'
  const hidden = mediaHiddenLabel(media?.hiddenReason)
  return (
    <span
      title={hidden ?? undefined}
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden border',
        src ? 'border-bw-line bg-bw-veil-2' : failed ? 'border-bw-rose/30 bg-bw-rose-soft' : 'border-dashed border-bw-line-field/50 bg-gradient-to-br from-bw-veil-2 to-transparent',
        dims,
      )}
    >
      {src ? (
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="size-full object-contain p-0.5" />
      ) : failed ? (
        <AlertCircle className={cn('text-bw-rose', size === 'lg' ? 'size-7' : 'size-4')} aria-label="تعذر تحميل الصورة" />
      ) : (
        <span className="flex flex-col items-center gap-1 text-bw-ink-subtle">
          <ImageOff className={size === 'lg' ? 'size-7' : 'size-4'} aria-label="بلا صورة" />
          {size === 'lg' ? <span className="text-[11px]">بلا صورة</span> : null}
        </span>
      )}
    </span>
  )
}

export { RowMenu, type MenuAction } from '@/components/bw/ops'

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <label className="relative min-w-40 flex-1 sm:max-w-sm">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-bw-ink-subtle" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bw-control h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface pe-3 ps-9 text-bw-small text-bw-ink placeholder:text-bw-ink-subtle"
      />
    </label>
  )
}

export function Dot({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted'; children: React.ReactNode }) {
  const color = { ok: 'bg-bw-emerald', warn: 'bg-bw-amber', danger: 'bg-bw-rose', info: 'bg-bw-cobalt', muted: 'bg-bw-ink-subtle' }[tone]
  return (
    <span className="inline-flex items-center gap-2 text-bw-small">
      <span className={cn('size-2 shrink-0 rounded-full', color)} aria-hidden />
      {children}
    </span>
  )
}

export function Banner({ tone, children, onClose }: { tone: 'ok' | 'danger'; children: React.ReactNode; onClose?: () => void }) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-center justify-between gap-3 rounded-bw-field border px-3.5 py-2 text-bw-small text-bw-ink',
        tone === 'ok' ? 'border-bw-emerald/30 bg-bw-emerald-soft' : 'border-bw-rose/30 bg-bw-rose-soft',
      )}
    >
      <span>{children}</span>
      {onClose ? <button type="button" onClick={onClose} className="shrink-0 text-bw-ink-soft underline">إخفاء</button> : null}
    </p>
  )
}

/** A native <textarea> with the same look as Field. */
export function TextBlock({ label, value, onChange, rows = 3, ltr, hint }: { label: string; value: string; onChange: (value: string) => void; rows?: number; ltr?: boolean; hint?: string }) {
  const id = React.useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-bw-small font-semibold text-bw-ink">{label}</label>
      <textarea
        id={id}
        rows={rows}
        dir={ltr ? 'ltr' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-bw-field border border-bw-line-field bg-bw-surface p-3 text-bw-small text-bw-ink focus:border-bw-action focus:outline-none"
      />
      {hint ? <p className="text-bw-small text-bw-ink-soft">{hint}</p> : null}
    </div>
  )
}
