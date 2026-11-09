import type { ReactNode } from 'react';

/**
 * Sign-in heading rhythm (AuthEntryD / AuthOtpD / AuthMobile).
 * Refined typography, restrained spacing, and clear visual hierarchy.
 */
export function AuthHeader({
  title,
  desktopTitle,
  description,
  titleId,
  descriptionId,
}: {
  title?: string;
  desktopTitle?: ReactNode;
  description: ReactNode;
  titleId?: string;
  descriptionId?: string;
}) {
  return (
    <header className="flex flex-col gap-1.5 text-start">
      <h1 id={titleId} className="m-0 font-display font-black text-22 lg:text-26 text-ink leading-tight">
        {desktopTitle ? (
          <>
            <span className="lg:hidden">{title}</span>
            <span className="hidden lg:inline">{desktopTitle}</span>
          </>
        ) : (
          title
        )}
      </h1>
      <p id={descriptionId} className="m-0 text-13.5 lg:text-14 text-stone leading-20 font-display">
        {description}
      </p>
    </header>
  );
}
