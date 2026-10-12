import type { ReactNode } from 'react';
import { AlertCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared building blocks for the sign-in steps. Every step uses the same heading rhythm, control
 * frame, feedback and helper line so the flow reads as one surface.
 */

export function AuthHeader({ title, description }: { title: string; description: ReactNode }) {
  return (
    <header>
      <h1 className="text-h2 font-bold text-foreground">{title}</h1>
      <p className="mt-2 text-body text-muted-foreground">{description}</p>
    </header>
  );
}

/**
 * Frame of a text control: filled at rest, white with a solid rose edge on focus, red when invalid.
 * Applied to a wrapper so leading icons sit inside the same boundary as the input.
 */
export function authControlClass({ invalid = false, focusWithin = true } = {}) {
  return cn(
    'rounded-md border transition-[border-color,background-color,box-shadow] duration-fast ease-standard',
    invalid ? 'border-destructive bg-card' : 'border-input bg-muted',
    focusWithin &&
      (invalid
        ? 'focus-within:ring-1 focus-within:ring-destructive'
        : 'focus-within:border-ring focus-within:bg-card focus-within:ring-1 focus-within:ring-ring')
  );
}

/** Primary submit sizing: 52px touch height, full width, soft rose glow. */
export const authSubmitClass = 'h-[3.25rem] w-full text-body font-semibold shadow-cta disabled:shadow-none';

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-2 flex items-start gap-1.5 text-support text-destructive">
      <AlertCircle aria-hidden="true" className="mt-1 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** One quiet supporting line under the primary action. */
export function AuthHelper({ icon: Icon, children, className }: { icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start justify-center gap-2 text-center text-caption text-muted-foreground', className)}>
      <Icon aria-hidden="true" className="mt-[0.2rem] size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
