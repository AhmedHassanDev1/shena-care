"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { buttonVariants } from "./button-variants"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * Shows a spinner and blocks activation while keeping the button focusable and in its normal
   * color, so keyboard and screen-reader users keep their place. Not supported with `asChild`.
   */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, onClick, children, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }))

    if (asChild) {
      return (
        <Slot className={classes} ref={ref} onClick={onClick} {...props}>
          {children}
        </Slot>
      )
    }

    return (
      <button
        className={classes}
        ref={ref}
        {...props}
        aria-busy={loading || undefined}
        aria-disabled={loading || props["aria-disabled"] || undefined}
        onClick={(event) => {
          if (loading) {
            // Also cancels form submission when type="submit".
            event.preventDefault()
            return
          }
          onClick?.(event)
        }}
      >
        {loading ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : null}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
