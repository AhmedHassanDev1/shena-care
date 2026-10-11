'use client';

import Link from 'next/link';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * PROVISIONAL mark — not an approved logo. Three points joined by one rising line: care as an ordered,
 * progressing path. Colors come from semantic tokens only, so it follows any theme swap.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <path
        d="M8 22.5c3.5 0 4.5-8 8-8s4.5-5 8-5"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
      <circle cx="8" cy="22.5" r="2.4" className="fill-primary-foreground" />
      <circle cx="16" cy="14.5" r="2.4" className="fill-primary-foreground" />
      <circle cx="24" cy="9.5" r="2.4" className="fill-primary-foreground" />
    </svg>
  );
}

interface BrandLogoProps {
  /** Pass `null` to render the lockup without a link. */
  href?: string | null;
  className?: string;
}

/** The single Shena Care lockup used by every screen. The wordmark follows the active locale. */
export function BrandLogo({ href = routes.home, className }: BrandLogoProps) {
  const m = useMessages();
  const content = (
    <>
      <BrandMark />
      <span className="whitespace-nowrap text-h3 font-semibold text-foreground">{m.brandName}</span>
    </>
  );
  const classes = cn('inline-flex shrink-0 items-center gap-2.5 rounded-md', className);

  if (href === null) return <span className={classes}>{content}</span>;
  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}
