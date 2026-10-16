'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, CircleDashed, Info, Loader2, Minus, Plus, ShieldOff, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Business Workspace primitives v0.1 (GLO-230). Only what the four reference screens demonstrate.
 * Rules: pressable → pill; one filled action colour; status = icon + words (never colour alone);
 * logical properties only (ms/ps/start/end); codes, phones and quantities wrapped in <Code>.
 */

/* ── Button ─────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'onKohl'
type ButtonSize = 'md' | 'touch'

const buttonClass: Record<ButtonVariant, string> = {
  primary: 'bg-bw-action text-bw-on-action hover:bg-bw-action-hover disabled:bg-bw-sunken disabled:text-bw-ink-subtle',
  secondary: 'border border-bw-line-field bg-bw-surface text-bw-ink hover:bg-bw-sunken disabled:text-bw-ink-subtle',
  danger: 'border border-bw-danger bg-bw-danger-soft text-bw-danger hover:brightness-110',
  ghost: 'text-bw-ink hover:bg-bw-sunken',
  onKohl: 'bg-bw-on-kohl-action text-bw-on-action hover:brightness-110 disabled:opacity-60',
}

export interface BwButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }: BwButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-bw-field px-4 font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        size === 'touch' ? 'h-bw-touch text-bw-body' : 'h-bw-control text-bw-small',
        buttonClass[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}

/* ── Code: LTR-isolated identifiers, phones, quantities ───────────────── */
/* Keep a whole fraction or range ("2/3", "10:05") inside ONE <Code>; two adjacent isolates flip in RTL. */

export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return <bdi className={cn('bw-code', className)}>{children}</bdi>
}

/* ── Status label: icon + words ──────────────────────────────────────── */

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'pending'

const toneClass: Record<Tone, string> = {
  ok: 'bg-bw-ok-soft text-bw-ok',
  warn: 'bg-bw-warn-soft text-bw-warn',
  danger: 'bg-bw-danger-soft text-bw-danger',
  info: 'bg-bw-info-soft text-bw-info',
  neutral: 'bg-bw-sunken text-bw-ink',
  pending: 'bg-bw-sunken text-bw-ink-soft',
}
const toneIcon: Record<Tone, React.ElementType> = {
  ok: CheckCircle2, warn: AlertTriangle, danger: XCircle, info: Info, neutral: Info, pending: CircleDashed,
}

export function StatusLabel({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const Icon = toneIcon[tone]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-bw-small font-medium whitespace-nowrap', toneClass[tone])}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  )
}

/* ── Notice: confirmation / exception feedback ───────────────────────── */

export function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: Exclude<Tone, 'pending'>
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  const Icon = toneIcon[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-bw-card p-3', toneClass[tone])}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">{title}</p>
        {children ? <div className="text-bw-small text-bw-ink">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  )
}

/* ── Layout ──────────────────────────────────────────────────────────── */

export function PageHeader({ eyebrow, title, meta, actions }: { eyebrow?: string; title: string; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        {eyebrow ? <p className="text-bw-small text-bw-ink-soft">{eyebrow}</p> : null}
        <h1 className="font-bw-display text-bw-title font-semibold text-bw-ink">{title}</h1>
        {meta ? <div className="text-bw-small text-bw-ink-soft">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  )
}

export function Section({ title, aside, children, className }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('bw-panel', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-bw-line px-4 py-3">
          <h2 className="text-bw-heading font-semibold">{title}</h2>
          {aside}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  )
}

/* ── Field ───────────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  className,
  ltr,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; ltr?: boolean }) {
  const id = React.useId()
  const message = error ?? hint
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="block text-bw-small font-semibold text-bw-ink">
        {label}
      </label>
      <input
        id={id}
        dir={ltr ? 'ltr' : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? `${id}-msg` : undefined}
        className={cn(
          'h-bw-control w-full rounded-bw-field border bg-bw-surface px-3 text-bw-body text-bw-ink placeholder:text-bw-ink-subtle',
          ltr && 'bw-code text-start',
          error ? 'border-bw-danger' : 'border-bw-line-field',
        )}
        {...input}
      />
      {message ? (
        <p id={`${id}-msg`} className={cn('flex items-center gap-1 text-bw-small', error ? 'text-bw-danger' : 'text-bw-ink-soft')}>
          {error ? <XCircle className="size-3.5" aria-hidden /> : null}
          {message}
        </p>
      ) : null}
    </div>
  )
}

/* ── Quantity stepper (touch) ────────────────────────────────────────── */

export function Stepper({ value, max, onChange, label, disabled }: { value: number; max: number; onChange: (n: number) => void; label: string; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} dir="ltr" className="inline-flex h-bw-touch items-center rounded-full border-[1.5px] border-bw-line-field bg-bw-surface">
      <button type="button" aria-label="قلّل واحد" disabled={disabled || value <= 0} onClick={() => onChange(value - 1)} className="grid size-bw-touch place-items-center rounded-full disabled:text-bw-ink-subtle">
        <Minus className="size-5" aria-hidden />
      </button>
      <output aria-live="polite" className="min-w-10 text-center font-semibold tabular-nums">{value}</output>
      <button type="button" aria-label="زوّد واحد" disabled={disabled || value >= max} onClick={() => onChange(value + 1)} className="grid size-bw-touch place-items-center rounded-full disabled:text-bw-ink-subtle">
        <Plus className="size-5" aria-hidden />
      </button>
    </div>
  )
}

/* ── Empty / loading / error / forbidden states ──────────────────────── */

export function StateBlock({ kind, title, body, action }: { kind: 'empty' | 'error' | 'forbidden'; title: string; body?: string; action?: React.ReactNode }) {
  const Icon = kind === 'forbidden' ? ShieldOff : kind === 'error' ? XCircle : CheckCircle2
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Icon className={cn('size-8', kind === 'error' ? 'text-bw-danger' : 'text-bw-ink-subtle')} aria-hidden />
      <p className="text-bw-heading font-semibold">{title}</p>
      {body ? <p className="max-w-sm text-bw-small text-bw-ink-soft">{body}</p> : null}
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-bw-field bg-bw-sunken', className)} />
}

/* ── Design-lab only: synthetic data banner and state switcher ───────── */

export function SyntheticBanner() {
  return (
    <p className="bg-bw-warn-soft px-4 py-2 text-center text-bw-small text-bw-warn">
      مرجع تصميم ببيانات تجريبية — مش متصل بالـAPI ومش بيانات حقيقية · Design reference, synthetic data
    </p>
  )
}

export function StateSwitcher({ base, states, current }: { base: string; states: Array<{ id: string; label: string }>; current: string }) {
  return (
    <nav aria-label="حالات الشاشة" className="flex flex-wrap gap-2">
      {states.map((state) => (
        <Link
          key={state.id}
          href={`${base}?state=${state.id}`}
          aria-current={state.id === current ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-8 items-center rounded-full border-[1.5px] px-3 text-bw-small',
            state.id === current ? 'border-bw-ink bg-bw-ink font-semibold text-bw-surface' : 'border-bw-line-field bg-bw-surface',
          )}
        >
          {state.label}
        </Link>
      ))}
    </nav>
  )
}

/* ── Money: EGP amounts, Western digits, isolated so they never reorder ─ */

export function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('whitespace-nowrap', className)}>
      <Code>{value.toLocaleString('en-US')}</Code> ج.م
    </span>
  )
}

/* ── Queue row: one actionable item in an attention list ─────────────── */

export function QueueRow({
  tone,
  title,
  detail,
  meta,
  action,
  selected,
}: {
  tone: Tone
  title: React.ReactNode
  detail?: React.ReactNode
  meta?: React.ReactNode
  action?: React.ReactNode
  selected?: boolean
}) {
  const Icon = toneIcon[tone]
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-bw-line px-4 py-3 last:border-b-0',
        selected && 'bg-bw-action-soft',
      )}
    >
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', toneClass[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {detail ? <p className="text-bw-small text-bw-ink-soft">{detail}</p> : null}
      </div>
      {meta ? <div className="text-bw-small text-bw-ink-soft">{meta}</div> : null}
      {action}
    </li>
  )
}

/* ── Dialog / drawer: native <dialog> gives focus trap, Esc and inert page ─ */

export function useDialog() {
  const ref = React.useRef<HTMLDialogElement>(null)
  return {
    ref,
    open: () => ref.current?.showModal(),
    close: () => ref.current?.close(),
  }
}

export function Dialog({
  dialogRef,
  title,
  children,
  footer,
  variant = 'dialog',
  onClose,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  variant?: 'dialog' | 'drawer' | 'sheet'
  onClose?: () => void
}) {
  const titleId = React.useId()
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className={cn(
        'bw-dialog border border-bw-line bg-bw-surface text-bw-ink shadow-bw-overlay backdrop:bg-black/70',
        variant === 'dialog' && 'm-auto w-[min(32rem,calc(100%-2rem))] rounded-bw-card',
        variant === 'drawer' && 'ms-auto me-0 h-dvh max-h-dvh w-[min(28rem,100%)] max-w-full',
        variant === 'sheet' && 'mx-auto mb-0 mt-auto max-h-[85dvh] w-full max-w-md rounded-t-bw-card',
      )}
    >
      <div className="flex max-h-[inherit] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-bw-line px-4 py-3">
          <h2 id={titleId} className="text-bw-heading font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={() => dialogRef.current?.close()}
            className="grid size-bw-control place-items-center rounded-full hover:bg-bw-sunken"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-bw-line px-4 py-3">{footer}</div> : null}
      </div>
    </dialog>
  )
}

/* ── Data table: dense desktop rows, sticky header, numeric columns LTR ─ */

export function DataTable({ caption, head, children }: { caption: string; head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-start">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-bw-sunken text-bw-small text-bw-ink-soft">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 text-start font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-bw-line [&_td]:px-3 [&_td]:py-2.5">{children}</tbody>
      </table>
    </div>
  )
}

/* ── Thermal label preview (100 × 150 mm) ────────────────────────────── */

export function LabelPreview({ code, lines }: { code: string; lines: Array<[string, React.ReactNode]> }) {
  return (
    <figure aria-label="معاينة بوليصة الشحن" className="mx-auto aspect-[2/3] w-56 bg-white p-3 text-black shadow-sm ring-1 ring-bw-line">
      <div aria-hidden className="flex h-16 items-stretch gap-px" dir="ltr">
        {code.split('').map((ch, i) => (
          <span key={i} className="bg-black" style={{ width: `${(ch.charCodeAt(0) % 3) + 1}px`, marginInlineEnd: `${(ch.charCodeAt(0) % 2) + 1}px` }} />
        ))}
      </div>
      <p className="mt-1 text-center text-bw-small font-semibold">
        <Code>{code}</Code>
      </p>
      <dl className="mt-3 space-y-1 text-bw-small">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-t border-black/20 pt-1">
            <dt>{k}</dt>
            <dd className="font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </figure>
  )
}

/* ── Design-lab notes: reusable vs role-specific, open questions ───────── */

export function DesignNotes({ reusable, specific, open }: { reusable: string[]; specific: string[]; open?: string[] }) {
  return (
    <details className="rounded-bw-card border border-bw-line bg-bw-surface p-4 text-bw-small">
      <summary className="cursor-pointer font-semibold">ملاحظات التصميم · Design notes</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <div>
          <p className="font-semibold">نمط مشترك</p>
          <ul className="list-disc ps-5 text-bw-ink-soft">{reusable.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
        <div>
          <p className="font-semibold">خاص بالدور</p>
          <ul className="list-disc ps-5 text-bw-ink-soft">{specific.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
        {open?.length ? (
          <div>
            <p className="font-semibold">أسئلة مفتوحة للمالك</p>
            <ul className="list-disc ps-5 text-bw-ink-soft">{open.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </details>
  )
}
