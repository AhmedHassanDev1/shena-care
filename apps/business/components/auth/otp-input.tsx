'use client'

import * as React from 'react'

export type OtpState = 'idle' | 'error' | 'success'

/**
 * Six-cell code entry over ONE real input, so SMS autofill (`one-time-code`), paste and the numeric
 * keypad behave natively. Digits only, Western numerals; Arabic-Indic digits are converted.
 */
export const OtpInput = React.forwardRef<
  HTMLInputElement,
  {
    value: string
    length: number
    onChange: (value: string) => void
    onComplete?: (value: string) => void
    disabled?: boolean
    state?: OtpState
    labelledBy: string
    describedBy?: string
  }
>(function OtpInput({ value, length, onChange, onComplete, disabled, state = 'idle', labelledBy, describedBy }, ref) {
  const [focused, setFocused] = React.useState(false)

  const accept = (raw: string) => {
    const digits = raw
      .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (ch) => String(ch.charCodeAt(0) >= 0x06f0 ? ch.charCodeAt(0) - 0x06f0 : ch.charCodeAt(0) - 0x0660))
      .replace(/\D/g, '')
      .slice(0, length)
    onChange(digits)
    if (digits.length === length) onComplete?.(digits)
  }

  return (
    <div className="bwa-otp" data-state={state}>
      <div className="bwa-otp-cells" aria-hidden>
        {Array.from({ length }, (_, i) => (
          <div
            key={i}
            className="bwa-otp-cell"
            data-filled={i < value.length}
            data-active={focused && !disabled && i === Math.min(value.length, length - 1)}
          >
            {i < value.length ? <span>{value[i]}</span> : null}
          </div>
        ))}
      </div>
      <input
        ref={ref}
        className="bwa-otp-input"
        value={value}
        onChange={(event) => accept(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length * 2 /* tolerate a pasted "123 456" before it is trimmed */}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={state === 'error' || undefined}
        spellCheck={false}
        autoCorrect="off"
        dir="ltr"
      />
    </div>
  )
})
