import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FocusHeader, type FocusHeaderProps } from './FocusHeader';
import { MobileDock, type DockItem } from './MobileDock';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export type FloatingNavItem = 'home' | 'shop' | 'shina' | 'routines' | 'account' | 'cart';

export interface StorefrontShellProps {
  children: ReactNode;
  /** Preserved for route contract compatibility. */
  nav?: FloatingNavItem | 'none' | string;
  phoneFocus?: Omit<FocusHeaderProps, 'desktopBack' | 'secure'>;
  phoneHeader?: ReactNode;
  navMode?: 'static' | 'scroll-up';
  searchDefault?: string;
  className?: string;
  /** Explicit override for dock item; otherwise automatically derived from route. */
  dock?: DockItem;
  /** Set to true only for focused fullscreen flows (e.g. checkout). Defaults to false. */
  hideDock?: boolean;
  /** The footer's service strip; a page that states the same services itself turns it off. */
  footerServices?: boolean;
  /** Hide the footer completely for focused full-page workspaces like Ask Shina. */
  hideFooter?: boolean;
}

/**
 * Functional storefront shell providing consistent navigation, header, and footer chrome.
 * Persistent mobile bottom navigation is rendered by default across all storefront pages.
 */
export function StorefrontShell({
  children,
  phoneFocus,
  phoneHeader,
  searchDefault,
  className,
  dock,
  hideDock = false,
  footerServices = true,
  hideFooter = false,
}: StorefrontShellProps) {
  const showDock = !hideDock;

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
      <div className={cn('flex-1 flex flex-col min-h-0', showDock && 'pb-24 lg:pb-0')}>{children}</div>
      {!hideFooter ? (
        <div className={cn(phoneFocus && 'hidden lg:block')}>
          <SiteFooter services={footerServices} dockClearance={showDock} />
        </div>
      ) : null}
      {showDock ? <MobileDock active={dock} /> : null}
    </div>
  );
}
