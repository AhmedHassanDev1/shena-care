'use client';

import { forwardRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type OtpCellState = 'default' | 'invalid' | 'verified';

export interface OtpInputProps {
  id: string;
  value: string;
  /** Number of drawn cells and maxlength — the code length of the challenge, never a client default. */
  length: number;
  onChange: (value: string) => void;
  state?: OtpCellState;
  /** Expired or attempts exhausted: cells read as unavailable and the input is disabled. */
  disabled?: boolean;
  /** Code is being checked: keeps focus but ignores edits. */
  readOnly?: boolean;
  labelledBy?: string;
  describedBy?: string;
  autoFocus?: boolean;
  /** Raw typed/pasted/autofilled text → digits (e.g. convert Arabic-Indic numerals). Defaults to stripping non-digits. */
  normalize?: (raw: string) => string;
}

const digitsOnly = (raw: string) => raw.replace(/\D/g, '');

/**
 * Verification code (Authentication Addendum §Code input, AuthStates §٣): ONE real input drawn as `length` cells.
 * type=text, inputmode=numeric, pattern=[0-9]*, autocomplete=one-time-code, dir=ltr; the drawn cells are aria-hidden,
 * so screen readers hear one field and SMS autofill / paste work natively. Cells: 50×60 mobile, 60×68 desktop, radius 14.
 */
export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput(
  { id, value, length, onChange, state = 'default', disabled = false, readOnly = false, labelledBy, describedBy, autoFocus, normalize = digitsOnly },
  ref
) {
  const [isFocused, setIsFocused] = useState(false);
  const activeIndex = Math.min(value.length, length - 1);

  /** Editing always happens at the end, like typing into the next cell. */
  const keepCaretAtEnd = (input: HTMLInputElement) => {
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
  };

  return (
    <div dir="ltr" className="relative">
      <div aria-hidden="true" className="flex justify-center gap-2 lg:gap-2.5">
        {Array.from({ length }, (_, index) => {
          const digit = value[index] ?? '';
          const isActive = isFocused && !disabled && !readOnly && index === activeIndex && state === 'default';
          return (
            <span
              key={index}
              className={cn(
                'flex h-otp-h max-w-otp-w flex-1 items-center justify-center rounded-input text-24 font-bold tabular-nums lg:h-otp-h-lg lg:max-w-otp-w-lg',
                'transition-shadow duration-fast ease-standard',
                disabled
                  ? 'bg-sand text-ink-3 shadow-outline-dune'
                  : state === 'invalid'
                    ? 'bg-linen text-night shadow-outline-err'
                    : state === 'verified'
                      ? 'bg-linen text-night shadow-outline-verified'
                      : isActive
                        ? 'bg-linen text-night shadow-focus-field'
                        : 'bg-linen text-night shadow-outline-control'
              )}
            >
              {digit}
              {isActive && !digit ? <span className="h-6 w-0.5 rounded-pill bg-blue" /> : null}
            </span>
          );
        })}
      </div>

      <input
        ref={ref}
        id={id}
        name="otp"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        maxLength={length}
        value={value}
        onChange={(event) => onChange(normalize(event.target.value).slice(0, length))}
        onFocus={(event) => {
          setIsFocused(true);
          keepCaretAtEnd(event.currentTarget);
        }}
        onBlur={() => setIsFocused(false)}
        onSelect={(event) => keepCaretAtEnd(event.currentTarget)}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={state === 'invalid' || undefined}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        // 16px stops iOS from zooming; the value itself is drawn by the cells.
        className="absolute inset-0 size-full cursor-text appearance-none border-0 bg-transparent text-16 text-transparent caret-transparent opacity-0 outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
});
