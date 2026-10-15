'use client';
import Link from 'next/link';
import { MOCK_OVERVIEW } from '@/lib/overview-source';

/**
 * Navigation from the Admin Overview. With demo data the destination pages would call the real API
 * for orders that do not exist, so in demo mode the link is shown but inert and marked preview-only.
 * In-page anchors always work; real mode renders an ordinary Next link.
 */
export function OverviewLink({
  href,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  'aria-label'?: string;
}) {
  if (MOCK_OVERVIEW && !href.startsWith('#')) {
    return (
      <span
        className={`${className ?? ''} ao-preview-only`}
        aria-disabled="true"
        aria-label={ariaLabel}
        title="معاينة فقط — الروابط معطّلة مع البيانات التجريبية"
      >
        {children}
      </span>
    );
  }
  return href.startsWith('#') ? (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
