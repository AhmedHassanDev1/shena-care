'use client'

import * as React from 'react'
import { Toast, type Tone } from '@/components/bw/primitives'

/*
 * One global, single-slot toast.
 *   · Only ONE toast is ever on screen. A new one replaces the current one at once — never stacked, never queued.
 *   · Every toast carries a sequence number; a dismiss timer only acts on the toast that armed it, so a stale
 *     timeout can never hide a newer message.
 *   · Temporary feedback only. Business-critical state (cash differences, unresolved orders, missing configuration)
 *     stays inline where the work continues.
 *   · Announced through two always-mounted live regions (polite / assertive); Esc dismisses; hover and focus pause the timer.
 */

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface ToastOptions {
  /** Second line, shown smaller. */
  detail?: React.ReactNode
  /** One follow-up such as «حاول تاني»; the toast then stays longer so it can be used. */
  action?: { label: string; onSelect: () => void }
  /** Override the auto-dismiss time in ms. */
  duration?: number
}

interface ToastState {
  seq: number
  kind: ToastKind
  message: string
  options: ToastOptions
}

interface ToastApi {
  show: (kind: ToastKind, message: string, options?: ToastOptions) => void
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
  warning: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  dismiss: () => void
}

const TONE: Record<ToastKind, Exclude<Tone, 'pending'>> = { success: 'ok', error: 'danger', warning: 'warn', info: 'info' }
const DURATION: Record<ToastKind, number> = { success: 2800, info: 3500, warning: 6000, error: 8000 }
const ACTION_DURATION = 10000

/** Outside a provider (design-reference pages) toasts are simply not shown; nothing throws. */
const NO_TOASTS: ToastApi = { show() {}, success() {}, error() {}, warning() {}, info() {}, dismiss() {} }

const ToastContext = React.createContext<ToastApi>(NO_TOASTS)

export function useToast(): ToastApi {
  return React.useContext(ToastContext)
}

/**
 * A sticky bar that sits where the toast would (e.g. the settings save bar) registers its height here, so the toast rises above it
 * instead of covering it. Pass the element's ref and whether it is currently shown.
 */
export function useToastLift(ref: React.RefObject<HTMLElement | null>, active: boolean, phoneOnly = false) {
  React.useEffect(() => {
    const node = ref.current
    if (!active || !node) return
    const root = document.documentElement
    const apply = () => {
      const docked = phoneOnly && window.matchMedia('(min-width: 1024px)').matches // inline on desktop: nothing to avoid
      root.style.setProperty('--bw-toast-lift', docked ? '0px' : `${Math.ceil(node.getBoundingClientRect().height) + 16}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => { observer.disconnect(); root.style.removeProperty('--bw-toast-lift') }
  }, [ref, active, phoneOnly])
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = React.useState<ToastState | null>(null)
  const seq = React.useRef(0)
  const timer = React.useRef<number | undefined>(undefined)
  const paused = React.useRef(false)

  const clearTimer = React.useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = undefined
  }, [])

  const dismiss = React.useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const arm = React.useCallback((id: number, ms: number) => {
    clearTimer()
    timer.current = window.setTimeout(() => {
      // A newer toast has taken the slot: this timer is stale and must not touch it.
      if (seq.current !== id) return
      setToast(null)
    }, ms)
  }, [clearTimer])

  const show = React.useCallback((kind: ToastKind, message: string, options: ToastOptions = {}) => {
    const id = ++seq.current
    paused.current = false
    setToast({ seq: id, kind, message, options })
    arm(id, options.duration ?? (options.action ? ACTION_DURATION : DURATION[kind]))
  }, [arm])

  React.useEffect(() => clearTimer, [clearTimer])

  React.useEffect(() => {
    if (!toast) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toast, dismiss])

  const api = React.useMemo<ToastApi>(() => ({
    show,
    success: (message, options) => show('success', message, options),
    error: (message, options) => show('error', message, options),
    warning: (message, options) => show('warning', message, options),
    info: (message, options) => show('info', message, options),
    dismiss,
  }), [show, dismiss])

  const pause = () => { paused.current = true; clearTimer() }
  const resume = () => {
    if (!toast || !paused.current) return
    paused.current = false
    // Give the reader a fresh, shorter window after hovering away.
    arm(toast.seq, 2500)
  }

  const live = toast ? `${toast.message}${typeof toast.options.detail === 'string' ? `. ${toast.options.detail}` : ''}` : ''
  const assertive = toast?.kind === 'error'

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{assertive ? '' : live}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{assertive ? live : ''}</div>
      {toast ? <ToastSlot key={toast.seq} toast={toast} onDismiss={dismiss} onPause={pause} onResume={resume} /> : null}
    </ToastContext.Provider>
  )
}

/**
 * Rendered as a manual popover so it sits in the top layer: it stays above open dialogs and sheets, and never
 * competes with the mobile bottom navigation for z-index.
 */
function ToastSlot({ toast, onDismiss, onPause, onResume }: { toast: ToastState; onDismiss: () => void; onPause: () => void; onResume: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const node = ref.current
    try { node?.showPopover?.() } catch { /* already shown or unsupported: the fixed positioning still applies */ }
  }, [])
  const { action } = toast.options
  return (
    <div
      ref={ref}
      popover="manual"
      data-bw-toast=""
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocusCapture={onPause}
      onBlurCapture={onResume}
      className="bw-toast"
    >
      <Toast
        tone={TONE[toast.kind]}
        title={toast.message}
        onClose={onDismiss}
        action={action ? { label: action.label, onSelect: () => { onDismiss(); action.onSelect() } } : undefined}
      >
        {toast.options.detail}
      </Toast>
    </div>
  )
}
