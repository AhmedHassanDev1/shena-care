'use client'

import * as React from 'react'
import { Check, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type DeskLine, imageSrc, productMeta, productTitle } from './model'

/** The product photo from the catalog; without one the product's first letters stand in (never a drawn product). */
export function Thumb({ line, size = 'md' }: { line: DeskLine; size?: 'md' | 'lg' }) {
  const [broken, setBroken] = React.useState(false)
  const src = imageSrc(line.imageUrl)
  const box = size === 'lg' ? 'size-24' : 'size-14'
  if (!src || broken) {
    return <span aria-hidden className={cn(box, 'grid shrink-0 place-items-center rounded-bw-field bg-bw-sunken text-bw-heading font-semibold text-bw-ink-subtle')}>{productTitle(line).slice(0, 1)}</span>
  }
  // eslint-disable-next-line @next/next/no-img-element -- catalog photos come from arbitrary hosts and the CDN; no fixed dimensions to optimise
  return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={cn(box, 'shrink-0 rounded-bw-field bg-white object-contain')} />
}

/** One order line: photo, name, brand · size · variant and how many of the ordered units are physically in. */
export function ProductRow({ line, pending = 0, children }: { line: DeskLine; pending?: number; children?: React.ReactNode }) {
  const done = line.received >= line.required
  const waiting = Math.max(line.required - line.purchased, 0)
  const have = Math.min(line.received + pending, line.required)
  return (
    <li className={cn('flex items-center gap-3 px-4 py-3', done && 'bg-bw-emerald-soft/30')}>
      <Thumb line={line} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-bw-body font-semibold text-bw-ink"><bdi>{productTitle(line)}</bdi></p>
        <p className="line-clamp-2 text-bw-small text-bw-ink-soft"><bdi>{productMeta(line)}</bdi></p>
        {waiting > 0 && !done ? <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-bw-amber"><Clock className="size-3.5" aria-hidden />مستني شراء {waiting} قطعة</p> : null}
        {children}
      </div>
      <div className="shrink-0 text-center" aria-label={`${have} من ${line.required}`}>
        {done
          ? <span className="grid size-10 place-items-center rounded-full bg-bw-emerald-soft text-bw-emerald"><Check className="size-5" aria-label="كملت" /></span>
          : <span className="block min-w-10 text-bw-heading font-semibold tabular-nums text-bw-ink" dir="ltr">{have}<span className="text-bw-ink-subtle">/{line.required}</span></span>}
      </div>
    </li>
  )
}
