'use client';

import { useEffect, useState } from 'react';
import { ArrowLink } from '@/components/ui/arrow-link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { displayMobile } from '@/features/auth/lib/auth-helpers';
import type { CustomerAddress } from '@/lib/addresses';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useAddresses } from '../hooks/useAddresses';
import { formatSavedAddressLine, sortAddressesDefaultFirst } from '../lib/address-helpers';
import { AddressFormPanel } from './AddressFormPanel';
import { DeleteAddressDialog } from './DeleteAddressDialog';

export interface SavedAddressesSectionProps {
  profileFallback?: { name?: string | null; phoneNumber?: string | null };
  onSessionExpired?: () => void;
}

/**
 * Customer Saved Addresses section inside Profile (/account).
 * Shares React Query cache (`ADDRESSES_QUERY_KEY`) with Checkout and /account/addresses.
 */
export function SavedAddressesSection({
  profileFallback,
  onSessionExpired,
}: SavedAddressesSectionProps) {
  const m = useMessages();
  const {
    addresses,
    isLoading,
    error,
    refetch,
    deleteAddress,
    isDeleting,
    setDefaultAddress,
    isSettingDefault,
  } = useAddresses();

  const [formMode, setFormMode] = useState<'closed' | 'create' | CustomerAddress>('closed');
  const [deleteTarget, setDeleteTarget] = useState<CustomerAddress | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (error && (error as { status?: number }).status === 401) {
      onSessionExpired?.();
    }
  }, [error, onSessionExpired]);

  const ordered = sortAddressesDefaultFirst(addresses);

  const handleSetDefault = async (addressId: string) => {
    if (isSettingDefault) return;
    setFeedback(null);
    setSettingDefaultId(addressId);
    try {
      await setDefaultAddress(addressId);
      setFeedback({ tone: 'ok', text: m.addressBookSetDefaultSuccess });
    } catch {
      setFeedback({ tone: 'err', text: m.profileAddressSaveFailed });
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setFeedback(null);
    try {
      await deleteAddress(deleteTarget.id);
      if (formMode !== 'closed' && formMode !== 'create' && formMode.id === deleteTarget.id) {
        setFormMode('closed');
      }
      setDeleteTarget(null);
      setFeedback({ tone: 'ok', text: m.addressBookDeleteSuccess });
    } catch {
      setDeleteTarget(null);
      setFeedback({ tone: 'err', text: m.profileAddressSaveFailed });
    }
  };

  return (
    <section id="account-addresses" aria-labelledby="profile-addresses-heading" className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2
            id="profile-addresses-heading"
            className="m-0 font-display text-display-3 font-extrabold text-ink"
          >
            {m.addressBookTitle}
          </h2>
          <p className="m-0 mt-1 text-15 leading-22 text-stone">{m.addressBookSubtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {formMode === 'closed' ? (
            <Button
              type="button"
              variant="cobalt"
              size="s"
              onClick={() => {
                setFeedback(null);
                setFormMode('create');
              }}
            >
              <Icon name="plus" size={16} />
              <span>{m.addressBookAddNew}</span>
            </Button>
          ) : null}
          {addresses.length > 0 ? (
            <ArrowLink href={routes.accountAddresses} className="text-15">
              {m.profileAddressesFullPage}
            </ArrowLink>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <MessageBox tone={feedback.tone} className="mb-4" role="status">
          {feedback.text}
        </MessageBox>
      ) : null}

      {formMode !== 'closed' ? (
        <div className="mb-5">
          <AddressFormPanel
            editingAddress={formMode === 'create' ? null : formMode}
            profileFallback={profileFallback}
            hasExistingAddresses={addresses.length > 0}
            onSaved={() => {
              setFormMode('closed');
              setFeedback({ tone: 'ok', text: m.addressBookSaveSuccess });
            }}
            onCancel={() => setFormMode('closed')}
          />
        </div>
      ) : null}

      {isLoading ? (
        <div className="divide-y divide-line rounded-card border border-line bg-linen">
          {[0, 1].map((idx) => (
            <div key={idx} className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-16 rounded-pill" />
              </div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : error ? (
        <MessageBox tone="err" className="flex flex-col items-start gap-3">
          <span>{m.profileAddressesLoadFailed}</span>
          <Button type="button" variant="ghost" size="s" onClick={() => void refetch()}>
            <Icon name="retry" size={16} />
            <span>{m.profileRetry}</span>
          </Button>
        </MessageBox>
      ) : ordered.length === 0 && formMode === 'closed' ? (
        <div className="rounded-card border border-line bg-linen p-6 text-start">
          <div className="flex items-start gap-3.5">
            <span className="grid size-10 flex-none place-items-center rounded-pill bg-chalk text-cobalt shadow-outline-control">
              <Icon name="pin" size={20} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="m-0 font-display text-17 font-bold text-ink">{m.addressBookEmpty}</p>
              <p className="m-0 text-15 leading-22 text-stone">{m.profileAddressesEmptyHint}</p>
              <div className="pt-2">
                <Button
                  type="button"
                  variant="cobalt"
                  size="m"
                  onClick={() => {
                    setFeedback(null);
                    setFormMode('create');
                  }}
                >
                  <Icon name="plus" size={18} />
                  <span>{m.addressBookAddNew}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : ordered.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-line rounded-card border border-line bg-linen p-0">
          {ordered.map((addr) => {
            const isEditingThis =
              formMode !== 'closed' && formMode !== 'create' && formMode.id === addr.id;
            const titleText = addr.label?.trim() || addr.area;
            const settingThis = settingDefaultId === addr.id;

            return (
              <li
                key={addr.id}
                className={cn(
                  'flex flex-col gap-3 p-5 transition-colors',
                  isEditingThis && 'bg-sand/30',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-17 font-bold text-ink">{titleText}</span>
                  {addr.isDefault ? (
                    <StatusChip tone="cobalt">{m.addressBookDefaultBadge}</StatusChip>
                  ) : null}
                  <span className="inline-flex items-center gap-1 rounded-pill bg-ok-tint px-2.5 py-0.5 text-12 font-semibold text-ok">
                    <Icon name="pin" size={12} />
                    <span>{m.addressBookConfirmedLocation}</span>
                  </span>
                </div>

                <p className="m-0 text-15 leading-22 text-ink">{formatSavedAddressLine(addr, m)}</p>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-14 text-stone">
                  <span>{addr.customerName}</span>
                  <bdi dir="ltr" className="tabular-nums">
                    {displayMobile(addr.customerPhone)}
                  </bdi>
                  {addr.notes ? <span className="text-13">{addr.notes}</span> : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setFeedback(null);
                      setFormMode(addr);
                    }}
                    className={buttonVariants({ variant: 'ghost', size: 's' })}
                  >
                    {m.addressBookEdit}
                  </button>

                  {!addr.isDefault ? (
                    <Button
                      type="button"
                      variant="linen"
                      size="s"
                      loading={settingThis}
                      disabled={isSettingDefault}
                      pendingLabel={m.profileAddressSaving}
                      onClick={() => void handleSetDefault(addr.id)}
                    >
                      {m.addressBookSetDefault}
                    </Button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      setFeedback(null);
                      setDeleteTarget(addr);
                    }}
                    className="ms-auto inline-flex min-h-control-s items-center rounded-pill px-3 text-14 font-display font-semibold text-tomato-ink transition-colors hover:bg-conflict"
                  >
                    {m.addressBookDelete}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <DeleteAddressDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={handleConfirmDelete}
        deleting={isDeleting}
      />
    </section>
  );
}
