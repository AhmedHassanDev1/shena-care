import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Screen-reader label for the input (the placeholder is not a label): «البحث في شينا كير». */
  label: string
  /** Form target. Omit when the parent handles submission. */
  action?: string
  /** Classes for the form wrapper (layout only). */
  className?: string
}

/**
 * Header search (Main / PLPMobile header): 50-tall linen pill, 1px line-2 outline, lens in ink-2 at the reading start,
 * 15px text; focus = 2px blue + blue-tint halo. A plain GET form, so it works without JavaScript.
 */
export function SearchField({ label, action, className, name = "q", id = "site-search", ...inputProps }: SearchFieldProps) {
  return (
    <form action={action} method={action ? "get" : undefined} role="search" className={cn("m-0", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex h-control-search items-center gap-2.5 rounded-pill bg-linen px-4 shadow-outline-control transition-shadow duration-fast ease-standard focus-within:shadow-focus-field lg:px-5">
        <Icon name="search" size={20} className="text-ink-2" />
        <input
          id={id}
          name={name}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          className="h-full min-w-0 flex-1 border-0 bg-transparent font-text text-15 text-night outline-none placeholder:text-ink-3 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          {...inputProps}
        />
      </div>
    </form>
  )
}
