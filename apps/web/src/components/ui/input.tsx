import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * Text input. Error state is driven by `aria-invalid` (pair it with `aria-describedby` pointing at
 * the message), so the visual and the accessible state can never disagree.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-sm border border-input bg-card px-3 text-body text-foreground",
          "placeholder:text-muted-foreground",
          "transition-colors duration-fast ease-standard",
          // Focus = solid 2px edge (1px border + 1px ring) in the ring color, ≥ 3:1 against the surface.
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
          "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-disabled-foreground",
          "file:border-0 file:bg-transparent file:text-support file:font-medium",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
