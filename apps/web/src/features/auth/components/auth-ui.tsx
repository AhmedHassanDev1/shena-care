import type { ReactNode } from 'react';

/**
 * Sign-in-specific composition only. Controls, messages and buttons come from the shared components
 * (PhoneField, OtpInput, AsyncButton, MessageBox); what lives here is the heading rhythm every step repeats:
 * the display headline and the body line (AuthEntryD / AuthOtpD / AuthMobile).
 */
export function AuthHeader({
  title,
  titleId,
  description,
  descriptionId,
}: {
  title: string;
  titleId?: string;
  description: ReactNode;
  descriptionId?: string;
}) {
  return (
    <header className="flex flex-col gap-3">
      <h1 id={titleId} className="m-0 text-balance text-display-3 text-ink lg:text-display-2">
        {title}
      </h1>
      <p id={descriptionId} className="m-0 text-pretty text-body text-stone">
        {description}
      </p>
    </header>
  );
}
