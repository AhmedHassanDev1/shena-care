import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Field frame shared by `Input` (the frame IS the input) and `InputGroup` (the frame wraps an input
 * plus prefix/suffix). Edge = `line-field` (≥ 3:1); focus = solid ink edge + 1px ink ring; error and
 * success change the edge color and are always paired with words and an icon by the message below.
 */
const frame = [
  "w-full rounded-sm border-[1.5px] border-input bg-card text-body text-foreground",
  "transition-[border-color,box-shadow] duration-quick ease-out",
].join(" ")

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * Text input. Error state is driven by `aria-invalid` (pair it with `aria-describedby` pointing at
 * the message — `TextField` does this), so the visual and the accessible state can never disagree.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        frame,
        "flex h-control-l px-4 placeholder:text-ink-subtle",
        // Tailwind only sees complete class names: keep these literal.
        "focus-visible:border-foreground focus-visible:shadow-[0_0_0_1px_rgb(var(--ink-rgb))]",
        "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:border-destructive aria-[invalid=true]:focus-visible:shadow-[0_0_0_1px_rgb(var(--danger-rgb))]",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-disabled-foreground disabled:shadow-none",
        "file:border-0 file:bg-transparent file:text-body-s file:font-medium",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export type InputGroupTone = "default" | "error" | "success"

export interface InputGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: InputGroupTone
  disabled?: boolean
}

/**
 * Frame for a control with a prefix and/or suffix (phone code, icon, unit). Put a `GroupInput` inside:
 * the frame owns border, focus and state, so leading icons sit inside the same boundary as the text.
 */
const InputGroup = React.forwardRef<HTMLDivElement, InputGroupProps>(
  ({ className, tone = "default", disabled, ...props }, ref) => (
    <div
      ref={ref}
      data-tone={tone}
      data-disabled={disabled || undefined}
      className={cn(
        frame,
        "flex h-control-l items-center gap-2 px-4",
        "focus-within:border-foreground focus-within:shadow-[0_0_0_1px_rgb(var(--ink-rgb))]",
        "data-[tone=error]:border-destructive data-[tone=error]:focus-within:shadow-[0_0_0_1px_rgb(var(--danger-rgb))]",
        "data-[tone=success]:border-success",
        "data-[disabled]:border-border data-[disabled]:bg-disabled data-[disabled]:text-disabled-foreground data-[disabled]:shadow-none",
        className
      )}
      {...props}
    />
  )
)
InputGroup.displayName = "InputGroup"

/** The bare input inside an `InputGroup`: no border or ring of its own (the group's frame shows focus). */
const GroupInput = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-ink-subtle focus-visible:shadow-none disabled:cursor-not-allowed",
      className
    )}
    {...props}
  />
))
GroupInput.displayName = "GroupInput"

export { Input, InputGroup, GroupInput }
