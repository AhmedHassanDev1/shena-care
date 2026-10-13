'use client';

import { forwardRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { toLatinDigits } from '../lib/auth-helpers';

interface OtpInputProps {
  id: string;
  value: string;
  length: number;
  onChange: (value: string) => void;
  invalid?: boolean;
  /** No new code can be entered (expired challenge): the boxes read as unavailable. */
  disabled?: boolean;
  /** Code is being checked: keeps focus but ignores edits. */
  readOnly?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}

/**
 * Segmented verification code.
 *
 * One real input carries the value, so SMS autofill (autocomplete="one-time-code"), full-code paste,
 * backspace and screen readers all behave natively. It sits transparently over the boxes, which only
 * draw the digits; the "focus" moves with the caret position (the next empty box).
 */
export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput(
  { id, value, length, onChange, invalid = false, disabled = false, readOnly = false, describedBy, autoFocus },
  ref
) {
  const [isFocused, setIsFocused] = useState(false);
  const activeIndex = Math.min(value.length, length - 1);

  /** Editing always happens at the end, like typing into the next box. */
  const keepCaretAtEnd = (input: HTMLInputElement) => {
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
  };

  return (
    <div
      dir="ltr"
      className="relative grid gap-2 sm:gap-3"
      style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` } as CSSProperties}
    >
      {Array.from({ length }, (_, index) => {
        const digit = value[index] ?? '';
        const isActive = isFocused && !disabled && index === activeIndex;
        return (
          <div
            key={index}
            aria-hidden="true"
            className={cn(
              'flex h-14 items-center justify-center rounded-md border text-[1.5rem] font-semibold tabular-nums text-foreground',
              'transition-[border-color,background-color,box-shadow] duration-fast ease-standard',
              disabled
                ? 'border-border bg-disabled text-disabled-foreground'
                : invalid
                  ? cn('border-destructive bg-card', isActive && 'ring-1 ring-destructive')
                  : isActive
                    ? 'border-ring bg-card ring-1 ring-ring'
                    : digit
                      ? 'border-input bg-card'
                      : 'border-input bg-muted'
            )}
          >
            {digit}
            {isActive && !digit && !readOnly ? <span className="h-6 w-0.5 rounded-full bg-ring" /> : null}
          </div>
        );
      })}

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
        value={value}
        onChange={(event) => onChange(toLatinDigits(event.target.value).replace(/\D/g, '').slice(0, length))}
        onFocus={(event) => {
          setIsFocused(true);
          keepCaretAtEnd(event.currentTarget);
        }}
        onBlur={() => setIsFocused(false)}
        onSelect={(event) => keepCaretAtEnd(event.currentTarget)}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        // 16px text stops iOS from zooming; the value itself is drawn by the boxes.
        className={cn(
          'absolute inset-0 size-full cursor-text appearance-none rounded-md border-0 bg-transparent text-base',
          'text-transparent caret-transparent outline-none selection:bg-transparent focus-visible:outline-none',
          'disabled:cursor-not-allowed'
        )}
      />
    </div>
  );
});
