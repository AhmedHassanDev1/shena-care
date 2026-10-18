'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageBox } from '@/components/ui/message-box';
import { StatusChip } from '@/components/ui/status-chip';
import { Button, buttonVariants } from '@/components/ui/button';
import { PhoneField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthContext';
import { useAddresses } from '../hooks/useAddresses';
import {
  DeliveryLocationPicker,
  type LocationPin,
  isInsideServiceArea,
  isDefaultCentre,
} from '@/features/checkout/components/DeliveryLocationPicker';
import { type CustomerAddress, type CreateCustomerAddressInput } from '@/lib/addresses';
import { ApiError } from '@/lib/api-client';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

interface AddressFormData {
  label: string;
  customerName: string;
  customerPhone: string;
  governorate: string;
  area: string;
  shippingAddress: string;
  notes: string;
  isDefault: boolean;
}

const EMPTY_FORM: AddressFormData = {
  label: '',
  customerName: '',
  customerPhone: '',
  governorate: '',
  area: '',
  shippingAddress: '',
  notes: '',
  isDefault: false,
};

const EGYPT_MOBILE = /^(\+201|01)[0-9]{9}$/;
const REQUIRED_FIELDS: Array<keyof AddressFormData> = [
  'customerName',
  'customerPhone',
  'governorate',
  'area',
  'shippingAddress',
];

export function AddressBookView() {
  const m = useMessages();
  const locale = useLocale();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const {
    addresses,
    isLoading: addressesLoading,
    createAddress,
    isCreating,
    updateAddress,
    isUpdating,
    deleteAddress,
    isDeleting,
    setDefaultAddress,
    isSettingDefault,
  } = useAddresses();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<AddressFormData>(EMPTY_FORM);
  const [pin, setPin] = useState<LocationPin | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof AddressFormData, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-control-l w-full" />
        <Skeleton className="h-32 w-full rounded-input" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <div className="rounded-input border border-line bg-linen p-8">
          <Icon name="pin" size={40} className="mx-auto text-ink-3" />
          <h1 className="mt-3 text-display-3 text-night">{m.addressBookTitle}</h1>
          <p className="mt-2 text-14 text-ink-2">{m.myOrdersSignIn}</p>
          <div className="mt-6">
            <Link
              href={`${routes.login}?returnTo=${encodeURIComponent(routes.accountAddresses)}`}
              className={buttonVariants({ size: 'l' })}
            >
              {m.myOrdersSignInButton}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const openAddForm = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setPin(null);
    setPinError(null);
    setErrors({});
    setSubmitError(null);
    setSuccessMessage(null);
    setFormOpen(true);
  };

  const openEditForm = (addr: CustomerAddress) => {
    setEditingId(addr.id);
    setFormData({
      label: addr.label ?? '',
      customerName: addr.customerName,
      customerPhone: addr.customerPhone,
      governorate: addr.governorate,
      area: addr.area,
      shippingAddress: addr.shippingAddress,
      notes: addr.notes ?? '',
      isDefault: addr.isDefault,
    });
    setPin({
      latitude: addr.latitude,
      longitude: addr.longitude,
      locationSource: addr.locationSource,
      confirmed: true,
    });
    setPinError(null);
    setErrors({});
    setSubmitError(null);
    setSuccessMessage(null);
    setFormOpen(true);
  };

  const cancelForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setPin(null);
    setPinError(null);
    setErrors({});
    setSubmitError(null);
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof AddressFormData, string>> = {};
    for (const key of REQUIRED_FIELDS) {
      const val = formData[key];
      if (typeof val === 'string' && !val.trim()) {
        next[key] = m.checkoutRequired;
      }
    }

    const phone = formData.customerPhone.replace(/\s+/g, '');
    if (phone && !EGYPT_MOBILE.test(phone)) {
      next.customerPhone = m.checkoutPhoneInvalid;
    }

    const gov = formData.governorate.trim().toLowerCase();
    if (gov && gov !== 'cairo' && gov !== 'giza' && gov !== 'القاهرة' && gov !== 'الجيزة') {
      next.governorate = m.checkoutMapOutOfService;
    }

    setErrors(next);

    let locErr: string | null = null;
    if (!pin) {
      locErr = m.checkoutMapPinRequired;
    } else if (!pin.confirmed) {
      locErr = m.checkoutMapConfirmRequired;
    } else if (!isInsideServiceArea(pin.latitude, pin.longitude)) {
      locErr = m.checkoutMapOutOfService;
    } else if (isDefaultCentre(pin.latitude, pin.longitude)) {
      locErr = m.checkoutMapImprobablePin;
    }
    setPinError(locErr);

    return Object.keys(next).length === 0 && !locErr;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate() || !pin || !pin.confirmed) return;

    setSubmitError(null);
    setSuccessMessage(null);

    const payload: CreateCustomerAddressInput = {
      label: formData.label.trim() || undefined,
      customerName: formData.customerName.trim(),
      customerPhone: formData.customerPhone.replace(/\s+/g, ''),
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
      if (editingId) {
        await updateAddress({ id: editingId, data: payload });
      } else {
        await createAddress(payload);
      }
      setSuccessMessage(m.addressBookSaveSuccess);
      cancelForm();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422) {
          setSubmitError(m.checkoutMapOutOfService);
        } else {
          setSubmitError(err.message || m.unexpectedError);
        }
      } else {
        setSubmitError(m.unexpectedError);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(m.addressBookDeleteConfirm)) return;
    setDeletingId(id);
    try {
      await deleteAddress(id);
      setSuccessMessage(m.addressBookDeleteSuccess);
    } catch (err) {
      setSubmitError(m.unexpectedError);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultAddress(id);
      setSuccessMessage(m.addressBookSetDefaultSuccess);
    } catch (err) {
      setSubmitError(m.unexpectedError);
    }
  };

  const isSaving = isCreating || isUpdating;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-display-3 text-night">{m.addressBookTitle}</h1>
          <p className="text-12 text-ink-2">{m.addressBookSubtitle}</p>
        </div>
        {!formOpen && (
          <Button onClick={openAddForm} size="s">
            <Icon name="plus" size={18} className="me-1.5" />
            {m.addressBookAddNew}
          </Button>
        )}
      </header>

      {successMessage && (
        <MessageBox tone="ok" className="border-blue/30 bg-blue-tint text-blue">
          <div className="flex items-center gap-2">
            <Icon name="check" size={18} />
            <p className="text-14">{successMessage}</p>
          </div>
        </MessageBox>
      )}

      {submitError && (
        <MessageBox tone="err">
          <div className="flex items-center gap-2">
            <Icon name="alert" size={18} />
            <p className="text-14">{submitError}</p>
          </div>
        </MessageBox>
      )}

      {formOpen ? (
        <div className="rounded-card bg-linen shadow-outline-hairline">
          <div className="flex flex-col gap-1.5 px-5 pt-5">
            <h2 className="m-0 text-display-3 text-night">{editingId ? m.addressBookEdit : m.addressBookAddNew}</h2>
          </div>
          <div className="px-5 py-4">
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <TextField
                label={m.addressBookLabelOptional}
                placeholder={locale === 'ar' ? 'مثال: البيت، المكتب' : 'e.g. Home, Office'}
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              />

              <TextField
                label={m.checkoutName}
                required
                value={formData.customerName}
                error={errors.customerName}
                onChange={(e) => {
                  setFormData({ ...formData, customerName: e.target.value });
                  if (errors.customerName) setErrors({ ...errors, customerName: undefined });
                }}
              />

              <PhoneField
                label={m.checkoutPhone}
                required
                placeholder="01012345678"
                hint={errors.customerPhone ? undefined : m.checkoutPhoneHint}
                value={formData.customerPhone}
                error={errors.customerPhone}
                onChange={(e) => {
                  setFormData({ ...formData, customerPhone: e.target.value });
                  if (errors.customerPhone) setErrors({ ...errors, customerPhone: undefined });
                }}
              />

              <div className="space-y-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label={m.checkoutGovernorate}
                    required
                    value={formData.governorate}
                    error={errors.governorate}
                    onChange={(e) => {
                      setFormData({ ...formData, governorate: e.target.value });
                      if (errors.governorate) setErrors({ ...errors, governorate: undefined });
                    }}
                  />
                  <TextField
                    label={m.checkoutArea}
                    required
                    value={formData.area}
                    error={errors.area}
                    onChange={(e) => {
                      setFormData({ ...formData, area: e.target.value });
                      if (errors.area) setErrors({ ...errors, area: undefined });
                    }}
                  />
                </div>
                {/* Cairo / Giza quick selector */}
                <div className="flex items-center gap-2">
                  <span className="text-12 text-ink-3">{m.checkoutGovernorate}:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const val = locale === 'ar' ? 'القاهرة' : 'Cairo';
                      setFormData((prev) => ({ ...prev, governorate: val }));
                      if (errors.governorate) setErrors((prev) => ({ ...prev, governorate: undefined }));
                    }}
                    className={cn(
                      'rounded-pill border px-2.5 py-1 text-12 transition-colors',
                      formData.governorate.toLowerCase() === 'cairo' || formData.governorate === 'القاهرة'
                        ? 'border-blue bg-blue-tint text-blue'
                        : 'border-line bg-linen text-ink-2 hover:bg-sand',
                    )}
                  >
                    <bdi>{locale === 'ar' ? 'القاهرة' : 'Cairo'}</bdi>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const val = locale === 'ar' ? 'الجيزة' : 'Giza';
                      setFormData((prev) => ({ ...prev, governorate: val }));
                      if (errors.governorate) setErrors((prev) => ({ ...prev, governorate: undefined }));
                    }}
                    className={cn(
                      'rounded-pill border px-2.5 py-1 text-12 transition-colors',
                      formData.governorate.toLowerCase() === 'giza' || formData.governorate === 'الجيزة'
                        ? 'border-blue bg-blue-tint text-blue'
                        : 'border-line bg-linen text-ink-2 hover:bg-sand',
                    )}
                  >
                    <bdi>{locale === 'ar' ? 'الجيزة' : 'Giza'}</bdi>
                  </button>
                </div>
              </div>

              <TextField
                label={m.checkoutAddress}
                required
                hint={errors.shippingAddress ? undefined : m.checkoutAddressHint}
                value={formData.shippingAddress}
                error={errors.shippingAddress}
                onChange={(e) => {
                  setFormData({ ...formData, shippingAddress: e.target.value });
                  if (errors.shippingAddress) setErrors({ ...errors, shippingAddress: undefined });
                }}
              />

              {/* Map Location Picker */}
              <DeliveryLocationPicker
                value={pin}
                onChange={(next) => {
                  setPin(next);
                  if (next?.confirmed) setPinError(null);
                }}
                error={pinError ?? undefined}
              />

              <TextField
                label={m.checkoutNotes}
                optionalLabel={m.checkoutOptional}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />

              <label className="flex cursor-pointer items-center gap-2 pt-1 text-14">
                <input
                  type="checkbox"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="rounded border-line text-blue focus:ring-blue"
                />
                <span>{m.addressBookSetDefault}</span>
              </label>

              <div className="flex items-center justify-end gap-3 pt-3">
                <Button type="button" variant="light" onClick={cancelForm}>
                  {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button type="submit" loading={isSaving}>
                  {locale === 'ar' ? 'حفظ العنوان' : 'Save address'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {addressesLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-input" />
          <Skeleton className="h-28 w-full rounded-input" />
        </div>
      ) : addresses.length === 0 && !formOpen ? (
        <div className="rounded-input border border-dashed border-line p-8 text-center">
          <Icon name="pin" size={36} className="mx-auto text-ink-3" />
          <p className="mt-3 text-14 text-ink-2">{m.addressBookEmpty}</p>
          <Button onClick={openAddForm} size="s" className="mt-4">
            <Icon name="plus" size={18} className="me-1.5" />
            {m.addressBookAddNew}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {addresses.map((addr) => (
            <div
              key={addr.id}
              className={cn('rounded-card bg-linen shadow-outline-hairline', addr.isDefault && 'shadow-outline-blue')}
            >
              <div className="pb-2 flex flex-col gap-1.5 px-5 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-title text-night font-medium">
                      {addr.label || addr.customerName}
                    </span>
                    {addr.isDefault && (
                      <StatusChip tone="blue">
                        {m.addressBookDefaultBadge}
                      </StatusChip>
                    )}
                    <StatusChip tone="gray" className="text-12 text-ink-2 border-line">
                      <Icon name="pin" size={14} className="me-1" />
                      {m.addressBookConfirmedLocation}
                    </StatusChip>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="light"
                      size="s"
                      onClick={() => openEditForm(addr)}
                      disabled={formOpen}
                    >
                      {m.addressBookEdit}
                    </Button>
                    <Button
                      type="button"
                      variant="light"
                      size="s"
                      className="text-err hover:bg-err/10"
                      onClick={() => handleDelete(addr.id)}
                      disabled={deletingId === addr.id || isDeleting || formOpen}
                      loading={deletingId === addr.id}
                    >
                      <Icon name="trash" size={16} />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-1 text-14 text-ink-2 px-5 py-4">
                {addr.label && <p className="text-night">{addr.customerName}</p>}
                <p dir="ltr" className="text-start">
                  <bdi>{addr.customerPhone}</bdi>
                </p>
                <p>
                  {addr.shippingAddress}, {addr.area}, {addr.governorate}
                </p>
                {addr.notes && (
                  <p className="text-12 text-ink-3">
                    {m.checkoutNotes}: {addr.notes}
                  </p>
                )}
                <p className="text-12 text-ink-3" dir="ltr">
                  {fillMessage(m.checkoutMapCoordinates, {
                    lat: addr.latitude.toFixed(4),
                    lng: addr.longitude.toFixed(4),
                  })}
                </p>
              </div>
              {!addr.isDefault && (
                <div className="pt-0 flex items-center gap-2 px-5 pb-5">
                  <Button
                    type="button"
                    variant="light"
                    size="s"
                    onClick={() => handleSetDefault(addr.id)}
                    disabled={isSettingDefault || formOpen}
                  >
                    {m.addressBookSetDefault}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
