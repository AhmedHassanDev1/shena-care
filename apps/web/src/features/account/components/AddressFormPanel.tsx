'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TextField } from '@/components/ui/field';
import { MessageBox } from '@/components/ui/message-box';
import { DeliveryLocationPicker, type LocationPin } from '@/features/checkout/components/DeliveryLocationPicker';
import type { CustomerAddress } from '@/lib/addresses';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';
import { useAddresses } from '../hooks/useAddresses';
import {
  addressFormFromCustomerAddress,
  addressFormWithProfile,
  normalizeFormGovernorate,
  pinFromCustomerAddress,
  validateAddressForm,
  type AddressFormData,
} from '../lib/address-helpers';

export interface AddressFormPanelProps {
  /** Null when creating a new address; existing record when editing. */
  editingAddress: CustomerAddress | null;
  /** Used to prefill recipient name/mobile when adding a new address. */
  profileFallback?: { name?: string | null; phoneNumber?: string | null };
  hasExistingAddresses: boolean;
  onSaved: (mode: 'create' | 'update') => void;
  onCancel: () => void;
}

/**
 * Shared SAHEL v4 address add/edit form panel reused between Profile (/account)
 * and the standalone Address Book (/account/addresses) so Checkout & Account stay synced.
 */
export function AddressFormPanel({
  editingAddress,
  profileFallback,
  hasExistingAddresses,
  onSaved,
  onCancel,
}: AddressFormPanelProps) {
  const m = useMessages();
  const locale = useLocale();
  const { createAddress, updateAddress } = useAddresses();

  const [formData, setFormData] = useState<AddressFormData>(() =>
    editingAddress
      ? addressFormFromCustomerAddress(editingAddress)
      : addressFormWithProfile(profileFallback?.name, profileFallback?.phoneNumber, !hasExistingAddresses),
  );
  const [pin, setPin] = useState<LocationPin | null>(() =>
    editingAddress ? pinFromCustomerAddress(editingAddress) : null,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof AddressFormData, string>>>({});
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<AsyncState>('idle');

  const panelRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Partial<Record<keyof AddressFormData, HTMLInputElement | null>>>({});

  useEffect(() => {
    setFormData(
      editingAddress
        ? addressFormFromCustomerAddress(editingAddress)
        : addressFormWithProfile(profileFallback?.name, profileFallback?.phoneNumber, !hasExistingAddresses),
    );
    setPin(editingAddress ? pinFromCustomerAddress(editingAddress) : null);
    setErrors({});
    setPinError(null);
    setSubmitError(null);
    setSubmitState('idle');
  }, [editingAddress, hasExistingAddresses, profileFallback?.name, profileFallback?.phoneNumber]);

  const setField = <K extends keyof AddressFormData>(key: K, value: AddressFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (key in errors) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const selectedGov = normalizeFormGovernorate(formData.governorate);
  const presets = [m.profileAddressPresetHome, m.profileAddressPresetWork];

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitState === 'pending') return;

    const result = validateAddressForm(formData, pin, m);
    setErrors(result.fieldErrors);
    setPinError(result.pinError);
    if (!result.valid || !pin) {
      const firstKey = Object.keys(result.fieldErrors)[0] as keyof AddressFormData | undefined;
      if (firstKey) fieldRefs.current[firstKey]?.focus();
      return;
    }

    setSubmitError(null);
    setSubmitState('pending');

    const payload = {
      label: formData.label.trim() || undefined,
      customerName: formData.customerName.trim(),
      customerPhone: formData.customerPhone.trim(),
      governorate: formData.governorate.trim(),
      area: formData.area.trim(),
      shippingAddress: formData.shippingAddress.trim(),
      notes: formData.notes.trim() || undefined,
      latitude: pin.latitude,
      longitude: pin.longitude,
      locationSource: pin.locationSource,
      isDefault: formData.isDefault,
    };

    try {
      if (editingAddress) {
        await updateAddress({ id: editingAddress.id, data: payload });
        onSaved('update');
      } else {
        await createAddress(payload);
        onSaved('create');
      }
      setSubmitState('idle');
    } catch (err: unknown) {
      setSubmitState('idle');
      const message = err instanceof Error && err.message ? err.message : m.profileAddressSaveFailed;
      setSubmitError(message);
    }
  };

  return (
    <div
      ref={panelRef}
      className="rounded-card border border-line bg-linen p-5 shadow-elevation-1 md:p-6"
    >
      <div className="mb-5 flex items-center justify-between gap-3 border-b border-line pb-4">
        <h3 className="m-0 font-display text-22 font-bold leading-28 text-ink">
          {editingAddress ? m.addressBookEdit : m.addressBookAddNew}
        </h3>
        <Button type="button" variant="ghost" size="s" onClick={onCancel}>
          {m.profileAddressCancel}
        </Button>
      </div>

      {submitError ? (
        <MessageBox tone="err" className="mb-5">
          {submitError}
        </MessageBox>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((preset) => (
              <Chip
                key={preset}
                selected={formData.label.trim() === preset}
                onClick={() => setField('label', formData.label.trim() === preset ? '' : preset)}
              >
                {preset}
              </Chip>
            ))}
          </div>
          <TextField
            label={m.addressBookLabelOptional}
            placeholder={locale === 'ar' ? 'مثال: البيت، المكتب' : 'e.g. Home, Work'}
            value={formData.label}
            onChange={(e) => setField('label', e.target.value)}
            maxLength={50}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField
            ref={(el) => {
              fieldRefs.current.customerName = el;
            }}
            label={m.checkoutName}
            value={formData.customerName}
            onChange={(e) => setField('customerName', e.target.value)}
            error={errors.customerName}
            autoComplete="name"
          />
          <TextField
            ref={(el) => {
              fieldRefs.current.customerPhone = el;
            }}
            label={m.checkoutPhone}
            hint={m.checkoutPhoneHint}
            value={formData.customerPhone}
            onChange={(e) => setField('customerPhone', e.target.value)}
            error={errors.customerPhone}
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="tel-national"
          />
        </div>

        <div className="rounded-card border border-line bg-chalk p-4">
          <DeliveryLocationPicker
            value={pin}
            onChange={(next) => {
              setPin(next);
              if (next?.confirmed) setPinError(null);
            }}
            error={pinError ?? undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-13 font-semibold text-stone">{m.checkoutGovernorate}</span>
              <button
                type="button"
                onClick={() => setField('governorate', m.checkoutCairo)}
                className={cn(
                  'min-h-8 rounded-pill border px-3 text-13 font-display font-semibold transition-colors',
                  selectedGov === 'Cairo'
                    ? 'border-cobalt bg-cobalt text-chalk'
                    : 'border-line bg-chalk text-ink hover:bg-sand/50',
                )}
              >
                {m.checkoutCairo}
              </button>
              <button
                type="button"
                onClick={() => setField('governorate', m.checkoutGiza)}
                className={cn(
                  'min-h-8 rounded-pill border px-3 text-13 font-display font-semibold transition-colors',
                  selectedGov === 'Giza'
                    ? 'border-cobalt bg-cobalt text-chalk'
                    : 'border-line bg-chalk text-ink hover:bg-sand/50',
                )}
              >
                {m.checkoutGiza}
              </button>
            </div>
            <TextField
              ref={(el) => {
                fieldRefs.current.governorate = el;
              }}
              aria-label={m.checkoutGovernorate}
              value={formData.governorate}
              onChange={(e) => setField('governorate', e.target.value)}
              error={errors.governorate}
            />
          </div>

          <TextField
            ref={(el) => {
              fieldRefs.current.area = el;
            }}
            label={m.checkoutArea}
            placeholder={m.checkoutAreaHint}
            value={formData.area}
            onChange={(e) => setField('area', e.target.value)}
            error={errors.area}
          />
        </div>

        <TextField
          ref={(el) => {
            fieldRefs.current.shippingAddress = el;
          }}
          label={m.checkoutAddress}
          placeholder={m.checkoutAddressHint}
          value={formData.shippingAddress}
          onChange={(e) => setField('shippingAddress', e.target.value)}
          error={errors.shippingAddress}
          autoComplete="street-address"
        />

        <TextField
          label={m.checkoutNotes}
          optionalLabel={m.checkoutOptional}
          placeholder={m.profileAddressNotesHint}
          value={formData.notes}
          onChange={(e) => setField('notes', e.target.value)}
        />

        <label className="flex min-h-control-s cursor-pointer items-center gap-3 font-display text-15 text-ink">
          <input
            type="checkbox"
            checked={formData.isDefault}
            onChange={(e) => setField('isDefault', e.target.checked)}
            className="size-4.5 accent-cobalt"
          />
          <span>{m.profileAddressSetDefaultCheck}</span>
        </label>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <AsyncButton
            type="submit"
            variant="cobalt"
            size="l"
            state={submitState}
            pendingLabel={m.profileAddressSaving}
          >
            {m.profileAddressSave}
          </AsyncButton>
          <Button type="button" variant="ghost" size="l" onClick={onCancel}>
            {m.profileAddressCancel}
          </Button>
        </div>
      </form>
    </div>
  );
}
