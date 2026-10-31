import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Screen-reader label for the input: «البحث في شينا كير». */
  label: string
  /** Form target. Omit when the parent handles submission. */
  action?: string
  /** Classes for the form wrapper (layout only). */
  className?: string
}

/**
 * Sahel Search pill: 56px linen pill, hairline border, lens in stone, text in ink.
 */
export function SearchField({ label, action, className, name = "q", id = "site-search", ...inputProps }: SearchFieldProps) {
  return (
    <form action={action} method={action ? "get" : undefined} role="search" className={cn("m-0", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex h-control-xl items-center gap-3 rounded-pill bg-linen px-5 border border-ink/18 shadow-e1 transition-all duration-fast ease-standard focus-within:border-2 focus-within:border-ink">
        <Icon name="search" size={20} className="text-stone shrink-0" />
        <input
          id={id}
          name={name}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          className="h-full min-w-0 flex-1 border-0 bg-transparent font-display text-17 text-ink outline-none placeholder:text-stone focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          {...inputProps}
        />
      </div>
    </form>
  )
}
