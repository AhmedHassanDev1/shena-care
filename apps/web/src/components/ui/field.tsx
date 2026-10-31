import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon, type IconName } from "./icon"

/*
 * SAHEL fields (Single Source of Truth: boards/04-components.html):
 * Label 15/600 in ink, a 56px linen box with 16px radius and 1px line-2 outline.
 * Focus: 2px solid ink + e1 shadow. Error: 2px solid tomato.
 * Messages sit under the box: helper in stone, inline error in tomato-ink with tomato badge.
 */

/* ── Message ───────────────────────────────────────────────────────────── */

export type FieldMessageTone = "hint" | "error" | "success"

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
        "m-0 flex items-start gap-2 text-14 font-display leading-22",
        tone === "hint" && "text-stone",
        tone === "error" && "text-tomato-ink font-semibold",
        tone === "success" && "text-ok font-semibold",
        className
      )}
    >
      {tone === "error" ? (
        <span aria-hidden="true" className="mt-1 flex size-4 flex-none items-center justify-center rounded-full bg-tomato text-11 font-bold text-ink">
          !
        </span>
      ) : null}
      {tone === "success" ? <Icon name="check" size={16} strokeWidth={2.4} className="mt-0.5" /> : null}
      <span>{children}</span>
    </p>
  )
}

/* ── Shell: label + control + message ──────────────────────────────────── */

interface MessageProps {
  hint?: React.ReactNode
  error?: React.ReactNode
  success?: React.ReactNode
}

/** Message precedence: error, then success, then hint. */
function resolveMessage(id: string, { hint, error, success }: MessageProps) {
  const tone: FieldMessageTone = error ? "error" : success ? "success" : "hint"
  const content = error || success || hint
  return { tone, content, messageId: content ? `${id}-msg` : undefined }
}

export function FieldLabel({ htmlFor, id, children, className }: { htmlFor?: string; id?: string; children: React.ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} id={id} className={cn("text-15 font-semibold font-display leading-none text-ink", className)}>
      {children}
    </label>
  )
}

interface ShellProps extends MessageProps {
  id: string
  label?: React.ReactNode
  /** Already localized optional marker, e.g. «(اختياري)». Omit for required fields. */
  optionalLabel?: string
  className?: string
  children: React.ReactNode
}

function FieldShell({ id, label, optionalLabel, className, children, ...message }: ShellProps) {
  const { tone, content, messageId } = resolveMessage(id, message)
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {label ? (
        <FieldLabel htmlFor={id}>
          {label}
          {optionalLabel ? <span className="font-normal text-stone"> {optionalLabel}</span> : null}
        </FieldLabel>
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

const describedBy = (own: string | undefined, messageId: string | undefined) => [own, messageId].filter(Boolean).join(" ") || undefined

const controlClass =
  "h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-display text-ink outline-none placeholder:text-stone disabled:cursor-not-allowed disabled:text-stone"

/* ── TextField ─────────────────────────────────────────────────────────── */

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: React.ReactNode
  optionalLabel?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  success?: React.ReactNode
  /** Icon inside the box before the text. */
  icon?: IconName
  /** Rendered inside the box after the text (unit, action). */
  suffix?: React.ReactNode
  wrapperClassName?: string
}

/** Labelled 56px text field in Sahel style. */
const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, optionalLabel, hint, error, success, icon, suffix, id, wrapperClassName, className, ...rest }, ref) => {
    const auto = React.useId()
    const fid = id ?? auto
    const { messageId } = resolveMessage(fid, { hint, error, success })
    return (
      <FieldShell id={fid} label={label} optionalLabel={optionalLabel} hint={hint} error={error} success={success} className={wrapperClassName}>
        <div className={cn("field-box flex h-control-xl items-center gap-2.5 px-5", className)} data-invalid={error ? true : undefined}>
          {icon ? <Icon name={icon} size={20} className="text-stone" /> : null}
          <input
            ref={ref}
            id={fid}
            className={cn(controlClass, "text-17")}
            {...rest}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(rest["aria-describedby"], messageId)}
          />
          {suffix}
        </div>
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

const TextAreaField = React.forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  ({ label, optionalLabel, hint, error, id, wrapperClassName, className, rows = 3, ...rest }, ref) => {
    const auto = React.useId()
    const fid = id ?? auto
    const { messageId } = resolveMessage(fid, { hint, error })
    return (
      <FieldShell id={fid} label={label} optionalLabel={optionalLabel} hint={hint} error={error} className={wrapperClassName}>
        <div className="field-box px-5 py-3" data-invalid={error ? true : undefined}>
          <textarea
            ref={ref}
            id={fid}
            rows={rows}
            className={cn(controlClass, "block w-full resize-y text-17 leading-26", className)}
            {...rest}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(rest["aria-describedby"], messageId)}
          />
        </div>
      </FieldShell>
    )
  }
)
TextAreaField.displayName = "TextAreaField"

/* ── PhoneField ────────────────────────────────────────────────────────── */

export type PhoneFieldProps = Omit<TextFieldProps, "icon" | "suffix" | "dir" | "type">

/**
 * Egyptian mobile number: 56px Sahel field with phone icon.
 */
const PhoneField = React.forwardRef<HTMLInputElement, PhoneFieldProps>(
  ({ label, optionalLabel, hint, error, success, id, wrapperClassName, className, ...rest }, ref) => {
    const auto = React.useId()
    const fid = id ?? auto
    const { messageId } = resolveMessage(fid, { hint, error, success })
    return (
      <FieldShell id={fid} label={label} optionalLabel={optionalLabel} hint={hint} error={error} success={success} className={wrapperClassName}>
        <div className={cn("field-box flex h-control-xl items-center gap-2.5 px-5", className)} data-invalid={error ? true : undefined}>
          <Icon name="phone" size={20} className="text-stone" />
          <input
            ref={ref}
            id={fid}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            dir="ltr"
            className={cn(controlClass, "text-17 tabular-nums")}
            {...rest}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(rest["aria-describedby"], messageId)}
          />
        </div>
      </FieldShell>
    )
  }
)
PhoneField.displayName = "PhoneField"

export { TextField, TextAreaField, PhoneField }
