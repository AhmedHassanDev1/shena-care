'use client'

import * as React from 'react'
import { AlertCircle, ImageOff, MoreVertical, Search } from 'lucide-react'
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
  const dims = size === 'lg' ? 'size-28 rounded-bw-card' : 'size-10 rounded-bw-field'
  const hidden = mediaHiddenLabel(media?.hiddenReason)
  return (
    <span
      title={hidden ?? undefined}
      className={cn('grid shrink-0 place-items-center overflow-hidden bg-bw-sunken', dims)}
    >
      {src ? (
        <img src={src} alt={alt} onError={() => setFailed(true)} className="size-full object-contain" />
      ) : failed ? (
        <AlertCircle className="size-4 text-bw-rose" aria-label="تعذر تحميل الصورة" />
      ) : (
        <ImageOff className="size-4 text-bw-ink-subtle" aria-label="بلا صورة" />
      )}
    </span>
  )
}

export interface MenuAction {
  label: string
  icon?: React.ElementType
  onSelect: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

/** Small dropdown. Always-visible trigger, Esc / outside click close it, every item is a real button. */
export function RowMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((v) => !v)
        }}
        className="grid size-9 place-items-center rounded-bw-field text-bw-ink-soft transition-colors hover:bg-bw-sunken hover:text-bw-ink"
      >
        <MoreVertical className="size-4" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute end-0 top-full z-30 mt-1 min-w-52 overflow-hidden rounded-bw-card border border-bw-line bg-bw-surface p-1 shadow-bw-overlay">
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                  action.onSelect()
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-bw-field px-3 py-2 text-start text-bw-small transition-colors hover:bg-bw-sunken disabled:cursor-not-allowed disabled:opacity-50',
                  action.tone === 'danger' ? 'text-bw-rose' : 'text-bw-ink',
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0 text-bw-ink-soft" aria-hidden /> : null}
                {action.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

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
        className="h-bw-control w-full rounded-bw-field border border-bw-line-field bg-bw-surface pe-3 ps-9 text-bw-small text-bw-ink placeholder:text-bw-ink-subtle focus:border-bw-cobalt focus:outline-none"
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
