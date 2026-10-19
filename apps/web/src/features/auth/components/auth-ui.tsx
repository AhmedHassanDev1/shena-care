import type { ReactNode } from 'react';

/**
 * Sign-in-specific composition only. Controls, messages and buttons come from the shared components
 * (PhoneField, OtpInput, AsyncButton, MessageBox); what lives here is the heading rhythm every step repeats:
 * eyebrow with its hairline, the display headline and the body line (AuthEntryD / AuthOtpD / AuthMobile).
 */
export function AuthHeader({
  eyebrow,
  title,
  titleId,
  description,
  descriptionId,
}: {
  eyebrow?: string;
  title: string;
  titleId?: string;
  description: ReactNode;
  descriptionId?: string;
}) {
  return (
    <header className="flex flex-col gap-3">
      {eyebrow ? (
        <p className="m-0 flex items-center gap-3 text-12 font-semibold leading-17 text-ink-2">
          <span>{eyebrow}</span>
          <span aria-hidden="true" className="h-[1.5px] w-14 bg-line-2/60" />
        </p>
      ) : null}
      <h1 id={titleId} className="m-0 text-display-3 text-night lg:text-display-2">
        {title}
      </h1>
      <p id={descriptionId} className="m-0 text-body text-ink-2">
        {description}
      </p>
    </header>
  );
}
