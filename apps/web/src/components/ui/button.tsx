"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { BeadLoader } from "./bead-loader"
import { buttonVariants } from "./button-variants"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * Hides the label behind a bead loader while keeping the button's width, focus and color, and blocks
   * activation (including form submission). The button stays focusable so keyboard and screen-reader
   * users keep their place. Not supported with `asChild`.
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
        {/* Same flex rhythm as the button itself, so hiding the content never changes the width. */}
        <span className={cn("inline-flex items-center justify-center gap-2", loading && "invisible")}>{children}</span>
        {loading ? (
          <span className="absolute inset-0 grid place-items-center">
            <BeadLoader />
          </span>
        ) : null}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
