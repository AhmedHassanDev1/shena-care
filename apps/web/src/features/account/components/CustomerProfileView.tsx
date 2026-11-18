'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLink } from '@/components/ui/arrow-link';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthContext';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { orders as ordersApi } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useAddresses } from '../hooks/useAddresses';
import { careProfileApi } from '../lib/care-profile-api';
import { CareProfileOverview } from './CareProfileOverview';
import { CareIdentitySection } from './CareIdentitySection';
import { CareProfileEditModal } from './CareProfileEditModal';
import { ActiveRoutineSpotlight } from './ActiveRoutineSpotlight';
import { ShinaCareBanner } from './ShinaCareBanner';
import { PersonalInfoSection } from './PersonalInfoSection';
import { ProfileOrdersSection } from './ProfileOrdersSection';
import { SavedAddressesSection } from './SavedAddressesSection';
import { SecuritySessionSection } from './SecuritySessionSection';
import { SupportHelpSection } from './SupportHelpSection';

export interface CustomerProfileViewProps {
  /** Optional focus target when arriving directly via /account/profile. */
  focusSection?: 'personal';
}

type AccountTab = 'care' | 'orders' | 'addresses' | 'personal' | 'support';

export function ProfileSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto flex max-w-container flex-col gap-8 py-4 lg:py-8">
      <div className="flex flex-col gap-3 border-b border-line pb-6">
        <Skeleton className="h-9 w-56 rounded-input" />
        <Skeleton className="h-5 w-48 rounded-pill" />
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-44 w-full rounded-card" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    </div>
  );
}

/**
 * Editorial Personal Care Hub & Customer Profile experience for /account and /account/profile.
 * Unifies the customer's personal care identity (skin, hair, scalp, concerns), active routines,
 * tailored Shina guidance, and commerce essentials (orders, Cairo/Giza addresses, account security).
 */
export function CustomerProfileView({ focusSection }: CustomerProfileViewProps) {
  const m = useMessages();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoading: authLoading, openAuthModal, refreshUser } = useAuth();
  const { addresses } = useAddresses();

  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(
    () => searchParams.get('reason') === 'expired',
  );
  const [editPersonalRequested, setEditPersonalRequested] = useState(focusSection === 'personal');
  const [isEditCareModalOpen, setIsEditCareModalOpen] = useState(false);

  const initialTab: AccountTab = focusSection === 'personal' || searchParams.get('tab') === 'personal'
    ? 'personal'
    : (searchParams.get('tab') as AccountTab) || 'care';

  const [activeTab, setActiveTab] = useState<AccountTab>(initialTab);

  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingTabs = useRef(false);
  const dragStartX = useRef(0);
  const dragScrollLeft = useRef(0);

  const handleTabsMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = tabsContainerRef.current;
    if (!el) return;
    isDraggingTabs.current = true;
    dragStartX.current = e.pageX - el.offsetLeft;
    dragScrollLeft.current = el.scrollLeft;
  };

  const handleTabsMouseLeave = () => {
    isDraggingTabs.current = false;
  };

  const handleTabsMouseUp = () => {
    isDraggingTabs.current = false;
  };

  const handleTabsMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingTabs.current) return;
    const el = tabsContainerRef.current;
    if (!el) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = (x - dragStartX.current) * 1.5;
    el.scrollLeft = dragScrollLeft.current - walk;
  };

  const ordersQuery = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => ordersApi.listMine(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const careProfileQuery = useQuery({
    queryKey: ['customer-care-profile'],
    queryFn: () => careProfileApi.getProfile(),
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
      setActiveTab('personal');
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

        <section className="relative isolate overflow-hidden rounded-card border border-line bg-linen/95 p-6 shadow-elevation-1 md:p-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 end-0 -z-10 size-80 rounded-full bg-sand/30 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 start-0 -z-10 size-80 rounded-full bg-tan/10 blur-3xl"
          />

          <span
            aria-hidden="true"
            className="mb-5 grid size-12 place-items-center rounded-pill border border-line/60 bg-chalk text-cobalt shadow-outline-hairline"
          >
            <Icon name="user" size={24} />
          </span>

          <h1 className="m-0 font-display text-24 md:text-32 font-black leading-tight text-ink">
            {m.profileSignedOutTitle}
          </h1>
          <p className="m-0 mt-3 max-w-xl text-15 md:text-16 leading-relaxed text-stone">
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

  const orderItems = ordersQuery.data?.items ?? [];
  const totalOrders = ordersQuery.data?.total ?? orderItems.length;

  const tabs: Array<{ id: AccountTab; label: string; icon: 'sparkles' | 'package' | 'pin' | 'user' | 'message'; count?: number }> = [
    { id: 'care', label: m.profileNavCareHub, icon: 'sparkles' },
    { id: 'orders', label: m.profileNavOrders, icon: 'package', count: totalOrders > 0 ? totalOrders : undefined },
    { id: 'addresses', label: m.profileNavAddresses, icon: 'pin', count: addresses.length > 0 ? addresses.length : undefined },
    { id: 'personal', label: m.profileNavPersonal, icon: 'user' },
    { id: 'support', label: m.profileNavSupport, icon: 'message' },
  ];

  return (
    <div className="pb-nav-safe relative flex flex-col gap-8 py-2 lg:py-6">
      {/* Hero Overview */}
      <CareProfileOverview
        user={user}
        careProfile={careProfileQuery.data ?? null}
        isLoading={careProfileQuery.isLoading}
        onEditCareProfile={() => setIsEditCareModalOpen(true)}
      />

      {/* Navigation Tabs */}
      <div
        ref={tabsContainerRef}
        role="tablist"
        aria-label={m.profileCareHubTitle}
        onMouseDown={handleTabsMouseDown}
        onMouseLeave={handleTabsMouseLeave}
        onMouseUp={handleTabsMouseUp}
        onMouseMove={handleTabsMouseMove}
        className="no-scrollbar sticky top-16 z-10 flex items-center justify-start gap-1.5 overflow-x-auto rounded-pill border border-line/70 bg-linen/90 p-1.5 shadow-outline-hairline backdrop-blur-md touch-pan-x select-none"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'inline-flex min-h-control-s shrink-0 items-center gap-2 rounded-pill px-4 font-display text-13 md:text-14 font-semibold transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
                isActive
                  ? 'bg-cobalt text-chalk shadow-elevation-1'
                  : 'text-stone hover:bg-sand/40 hover:text-ink active:bg-sand/60'
              )}
            >
              <Icon name={tab.icon} size={15} />
              <span>{tab.label}</span>
              {typeof tab.count === 'number' ? (
                <span
                  className={cn(
                    'rounded-pill px-1.5 py-0.2 text-11 font-bold',
                    isActive ? 'bg-chalk/20 text-chalk' : 'bg-sand/60 text-stone'
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      {activeTab === 'care' ? (
        <div className="flex flex-col gap-8">
          <ActiveRoutineSpotlight isAuthenticated={isAuthenticated} />
          <CareIdentitySection
            careProfile={careProfileQuery.data ?? null}
            isLoading={careProfileQuery.isLoading}
            onEdit={() => setIsEditCareModalOpen(true)}
          />
          <ShinaCareBanner />
        </div>
      ) : null}

      {activeTab === 'orders' ? (
        <div className="mx-auto w-full max-w-container">
          <ProfileOrdersSection
            orders={orderItems}
            total={totalOrders}
            isLoading={ordersQuery.isLoading}
            error={ordersQuery.error}
            onRetry={() => void ordersQuery.refetch()}
          />
        </div>
      ) : null}

      {activeTab === 'addresses' ? (
        <div className="mx-auto w-full max-w-container">
          <SavedAddressesSection
            profileFallback={{ name: user.name, phoneNumber: user.phoneNumber }}
            onSessionExpired={handleSessionExpired}
          />
        </div>
      ) : null}

      {activeTab === 'personal' ? (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-10">
          <div className="lg:col-span-7">
            <PersonalInfoSection
              user={user}
              editingRequested={editPersonalRequested}
              onEditingRequestedHandled={() => setEditPersonalRequested(false)}
              onSessionExpired={handleSessionExpired}
            />
          </div>
          <div className="lg:col-span-5">
            <SecuritySessionSection user={user} />
          </div>
        </div>
      ) : null}

      {activeTab === 'support' ? (
        <div className="mx-auto w-full max-w-container">
          <SupportHelpSection
            orders={orderItems}
            onSessionExpired={handleSessionExpired}
          />
        </div>
      ) : null}

      {/* Care Profile Edit Modal */}
      <CareProfileEditModal
        isOpen={isEditCareModalOpen}
        onClose={() => setIsEditCareModalOpen(false)}
        initialProfile={careProfileQuery.data ?? null}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ['customer-care-profile'] });
        }}
      />
    </div>
  );
}
