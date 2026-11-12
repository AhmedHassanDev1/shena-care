import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Screen-reader label for the input: «البحث في شينا كير». */
  label: string
  /** Form target. Omit when the parent handles submission. */
  action?: string
  /** Visual density: `compact` (44px) for sticky header, `default` (56px) for standalone placement. */
  variant?: "default" | "compact"
  /** Optional control rendered at the inline end edge of the pill (e.g. clear button). */
  endAdornment?: React.ReactNode
  /** Forwarded ref to the underlying `<input>` element. */
  inputRef?: React.Ref<HTMLInputElement>
  /** Forwarded ref to the wrapping `<form>` element. */
  formRef?: React.Ref<HTMLFormElement>
  /** Form submit handler. */
  onFormSubmit?: React.FormEventHandler<HTMLFormElement>
  /** Classes for the form wrapper (layout only). */
  className?: string
}

/**
 * Sahel Search pill: linen capsule on warm chalk, subtle border, lens in stone, cobalt focus ring.
 */
export function SearchField({
  label,
  action,
  variant = "default",
  endAdornment,
  inputRef,
  formRef,
  onFormSubmit,
  className,
  name = "q",
  id = "site-search",
  ...inputProps
}: SearchFieldProps) {
  const isCompact = variant === "compact"

  return (
    <form
      ref={formRef}
      action={action}
      method={action ? "get" : undefined}
      onSubmit={onFormSubmit}
      role="search"
      className={cn("m-0", className)}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div
        className={cn(
          "flex items-center rounded-pill bg-linen transition-colors duration-fast ease-standard",
          isCompact
            ? "h-11 gap-2.5 px-3.5 border border-ink/15 focus-within:border-cobalt focus-within:bg-white focus-within:ring-2 focus-within:ring-cobalt/15"
            : "h-control-xl gap-3 px-5 border border-ink/20 shadow-elevation-1 focus-within:border-cobalt focus-within:ring-2 focus-within:ring-cobalt/15",
        )}
      >
        <Icon name="search" size={isCompact ? 18 : 20} className="text-stone shrink-0" />
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          className={cn(
            "h-full min-w-0 flex-1 border-0 bg-transparent font-display text-ink outline-none placeholder:text-stone focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden",
            isCompact ? "text-14.5 leading-20" : "text-17 leading-24",
          )}
          {...inputProps}
        />
        {endAdornment}
      </div>
    </form>
  )
}
