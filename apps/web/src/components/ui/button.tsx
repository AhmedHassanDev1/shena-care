"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { buttonVariants } from "./button-variants"
import { Icon } from "./icon"

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
}

/** SAHEL button. Pass `loading` while it waits on the server; it then shows Shutter Loading. */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, loading = false, pendingLabel, onClick, children, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} onClick={onClick} {...props}>
          {children}
        </Slot>
      )
    }
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(buttonVariants({ variant, size }), "sl", className)}
        {...props}
        aria-busy={loading || undefined}
        aria-disabled={loading || props["aria-disabled"] || undefined}
        onClick={(event) => {
          if (loading) {
            // Also cancels form submission when type="submit": no second request.
            event.preventDefault()
            return
          }
          onClick?.(event)
        }}
      >
        <span className="inline-flex items-center justify-center gap-2.5">{loading && pendingLabel ? pendingLabel : children}</span>
      </button>
    )
  }
)
Button.displayName = "Button"

export type AsyncState = "idle" | "pending" | "success" | "error"

export interface AsyncButtonProps extends Omit<ButtonProps, "asChild" | "children" | "loading" | "pendingLabel"> {
  /** Server state of the action this button starts. */
  state: AsyncState
  /** Idle label (also shown after an error unless `retryLabel` is given). */
  children: React.ReactNode
  /** Action in progress, ending in «…» (handoff §Pending labels): «بيتضاف…», «بنسجّل طلبك…». */
  pendingLabel: React.ReactNode
  /** Past-tense label held about 1 s on success: «اتضاف». Omit when the flow navigates away instead. */
  successLabel?: React.ReactNode
  /** Label after a failure: «جرّب تاني» or the action label. The message itself sits outside the button. */
  retryLabel?: React.ReactNode
}

/**
 * Async button (ShutterLoading board, handoff §Async buttons). One box, five states, never resized:
 *  - pending: same box, label becomes the action in progress, Shutter Loading strips, aria-busy + aria-disabled,
 *    further clicks do nothing (no second request);
 *  - success: ok fill + check + past-tense label (status announced);
 *  - error: retry icon + «جرّب تاني»; the caller shows the message (role=alert) outside the button and retries the
 *    SAME request with the SAME idempotency key;
 *  - disabled: `disabled` when a precondition is missing (sand fill, ink-3 text).
 * Pending is a UI guard only — mutating requests also carry an idempotency key server-side.
 */
const AsyncButton = React.forwardRef<HTMLButtonElement, AsyncButtonProps>(
  ({ state, children, pendingLabel, successLabel, retryLabel, className, variant = "blue", size, onClick, ...props }, ref) => {
    const pending = state === "pending"
    const success = state === "success" && successLabel !== undefined
    return (
      <button
        ref={ref}
        type={props.type ?? "button"}
        className={cn(buttonVariants({ variant, size, state: success ? "success" : "idle" }), "sl", className)}
        {...props}
        aria-busy={pending || undefined}
        aria-disabled={pending || props["aria-disabled"] || undefined}
        onClick={(event) => {
          if (pending || success) {
            // Also cancels form submission when type="submit".
            event.preventDefault()
            return
          }
          onClick?.(event)
        }}
      >
        <span className="inline-flex items-center justify-center gap-2.5" aria-live="polite">
          {success ? (
            <>
              <Icon name="check" size={18} strokeWidth={2.4} />
              {successLabel}
            </>
          ) : pending ? (
            pendingLabel
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
