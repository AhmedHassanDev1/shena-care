'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, MoreVertical, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Ops layer on top of the bw primitives: the pieces every operational page repeats.
 * One vocabulary: Segmented (filters), StatStrip/Stat (what needs me), Meter/BarList (progress), Toolbar (floating controls).
 * Colour only ever repeats a state that words also carry.
 */

export type OpsTone = 'neutral' | 'cobalt' | 'emerald' | 'amber' | 'rose' | 'violet'

export const toneDot: Record<OpsTone, string> = {
  neutral: 'bg-bw-ink-subtle',
  cobalt: 'bg-bw-cobalt',
  emerald: 'bg-bw-emerald',
  amber: 'bg-bw-amber',
  rose: 'bg-bw-rose',
  violet: 'bg-bw-violet',
}
export const toneText: Record<OpsTone, string> = {
  neutral: 'text-bw-ink',
  cobalt: 'text-bw-cobalt',
  emerald: 'text-bw-emerald',
  amber: 'text-bw-amber',
  rose: 'text-bw-rose',
  violet: 'text-bw-violet',
}

/* ── Segmented: one-of-many filter, with live counts ─────────────────── */

export function Segmented<T extends string>({ items, value, onChange, label, className }: {
  items: Array<{ value: T; label: string; count?: number }>
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      {items.map((item) => {
        const on = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-bw-field border px-3 text-bw-small transition-[color,background-color,border-color] duration-150',
              on
                ? 'border-bw-veil-4 bg-bw-veil-3 font-semibold text-bw-ink shadow-bw-sheen'
                : 'border-transparent text-bw-ink-soft hover:bg-bw-veil-2 hover:text-bw-ink',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums', on ? 'bg-bw-veil-4 text-bw-ink' : 'text-bw-ink-subtle')}>
                <bdi className="bw-code">{item.count}</bdi>
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/* ── Toolbar: floating glass strip for search + filters ───────────────── */

export function Toolbar({ children, className, sticky = true }: { children: React.ReactNode; className?: string; sticky?: boolean }) {
  return (
    <div className={cn('bw-glass z-10 flex flex-wrap items-center gap-2 rounded-bw-card p-2', sticky && 'sticky top-16 lg:top-3', className)}>
      {children}
    </div>
  )
}

export function SearchField({ value, onChange, label, placeholder, onSubmit, className }: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  onSubmit?: () => void
  className?: string
}) {
  return (
    <form
      role="search"
      className={cn('relative min-w-44 flex-1 sm:max-w-md', className)}
      onSubmit={(event) => { event.preventDefault(); onSubmit?.() }}
    >
      <label className="sr-only" htmlFor={`search-${label}`}>{label}</label>
      <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-bw-ink-subtle" aria-hidden />
      <input
        id={`search-${label}`}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="bw-control h-10 w-full rounded-bw-field border border-bw-line bg-bw-page/60 pe-9 ps-9 text-bw-small text-bw-ink placeholder:text-bw-ink-subtle [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" aria-label="مسح البحث" onClick={() => onChange('')} className="absolute inset-y-0 end-1.5 my-auto grid size-7 place-items-center rounded-full text-bw-ink-subtle transition-colors hover:bg-bw-veil-4 hover:text-bw-ink">
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </form>
  )
}

export function FilterSelect({ label, value, onChange, options, className }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  className?: string
}) {
  const id = React.useId()
  return (
    <div className={cn('relative min-w-0 grow basis-[45%] sm:grow-0 sm:basis-auto', className)}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'bw-control h-10 w-full truncate rounded-bw-field border bg-bw-page/60 px-3 text-bw-small sm:w-auto sm:max-w-52',
          value ? 'border-bw-cobalt/50 text-bw-ink' : 'border-bw-line text-bw-ink-soft',
        )}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}

/* ── Stat strip: what needs me, in one panel with hairline dividers ───── */

export function StatStrip({ children, className, columns = 5 }: { children: React.ReactNode; className?: string; columns?: 3 | 4 | 5 }) {
  return (
    <div
      className={cn(
        'bw-panel grid grid-cols-2 gap-px overflow-hidden bg-bw-line',
        '[&>*:last-child:nth-child(odd)]:col-span-2',
        columns === 5 && 'lg:grid-cols-5 lg:[&>*:last-child:nth-child(odd)]:col-span-1',
        columns === 4 && 'lg:grid-cols-4 lg:[&>*:last-child:nth-child(odd)]:col-span-1',
        columns === 3 && 'sm:grid-cols-3 sm:[&>*:last-child:nth-child(odd)]:col-span-1',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Stat({ label, value, unit, hint, tone = 'neutral', href, loading }: {
  label: React.ReactNode
  value: number | string
  unit?: string
  hint?: React.ReactNode
  tone?: OpsTone
  href?: string
  loading?: boolean
}) {
  const quiet = value === 0 || value === '0'
  const body = (
    <>
      <span className="flex items-center gap-2 text-bw-small text-bw-ink-soft">
        <span aria-hidden className={cn('size-1.5 rounded-full', quiet ? 'bg-bw-line-field' : toneDot[tone])} />
        <span className="truncate">{label}</span>
        {href ? <ArrowLeft aria-hidden className="ms-auto size-3.5 shrink-0 -translate-x-0.5 text-bw-ink-subtle opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100" /> : null}
      </span>
      {loading ? (
        <span className="bw-skeleton mt-3 block h-7 w-16" aria-hidden />
      ) : (
        <span className="mt-2.5 flex items-baseline gap-1.5">
          <span className={cn('text-[1.75rem] font-semibold leading-none tabular-nums', quiet ? 'text-bw-ink-soft' : tone === 'neutral' ? 'text-bw-ink' : toneText[tone])}>
            <bdi className="bw-code">{value}</bdi>
          </span>
          {unit ? <span className="text-bw-small text-bw-ink-subtle">{unit}</span> : null}
        </span>
      )}
      {hint ? <span className="mt-2 hidden truncate text-[11px] text-bw-ink-subtle sm:block">{hint}</span> : null}
    </>
  )
  const cls = 'group block min-w-0 bg-bw-surface p-3.5 sm:p-4'
  return href ? (
    <Link href={href} className={cn(cls, 'bw-row transition-colors hover:bg-bw-sunken focus-visible:outline-offset-[-2px]')}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/* ── Meter / BarList: progress and ranking, drawn from real numbers ───── */

export function Meter({ value, max, tone = 'cobalt', label, className }: { value: number; max: number; tone?: OpsTone; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn('h-1.5 overflow-hidden rounded-full bg-bw-veil-3', className)}
    >
      <div className={cn('bw-meter-fill h-full rounded-full', toneDot[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function BarList({ items, formatValue, emptyLabel }: {
  items: Array<{ key: string; label: string; value: number; tone?: OpsTone; href?: string; hint?: string }>
  formatValue?: (value: number) => React.ReactNode
  emptyLabel?: string
}) {
  const max = Math.max(...items.map((item) => item.value), 0)
  if (max === 0) return emptyLabel ? <p className="py-6 text-center text-bw-small text-bw-ink-subtle">{emptyLabel}</p> : null
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const row = (
          <>
            <span className="flex items-center justify-between gap-3 text-bw-small">
              <span className={cn('truncate', item.value === 0 ? 'text-bw-ink-subtle' : 'text-bw-ink')}>{item.label}</span>
              <span className="shrink-0 tabular-nums text-bw-ink-soft">{formatValue ? formatValue(item.value) : <bdi className="bw-code">{item.value}</bdi>}</span>
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-bw-veil-3">
              <span className={cn('bw-meter-fill block h-full rounded-full', toneDot[item.tone ?? 'cobalt'])} style={{ width: `${max ? (item.value / max) * 100 : 0}%` }} />
            </span>
          </>
        )
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} title={item.hint} className="bw-row -mx-2 block rounded-bw-field px-2 py-1.5">{row}</Link>
            ) : (
              <div title={item.hint} className="-mx-2 px-2 py-1.5">{row}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ── Panel head: compact title row used inside custom panels ─────────── */

export function PanelHead({ title, aside, className }: { title: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-12 items-center justify-between gap-3 border-b border-bw-line px-4 py-2.5', className)}>
      <h2 className="text-bw-body font-semibold text-bw-ink">{title}</h2>
      {aside}
    </div>
  )
}

/* ── Inline result line: immediate feedback that fades in ────────────── */

export function Flash({ tone, children }: { tone: 'ok' | 'warn' | 'danger'; children: React.ReactNode }) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'bw-arrive flex items-center gap-2 rounded-bw-field border px-3 py-2 text-bw-small',
        tone === 'ok' && 'border-bw-emerald/30 bg-bw-emerald-soft text-bw-ink',
        tone === 'warn' && 'border-bw-amber/30 bg-bw-amber-soft text-bw-ink',
        tone === 'danger' && 'border-bw-rose/30 bg-bw-rose-soft text-bw-ink',
      )}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', tone === 'ok' ? 'bg-bw-emerald' : tone === 'warn' ? 'bg-bw-amber' : 'bg-bw-rose')} />
      {children}
    </p>
  )
}

/* ── Row menu: always-visible trigger, Esc / outside click close it, every item a real button ─ */

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
        <div role="menu" className="bw-glass-raised absolute end-0 top-full z-30 mt-1 min-w-52 overflow-hidden rounded-bw-card p-1">
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

