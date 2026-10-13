'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';

export interface HeaderNavLink {
  href: string;
  label: string;
  /** Hidden below the xl breakpoint, when the row is out of room (secondary shortcuts). */
  extra?: boolean;
}

function NavList({ links, label, isActive }: { links: HeaderNavLink[]; label: string; isActive: (href: string) => boolean }) {
  return (
    <nav aria-label={label} className="hidden items-center gap-1 lg:flex">
      {links.map((link) => {
        const active = isActive(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative inline-flex min-h-control-m items-center whitespace-nowrap rounded-pill px-4 text-label transition-colors duration-quick ease-out',
              active ? 'text-foreground' : 'text-ink-soft hover:bg-sand hover:text-foreground',
              link.extra && 'hidden xl:inline-flex',
            )}
          >
            {link.label}
            {active ? <span aria-hidden="true" className="absolute inset-x-4 bottom-1 h-0.5 rounded-pill bg-primary" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function ActiveNav({ links, label }: { links: HeaderNavLink[]; label: string }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const isActive = (href: string) => {
    const [path, query = ''] = href.split('?');
    if (pathname !== path) return false;
    const wanted = [...new URLSearchParams(query)];
    // A plain listing link is active only when no category / concern / search narrows the listing.
    if (wanted.length === 0) return !['category', 'concern', 'q'].some((key) => params.has(key));
    return wanted.every(([key, value]) => params.get(key) === value);
  };

  return <NavList links={links} label={label} isActive={isActive} />;
}

/**
 * Desktop navigation links with a real active state (path + the query parameters a link carries). The
 * server render (and the Suspense fallback) shows the same links without the active mark.
 */
export function HeaderNav({ links, label }: { links: HeaderNavLink[]; label: string }) {
  return (
    <Suspense fallback={<NavList links={links} label={label} isActive={() => false} />}>
      <ActiveNav links={links} label={label} />
    </Suspense>
  );
}
