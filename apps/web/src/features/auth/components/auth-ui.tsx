import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';
import type { IconName } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

/**
 * Sign-in-specific composition only. Controls, messages and buttons come from the shared components
 * (TextField/PhoneField, FieldMessage, OtpInput, Button); what lives here is the heading rhythm and the
 * supporting line that every step repeats.
 */

export function AuthHeader({ title, description }: { title: string; description: ReactNode }) {
  return (
    <header>
      <h1 className="text-display-m text-foreground lg:text-display-l">{title}</h1>
      <p className="mt-2 text-body text-ink-soft">{description}</p>
    </header>
  );
}

/** One quiet supporting line under the primary action. */
export function AuthHelper({ icon, children, className }: { icon: IconName; children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start justify-center gap-2 text-center text-body-s text-ink-subtle', className)}>
      <Icon name={icon} size={18} className="mt-0.5" />
      <span>{children}</span>
    </p>
  );
}
