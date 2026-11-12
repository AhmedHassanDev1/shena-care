"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { buttonVariants } from "./button-variants"
import { Icon } from "./icon"
import { Spinner, type SpinnerSize } from "./spinner"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, "state"> {
  asChild?: boolean
  /**
   * The request this button started is in flight: Shutter Loading pending state (aria-busy + aria-disabled, clicks
   * ignored, same box). For the full idle/pending/success/error cycle use AsyncButton. Not supported with `asChild`.
   */
  loading?: boolean
  /** Label while `loading` («بنبعت الكود…»); defaults to the idle label. */
  pendingLabel?: React.ReactNode
  /** Waiting on server state / cart membership / price quotes (spinner resolving animation). */
  resolving?: boolean
  /** Custom label while `resolving`; defaults to localized loading. */
  resolvingLabel?: React.ReactNode
}

/** SAHEL button. Pass `loading` or `resolving` while it waits on the server; shows Sahel Spinner. */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, loading = false, pendingLabel, resolving = false, resolvingLabel, onClick, children, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} onClick={onClick} {...props}>
          {children}
        </Slot>
      )
    }
    const isLightVariant =
      variant === "ghost" ||
      variant === "linen" ||
      variant === "light" ||
      variant === "onDark" ||
      variant === "text"
    const isBusy = loading || resolving
    const spinnerSize: SpinnerSize = size === "s" ? "xs" : size === "l" ? "m" : "s"

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(
          buttonVariants({ variant, size }),
          resolving ? "sl-inward" : "sl",
          isLightVariant && "sl-light",
          className
        )}
        {...props}
        aria-busy={isBusy || undefined}
        aria-disabled={isBusy || props["aria-disabled"] || undefined}
        onClick={(event) => {
          if (isBusy) {
            // Also cancels form submission when type="submit": no second request.
            event.preventDefault()
            return
          }
          onClick?.(event)
        }}
      >
        <span className="relative z-1 inline-flex items-center justify-center gap-2">
          {resolving ? (
            <>
              <Spinner size={spinnerSize} className="text-current" />
              <span>{resolvingLabel ?? "لحظات…"}</span>
            </>
          ) : loading ? (
            <>
              <Spinner size={spinnerSize} className="text-current" />
              <span>{pendingLabel ?? children}</span>
            </>
          ) : (
            children
          )}
        </span>
      </button>
    )
  }
)
Button.displayName = "Button"

export type AsyncState = "idle" | "pending" | "resolving" | "success" | "error"

export interface AsyncButtonProps extends Omit<ButtonProps, "asChild" | "children" | "loading" | "pendingLabel"> {
  /** Server state of the action this button starts. */
  state: AsyncState
  /** Idle label (also shown after an error unless `retryLabel` is given). */
  children: React.ReactNode
  /** Action in progress, ending in «…» (handoff §Pending labels): «بيتضاف…», «بنسجّل طلبك…». */
  pendingLabel: React.ReactNode
  /** Resolving label while awaiting state/quote calculation («لحظات…» or custom). */
  resolvingLabel?: React.ReactNode
  /** Past-tense label held about 1 s on success: «اتضاف». Omit when the flow navigates away instead. */
  successLabel?: React.ReactNode
  /** Label after a failure: «جرّب تاني» or the action label. The message itself sits outside the button. */
  retryLabel?: React.ReactNode
}

/**
 * Async button (ShutterLoading board, handoff §Async buttons). One box, five states, never resized:
 *  - pending: same box, label becomes the action in progress, Sahel Spinner, aria-busy + aria-disabled;
 *  - resolving: same box, spinner awaiting server state/quote, aria-busy + aria-disabled;
 *  - success: ok fill + check + past-tense label (status announced);
 *  - error: retry icon + «جرّب تاني»; the caller shows the message (role=alert) outside the button and retries the
 *    SAME request with the SAME idempotency key;
 *  - disabled: `disabled` when a precondition is missing (sand fill, ink-3 text).
 * Pending is a UI guard only — mutating requests also carry an idempotency key server-side.
 */
const AsyncButton = React.forwardRef<HTMLButtonElement, AsyncButtonProps>(
  ({ state, children, pendingLabel, resolvingLabel, successLabel, retryLabel, className, variant = "ink", size, onClick, ...props }, ref) => {
    const pending = state === "pending"
    const resolving = state === "resolving"
    const success = state === "success" && successLabel !== undefined
    const isBusy = pending || resolving
    const spinnerSize: SpinnerSize = size === "s" ? "xs" : size === "l" ? "m" : "s"

    return (
      <button
        ref={ref}
        type={props.type ?? "button"}
        className={cn(
          buttonVariants({ variant, size, state: success ? "success" : "idle" }),
          resolving ? "sl-inward" : "sl",
          (variant === "ghost" || variant === "linen" || variant === "light" || variant === "onDark" || variant === "text") && "sl-light",
          className
        )}
        {...props}
        aria-busy={isBusy || undefined}
        aria-disabled={isBusy || props["aria-disabled"] || undefined}
        onClick={(event) => {
          if (isBusy || success) {
            // Also cancels form submission when type="submit".
            event.preventDefault()
            return
          }
          onClick?.(event)
        }}
      >
        <span className="inline-flex items-center justify-center gap-2" aria-live="polite">
          {success ? (
            <>
              <Icon name="check" size={18} strokeWidth={2.4} />
              {successLabel}
            </>
          ) : pending ? (
            <>
              <Spinner size={spinnerSize} className="text-current" />
              <span>{pendingLabel}</span>
            </>
          ) : resolving ? (
            <>
              <Spinner size={spinnerSize} className="text-current" />
              <span>{resolvingLabel ?? "لحظات…"}</span>
            </>
          ) : state === "error" ? (
            <>
              <Icon name="retry" size={18} strokeWidth={2} />
              {retryLabel ?? children}
            </>
          ) : (
            children
          )}
        </span>
      </button>
    )
  }
)
AsyncButton.displayName = "AsyncButton"

export { AsyncButton, Button, buttonVariants }
