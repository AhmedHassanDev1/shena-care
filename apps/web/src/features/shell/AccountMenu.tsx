'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { useAuth } from '@/features/auth/AuthContext';
import { displayMobile, signInHref } from '@/features/auth/lib/auth-helpers';
import { useCart } from '@/features/cart/hooks/useCart';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

export interface AccountMenuProps {
  /** Compact icon trigger for mobile header (`44x44`); full action pill on desktop/tablet. */
  compact?: boolean;
}

/**
 * Header account control:
 * - Guest: opens the existing AuthModal without extra redirects, preserving href fallback.
 * - Authenticated: opens an accessible menu with profile overview, orders, addresses, and sign-out.
 */
export function AccountMenu({ compact = false }: AccountMenuProps) {
  const m = useMessages();
  const pathname = usePathname() || '';
  const { user, isAuthenticated, openAuthModal, signOut } = useAuth();
  const { invalidate: invalidateCart } = useCart();

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!isAuthenticated) {
    const returnTo = pathname && pathname !== routes.login ? pathname : routes.account;
    const href = signInHref(returnTo);

    return (
      <Link
        href={href}
        aria-label={m.authTabSignIn}
        onClick={(event) => {
          event.preventDefault();
          openAuthModal({
            mode: 'login',
            onAuthenticated: async () => {
              await invalidateCart();
            },
          });
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-pill text-ink no-underline transition-colors duration-fast ease-standard hover:bg-sand/50 hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
          compact ? 'size-11 shrink-0' : 'h-11 gap-2 px-3.5 text-14 font-display font-semibold whitespace-nowrap',
        )}
      >
        <Icon name="user" size={compact ? 22 : 18} className="shrink-0" />
        {!compact ? <span>{m.authTabSignIn}</span> : null}
      </Link>
    );
  }

  const displayName = user?.name?.trim() || m.shellAccount;
  const secondaryIdentity = user?.phoneNumber
    ? displayMobile(user.phoneNumber)
    : user?.email || '';

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
    );
    if (items.length === 0) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      await invalidateCart();
      setOpen(false);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={compact ? m.shellAccountMenu : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'relative inline-flex items-center justify-center rounded-pill text-ink transition-colors duration-fast ease-standard hover:bg-sand/50 hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
          compact ? 'size-11' : 'h-11 gap-1.5 px-3 text-14 font-display font-semibold',
        )}
      >
        <Icon name="user" size={compact ? 22 : 18} className="shrink-0 text-cobalt" />
        {!compact ? (
          <>
            <span className="max-w-28 truncate">{displayName}</span>
            <Icon
              name="chevron-down"
              size={14}
              className={cn(
                'shrink-0 text-stone transition-transform duration-fast ease-standard',
                open && 'rotate-180',
              )}
            />
          </>
        ) : (
          <span
            aria-hidden="true"
            className="absolute bottom-2 end-2 size-2 rounded-full bg-cobalt ring-2 ring-chalk"
          />
        )}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={m.shellAccountNav}
          onKeyDown={handleMenuKeyDown}
          className="absolute end-0 top-full z-overlay mt-2 w-60 rounded-card border border-line bg-linen p-1.5 shadow-elevation-2 font-display"
        >
          <div className="mb-1 border-b border-line/70 px-3 py-2">
            <p className="m-0 truncate text-14 font-bold text-ink">{displayName}</p>
            {secondaryIdentity ? (
              <p className="m-0 mt-0.5 truncate text-12 text-stone">
                <bdi dir="ltr">{secondaryIdentity}</bdi>
              </p>
            ) : null}
          </div>

          <Link
            href={routes.account}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2.5 rounded-input px-3 text-14 font-medium text-ink no-underline transition-colors duration-fast hover:bg-chalk hover:text-cobalt focus-visible:bg-chalk focus-visible:text-cobalt focus-visible:outline-none"
          >
            <Icon name="user" size={17} className="shrink-0 text-stone" />
            <span>{m.shellProfile}</span>
          </Link>

          <Link
            href={routes.myOrders}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2.5 rounded-input px-3 text-14 font-medium text-ink no-underline transition-colors duration-fast hover:bg-chalk hover:text-cobalt focus-visible:bg-chalk focus-visible:text-cobalt focus-visible:outline-none"
          >
            <Icon name="package" size={17} className="shrink-0 text-stone" />
            <span>{m.myOrdersTitle}</span>
          </Link>

          <Link
            href={routes.accountAddresses}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2.5 rounded-input px-3 text-14 font-medium text-ink no-underline transition-colors duration-fast hover:bg-chalk hover:text-cobalt focus-visible:bg-chalk focus-visible:text-cobalt focus-visible:outline-none"
          >
            <Icon name="pin" size={17} className="shrink-0 text-stone" />
            <span>{m.addressBookTitle}</span>
          </Link>

          <div className="my-1 border-t border-line/70" />

          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={handleSignOut}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-input px-3 text-start text-14 font-medium text-tomato-ink transition-colors duration-fast hover:bg-chalk focus-visible:bg-chalk focus-visible:outline-none disabled:opacity-60"
          >
            <Icon name="logout" size={17} className="shrink-0" />
            <span>{signingOut ? m.shellSigningOut : m.authSignOut}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
