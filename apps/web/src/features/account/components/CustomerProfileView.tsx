'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLink } from '@/components/ui/arrow-link';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthContext';
import { displayMobile } from '@/features/auth/lib/auth-helpers';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { orders as ordersApi } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { useAddresses } from '../hooks/useAddresses';
import { PersonalInfoSection } from './PersonalInfoSection';
import { ProfileOrdersSection } from './ProfileOrdersSection';
import { SavedAddressesSection } from './SavedAddressesSection';
import { SecuritySessionSection } from './SecuritySessionSection';
import { SupportHelpSection } from './SupportHelpSection';

export interface CustomerProfileViewProps {
  /** Optional focus target when arriving directly via /account/profile. */
  focusSection?: 'personal';
}

export function ProfileSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto flex max-w-container flex-col gap-8 py-4 lg:py-8">
      <div className="flex flex-col gap-3 border-b border-line pb-6">
        <Skeleton className="h-9 w-56 rounded-input" />
        <Skeleton className="h-5 w-48 rounded-pill" />
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="flex flex-col gap-8 lg:col-span-7">
          <Skeleton className="h-48 w-full rounded-card" />
          <Skeleton className="h-44 w-full rounded-card" />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Skeleton className="h-56 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}

/**
 * Editorial SAHEL v4 Customer Profile experience for /account and /account/profile.
 * Unifies real authenticated customer identity, recent orders + tracking, Cairo/Giza saved addresses
 * synced with Checkout, editable personal details, verified security/logout, and customer support.
 */
export function CustomerProfileView({ focusSection }: CustomerProfileViewProps) {
  const m = useMessages();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { user, isAuthenticated, isLoading: authLoading, openAuthModal, refreshUser } = useAuth();
  const { addresses } = useAddresses();

  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(
    () => searchParams.get('reason') === 'expired',
  );
  const [editPersonalRequested, setEditPersonalRequested] = useState(focusSection === 'personal');

  const ordersQuery = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => ordersApi.listMine(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const handleSessionExpired = useCallback(() => {
    setSessionExpiredNotice(true);
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    if (ordersQuery.error && (ordersQuery.error as { status?: number }).status === 401) {
      handleSessionExpired();
    }
  }, [ordersQuery.error, handleSessionExpired]);

  useEffect(() => {
    if (focusSection === 'personal' && isAuthenticated) {
      setEditPersonalRequested(true);
    }
  }, [focusSection, isAuthenticated]);

  if (authLoading) {
    return <ProfileSkeleton />;
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="pb-nav-safe mx-auto max-w-narrow py-6 lg:py-14">
        {sessionExpiredNotice ? (
          <MessageBox tone="warn" className="mb-6">
            {m.authSessionExpired}
          </MessageBox>
        ) : null}

        <section className="rounded-card border border-line bg-linen p-6 md:p-10">
          <span
            aria-hidden="true"
            className="mb-5 grid size-12 place-items-center rounded-pill bg-chalk text-cobalt shadow-outline-control"
          >
            <Icon name="user" size={24} />
          </span>

          <h1 className="m-0 font-display text-display-1 font-extrabold text-ink">
            {m.profileSignedOutTitle}
          </h1>
          <p className="m-0 mt-3 max-w-xl text-17 leading-relaxed text-stone">
            {m.profileSignedOutBody}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="cobalt"
              size="l"
              onClick={() => openAuthModal()}
            >
              {m.profileSignedOutAction}
            </Button>
            <Link
              href={`${routes.login}?returnTo=${encodeURIComponent(routes.account)}`}
              className="text-link px-2 py-2 text-15 font-display font-semibold"
            >
              {m.myOrdersSignInButton}
            </Link>
          </div>

          <div className="mt-8 border-t border-line pt-6">
            <p className="m-0 text-14 leading-22 text-stone">{m.profileSignedOutOrdersHint}</p>
            <div className="mt-3 flex flex-wrap items-center gap-6">
              <ArrowLink href={routes.myOrders} className="text-15">
                {m.profileGoToOrders}
              </ArrowLink>
              <ArrowLink href={routes.products} className="text-15">
                {m.profileBrowseProducts}
              </ArrowLink>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const displayName = user.name?.trim() || null;
  const orderItems = ordersQuery.data?.items ?? [];
  const totalOrders = ordersQuery.data?.total ?? orderItems.length;

  const jumpToEditPersonal = () => {
    setEditPersonalRequested(true);
    document.getElementById('account-personal')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const quickNav = [
    { href: '#account-orders', label: m.profileNavOrders },
    { href: '#account-addresses', label: m.profileNavAddresses },
    { href: '#account-personal', label: m.profileNavPersonal },
    { href: '#account-security', label: m.profileNavSecurity },
    { href: '#account-support', label: m.profileNavSupport },
  ];

  return (
    <div className="pb-nav-safe py-2 lg:py-4">
      <header className="border-b border-line pb-6 md:pb-8">
        <div className="flex flex-col gap-3">
          <h1 className="m-0 font-display text-display-1 font-extrabold text-ink">
            {displayName
              ? fillMessage(m.profileGreetingNamed, { name: displayName })
              : m.profileGreetingUnnamed}
          </h1>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-15 text-stone">
            {user.phoneNumber ? (
              <span className="inline-flex items-center gap-2">
                <bdi dir="ltr" className="font-display font-bold tabular-nums text-ink">
                  {displayMobile(user.phoneNumber)}
                </bdi>
                <span className="inline-flex items-center gap-1 rounded-pill bg-ok-tint px-2 py-0.5 text-12 font-semibold text-ok">
                  <Icon name="check" size={12} strokeWidth={2.5} />
                  <span>{m.profileVerifiedMobile}</span>
                </span>
              </span>
            ) : null}

            <span aria-hidden="true">·</span>
            <span>
              {totalOrders === 1
                ? m.profileOrdersSummaryOne
                : fillMessage(m.profileOrdersSummaryCount, {
                    n: formatNumber(totalOrders, locale),
                  })}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {addresses.length === 1
                ? m.profileAddressesSummaryOne
                : fillMessage(m.profileAddressesSummaryCount, {
                    n: formatNumber(addresses.length, locale),
                  })}
            </span>
          </div>

          {!displayName ? (
            <div>
              <button
                type="button"
                onClick={jumpToEditPersonal}
                className="text-link font-display text-15 font-semibold"
              >
                {m.profileAddNamePrompt}
              </button>
            </div>
          ) : null}
        </div>

        <nav aria-label={m.profileSectionNavLabel} className="mt-5 flex flex-wrap gap-2 lg:hidden">
          {quickNav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="inline-flex min-h-control-s shrink-0 items-center whitespace-nowrap rounded-pill border border-line bg-linen px-4 font-display text-14 font-semibold text-ink no-underline transition-colors hover:bg-sand/50"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="mt-7 grid grid-cols-1 gap-8 lg:mt-10 lg:grid-cols-12 lg:items-start lg:gap-10">
        <div className="flex flex-col gap-10 lg:col-span-7">
          <ProfileOrdersSection
            orders={orderItems}
            total={totalOrders}
            isLoading={ordersQuery.isLoading}
            error={ordersQuery.error}
            onRetry={() => void ordersQuery.refetch()}
          />

          <SavedAddressesSection
            profileFallback={{ name: user.name, phoneNumber: user.phoneNumber }}
            onSessionExpired={handleSessionExpired}
          />
        </div>

        <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:col-span-5">
          <PersonalInfoSection
            user={user}
            editingRequested={editPersonalRequested}
            onEditingRequestedHandled={() => setEditPersonalRequested(false)}
            onSessionExpired={handleSessionExpired}
          />

          <SecuritySessionSection user={user} />

          <SupportHelpSection
            orders={orderItems}
            onSessionExpired={handleSessionExpired}
          />
        </div>
      </div>
    </div>
  );
}
