import * as React from "react"

import { cn } from "@/lib/utils"
import { Icon, type IconName } from "./icon"

/*
 * SAHEL fields (Authentication Addendum §Inputs; AuthStates §١, CommerceStates §٣): label 14/600 above, a 56px linen
 * box with a 1px line-2 outline and radius 14, focus = 2px blue + blue-tint halo, error = 2px err. Messages sit under
 * the box: helper in ink-2, inline error = red dot + words with role="alert", linked by aria-describedby; the control
 * gets aria-invalid. Box geometry lives in globals.css (.field-box) so every state keeps the same size.
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
        "m-0 flex items-start gap-2 text-13.5 leading-22",
        tone === "hint" && "text-ink-2",
        tone === "error" && "text-err",
        tone === "success" && "text-ok",
        className
      )}
    >
      {tone === "error" ? <span aria-hidden="true" className="mt-1.5 size-1.75 flex-none rounded-full bg-err" /> : null}
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

/** Message precedence: error, then success, then hint (the error replaces the helper, Addendum §Phone field). */
function resolveMessage(id: string, { hint, error, success }: MessageProps) {
  const tone: FieldMessageTone = error ? "error" : success ? "success" : "hint"
  const content = error || success || hint
  return { tone, content, messageId: content ? `${id}-msg` : undefined }
}

export function FieldLabel({ htmlFor, id, children, className }: { htmlFor?: string; id?: string; children: React.ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} id={id} className={cn("text-14 font-semibold leading-22 text-night", className)}>
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
          {optionalLabel ? <span className="font-normal text-ink-2"> {optionalLabel}</span> : null}
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
  "h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-text text-night outline-none placeholder:text-ink-3 disabled:cursor-not-allowed disabled:text-ink-3"

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

/** Labelled 56px text field. Wires aria-invalid and aria-describedby itself. */
const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, optionalLabel, hint, error, success, icon, suffix, id, wrapperClassName, className, ...rest }, ref) => {
    const auto = React.useId()
    const fid = id ?? auto
    const { messageId } = resolveMessage(fid, { hint, error, success })
    return (
      <FieldShell id={fid} label={label} optionalLabel={optionalLabel} hint={hint} error={error} success={success} className={wrapperClassName}>
        <div className={cn("field-box flex h-control-l items-center gap-2.5 px-4", className)} data-invalid={error ? true : undefined}>
          {icon ? <Icon name={icon} size={20} className="text-ink-2" /> : null}
          <input
            ref={ref}
            id={fid}
            className={cn(controlClass, "text-15")}
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
        <div className="field-box px-4 py-3" data-invalid={error ? true : undefined}>
          <textarea
            ref={ref}
            id={fid}
            rows={rows}
            className={cn(controlClass, "block w-full resize-y text-15 leading-25", className)}
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
 * Egyptian mobile number (Addendum §Phone field): type=tel, inputmode=tel, autocomplete=tel-national, dir=ltr, 17px
 * so iOS does not zoom, phone glyph at the reading start. The digits run LTR inside the Arabic layout; label and
 * message keep the page direction.
 */
const PhoneField = React.forwardRef<HTMLInputElement, PhoneFieldProps>(
  ({ label, optionalLabel, hint, error, success, id, wrapperClassName, className, ...rest }, ref) => {
    const auto = React.useId()
    const fid = id ?? auto
    const { messageId } = resolveMessage(fid, { hint, error, success })
    return (
      <FieldShell id={fid} label={label} optionalLabel={optionalLabel} hint={hint} error={error} success={success} className={wrapperClassName}>
        <div className={cn("field-box flex h-control-l items-center gap-2.5 px-4", className)} data-invalid={error ? true : undefined}>
          <Icon name="phone" size={20} className="text-ink-2" />
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
