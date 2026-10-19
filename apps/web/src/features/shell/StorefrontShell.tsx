import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FloatingNav, type FloatingNavItem } from './FloatingNav';
import { FocusHeader, type FocusHeaderProps } from './FocusHeader';
import { NavReveal } from './NavReveal';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export interface StorefrontShellProps {
  children: ReactNode;
  /** Selected FloatingNav item on phones (`none` on Order placed). Ignored when `phoneFocus` is set. */
  nav?: FloatingNavItem | 'none';
  /**
   * Phone Focus Mode (cart): a 56-tall back/title header replaces the browsing header, and the floating nav and footer
   * are hidden (the page's sticky action area takes their place). Desktop keeps the full browsing chrome (CartD).
   */
  phoneFocus?: Omit<FocusHeaderProps, 'desktopBack' | 'secure'>;
  /** Replaces the phone browsing header (PDP: back · wordmark · search · share). Desktop keeps the site header. */
  phoneHeader?: ReactNode;
  /** `scroll-up`: the nav hides while scrolling down and returns on scroll up (PDP). */
  navMode?: 'static' | 'scroll-up';
  /** Prefills the header search (PLP search results). */
  searchDefault?: string;
  className?: string;
}

/**
 * Browsing chrome (handoff §Mobile bottom nav): site header, page, service strip + footer, and on phones the
 * FloatingNav; the footer ends 32 above the nav (`pb-nav-safe`). Checkout and auth use FocusHeader directly.
 */
export function StorefrontShell({ children, nav = 'none', phoneFocus, phoneHeader, navMode = 'static', searchDefault, className }: StorefrontShellProps) {
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
        <SiteFooter />
      </div>
      {phoneFocus ? null : navMode === 'scroll-up' ? (
        <NavReveal>
          <FloatingNav active={nav} />
        </NavReveal>
      ) : (
        <FloatingNav active={nav} />
      )}
    </div>
  );
}
