import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FocusHeader, type FocusHeaderProps } from './FocusHeader';
import { MobileDock, type DockItem } from './MobileDock';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export type FloatingNavItem = 'home' | 'shop' | 'shina' | 'routines' | 'account';

export interface StorefrontShellProps {
  children: ReactNode;
  /** Preserved for route contract compatibility. */
  nav?: FloatingNavItem | 'none' | string;
  phoneFocus?: Omit<FocusHeaderProps, 'desktopBack' | 'secure'>;
  phoneHeader?: ReactNode;
  navMode?: 'static' | 'scroll-up';
  searchDefault?: string;
  className?: string;
  /** Show the phone dock with this entry active (phones only). Pages without a dock leave it unset. */
  dock?: DockItem;
  /** The footer's service strip; a page that states the same services itself turns it off. */
  footerServices?: boolean;
}

/**
 * Functional storefront shell providing consistent navigation, header, and footer chrome.
 */
export function StorefrontShell({
  children,
  phoneFocus,
  phoneHeader,
  searchDefault,
  className,
  dock,
  footerServices = true,
}: StorefrontShellProps) {
  return (
    <div className={cn('flex min-h-dvh flex-col', className)}>
      {phoneFocus || phoneHeader ? (
        <>
          <div className="lg:hidden">{phoneFocus ? <FocusHeader {...phoneFocus} /> : phoneHeader}</div>
          <div className="hidden lg:block">
            <SiteHeader searchDefault={searchDefault} />
          </div>
        </>
      ) : (
        <SiteHeader searchDefault={searchDefault} />
      )}
      <div className="flex-1">{children}</div>
      <div className={cn(phoneFocus && 'hidden lg:block')}>
        <SiteFooter services={footerServices} dockClearance={Boolean(dock)} />
      </div>
      {dock ? <MobileDock active={dock} /> : null}
    </div>
  );
}
