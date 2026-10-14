import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"
import { GroupInput, Input, InputGroup, type InputProps } from "./input"
import { Label } from "./label"

/* ── Message ───────────────────────────────────────────────────────────── */

export type FieldMessageTone = "hint" | "error" | "success"

/**
 * Helper, error or success line under a control. Status never relies on hue: errors carry the alert
 * icon and are announced immediately (role="alert"), success carries the check and is announced politely.
 */
export function FieldMessage({
  id,
  tone = "hint",
  className,
  children,
}: {
  id?: string
  tone?: FieldMessageTone
  className?: string
  children: React.ReactNode
}) {
  return (
    <p
      id={id}
      role={tone === "error" ? "alert" : tone === "success" ? "status" : undefined}
      className={cn(
        "flex items-start gap-1 text-body-s",
        tone === "hint" && "text-ink-subtle",
        tone === "error" && "text-destructive",
        tone === "success" && "text-success",
        className
      )}
    >
      {tone === "error" ? <Icon name="alert" size={16} className="mt-0.5" /> : null}
      {tone === "success" ? <Icon name="check-circle" size={16} className="mt-0.5" /> : null}
      <span>{children}</span>
    </p>
  )
}

/* ── Field shell: label + control + message ────────────────────────────── */

interface FieldShellProps {
  id: string
  label?: React.ReactNode
  /** Text for the "optional" marker, already localized (e.g. "(اختياري)"). Omit for required fields. */
  optionalLabel?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  success?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/** Message precedence: error, then success, then hint. Returns the node, its tone and the id inputs point at. */
function resolveMessage(id: string, { hint, error, success }: Pick<FieldShellProps, "hint" | "error" | "success">) {
  const tone: FieldMessageTone = error ? "error" : success ? "success" : "hint"
  const content = error || success || hint
  return { tone, content, messageId: content ? `${id}-msg` : undefined }
}

function FieldShell({ id, label, optionalLabel, className, children, ...message }: FieldShellProps) {
  const { tone, content, messageId } = resolveMessage(id, message)
  return (
    <div className={cn("grid min-w-0 gap-2", className)}>
      {label ? (
        <Label htmlFor={id}>
          {label}
          {optionalLabel ? <span className="text-body-s font-normal text-ink-subtle"> {optionalLabel}</span> : null}
        </Label>
      ) : null}
      {children}
      {content ? (
        <FieldMessage id={messageId} tone={tone}>
          {content}
        </FieldMessage>
      ) : null}
    </div>
  )
}

/* ── TextField ─────────────────────────────────────────────────────────── */

export interface TextFieldProps extends Omit<InputProps, "prefix"> {
  label?: React.ReactNode
  optionalLabel?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  success?: React.ReactNode
  /** Rendered inside the frame before / after the text (icon, unit). */
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  /** Classes for the outer wrapper (the control itself takes none: it is a token-driven component). */
  wrapperClassName?: string
}

const affix = "inline-flex shrink-0 items-center text-ink-soft"

/** Labelled text field with hint / error / success. Wires `aria-invalid` and `aria-describedby` itself. */
const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  (
    { label, optionalLabel, hint, error, success, prefix, suffix, id, disabled, wrapperClassName, className, ...rest },
    ref
  ) => {
    const auto = React.useId()
    const fid = id ?? auto
    const { messageId } = resolveMessage(fid, { hint, error, success })
    const aria = {
      "aria-invalid": error ? true : undefined,
      "aria-describedby": [rest["aria-describedby"], messageId].filter(Boolean).join(" ") || undefined,
    } as const

    return (
      <FieldShell
        id={fid}
        label={label}
        optionalLabel={optionalLabel}
        hint={hint}
        error={error}
        success={success}
        className={wrapperClassName}
      >
        {prefix || suffix ? (
          <InputGroup tone={error ? "error" : success ? "success" : "default"} disabled={disabled} className={className}>
            {prefix ? <span className={affix}>{prefix}</span> : null}
            <GroupInput ref={ref} id={fid} disabled={disabled} {...rest} {...aria} />
            {suffix ? <span className={affix}>{suffix}</span> : null}
          </InputGroup>
        ) : (
          <Input
            ref={ref}
            id={fid}
            disabled={disabled}
            className={cn(success && !error && "border-success", className)}
            {...rest}
            {...aria}
          />
        )}
      </FieldShell>
    )
  }
)
TextField.displayName = "TextField"

/* ── TextAreaField ─────────────────────────────────────────────────────── */

export interface TextAreaFieldProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: React.ReactNode
  optionalLabel?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  wrapperClassName?: string
}

/** Multi-line `TextField`: same frame, focus ring and error wiring, for free-text descriptions. */
const TextAreaField = React.forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  ({ label, optionalLabel, hint, error, id, wrapperClassName, className, rows = 4, ...rest }, ref) => {
    const auto = React.useId()
    const fid = id ?? auto
    const { messageId } = resolveMessage(fid, { hint, error })
    return (
      <FieldShell id={fid} label={label} optionalLabel={optionalLabel} hint={hint} error={error} className={wrapperClassName}>
        <textarea
          ref={ref}
          id={fid}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={[rest["aria-describedby"], messageId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "w-full rounded-sm border-[1.5px] border-input bg-card px-4 py-3 text-body text-foreground placeholder:text-ink-subtle",
            "transition-[border-color,box-shadow] duration-quick ease-out",
            "focus-visible:border-foreground focus-visible:shadow-[0_0_0_1px_rgb(var(--ink-rgb))] focus-visible:outline-none",
            "aria-[invalid=true]:border-destructive",
            "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-disabled-foreground",
            className
          )}
          {...rest}
        />
      </FieldShell>
    )
  }
)
TextAreaField.displayName = "TextAreaField"

/* ── PhoneField ────────────────────────────────────────────────────────── */

export interface PhoneFieldProps extends Omit<TextFieldProps, "prefix" | "suffix" | "dir" | "type"> {
  /** Fixed country-code chip shown before the number (e.g. "+20"). Omit when the field accepts the full local format. */
  countryCode?: string
  /** Spoken name of the country-code chip (e.g. "Egypt country code +20"). */
  countryCodeLabel?: string
}

/**
 * Mobile number. Digits always run left-to-right, even inside the Arabic layout, so the whole frame is
 * isolated as LTR; the label and message keep the page direction.
 */
const PhoneField = React.forwardRef<HTMLInputElement, PhoneFieldProps>(
  ({ label, optionalLabel, hint, error, success, id, disabled, countryCode, countryCodeLabel, wrapperClassName, className, ...rest }, ref) => {
    const auto = React.useId()
    const fid = id ?? auto
    const { messageId } = resolveMessage(fid, { hint, error, success })

    return (
      <FieldShell
        id={fid}
        label={label}
        optionalLabel={optionalLabel}
        hint={hint}
        error={error}
        success={success}
        className={wrapperClassName}
      >
        <InputGroup
          dir="ltr"
          tone={error ? "error" : success ? "success" : "default"}
          disabled={disabled}
          className={cn(countryCode && "ps-0", className)}
        >
          {countryCode ? (
            <span className="grid h-full place-items-center border-e-[1.5px] border-border px-4 text-label tabular-nums text-foreground">
              {countryCodeLabel ? <span className="sr-only">{countryCodeLabel}</span> : null}
              <span aria-hidden={countryCodeLabel ? true : undefined}>{countryCode}</span>
            </span>
          ) : null}
          <GroupInput
            ref={ref}
            id={fid}
            type="tel"
            dir="ltr"
            inputMode="numeric"
            autoComplete="tel-national"
            disabled={disabled}
            className="tabular-nums"
            {...rest}
            aria-invalid={error ? true : undefined}
            aria-describedby={[rest["aria-describedby"], messageId].filter(Boolean).join(" ") || undefined}
          />
          <Icon name="phone" size={20} className="text-ink-subtle" />
        </InputGroup>
      </FieldShell>
    )
  }
)
PhoneField.displayName = "PhoneField"

export { TextField, TextAreaField, PhoneField }
