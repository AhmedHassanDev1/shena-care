import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"
import { iconButtonVariants } from "./icon-button"

/**
 * Search bar: a pill (it is pressable), edge `line-field` for ≥ 3:1, ink on focus. Size m = 52px
 * (page-level search), s = 44px (site header). The lens at the start is the real submit button, so a
 * plain GET form works without JavaScript and touch users keep a visible way to submit.
 */
const searchVariants = cva(
  [
    "flex min-w-0 items-center gap-1 rounded-pill border-[1.5px] border-input bg-card ps-1 pe-4",
    "transition-[border-color,box-shadow] duration-quick ease-out",
    "focus-within:border-foreground focus-within:shadow-[0_0_0_1px_rgb(var(--ink-rgb))]",
  ],
  {
    variants: { size: { s: "h-control-m", m: "h-control-l" } },
    defaultVariants: { size: "m" },
  }
)

export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof searchVariants> {
  /** Screen-reader label for the input (the placeholder is not a label). */
  label: string
  /** Accessible name of the submit button. */
  submitLabel: string
  /** Form target. Omit when the parent form handles submission. */
  action?: string
  method?: "get" | "post"
  /** Classes for the form wrapper (layout). */
  className?: string
}

export function SearchField({
  label,
  submitLabel,
  action,
  method = "get",
  size,
  className,
  name = "q",
  id = "search",
  ...inputProps
}: SearchFieldProps) {
  return (
    <form action={action} method={action ? method : undefined} role="search" className={className}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className={searchVariants({ size })}>
        <button type="submit" aria-label={submitLabel} className={cn(iconButtonVariants({ size: "s" }), "text-ink-soft")}>
          <Icon name="search" size={22} />
        </button>
        <input
          id={id}
          name={name}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-ink-subtle focus-visible:shadow-none [&::-webkit-search-cancel-button]:hidden"
          {...inputProps}
        />
      </div>
    </form>
  )
}
