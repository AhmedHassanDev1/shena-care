import { normalizeEgyptianMobile, toLatinDigits } from '@/features/auth/lib/auth-helpers';
import { toGovernorate } from '@/features/checkout/lib/checkout-draft';
import type { LocationPin } from '@/features/checkout/components/DeliveryLocationPicker';
import type { CustomerAddress } from '@/lib/addresses';
import type { Messages } from '@/lib/i18n/messages';

export interface AddressFormData {
  label: string;
  customerName: string;
  customerPhone: string;
  governorate: string;
  area: string;
  shippingAddress: string;
  notes: string;
  isDefault: boolean;
}

export const EMPTY_ADDRESS_FORM: AddressFormData = {
  label: '',
  customerName: '',
  customerPhone: '',
  governorate: '',
  area: '',
  shippingAddress: '',
  notes: '',
  isDefault: false,
};

const REQUIRED_FIELDS: Array<keyof AddressFormData> = [
  'customerName',
  'customerPhone',
  'governorate',
  'area',
  'shippingAddress',
];

export function addressFormFromCustomerAddress(addr: CustomerAddress): AddressFormData {
  return {
    label: addr.label ?? '',
    customerName: addr.customerName,
    customerPhone: addr.customerPhone,
    governorate: addr.governorate,
    area: addr.area,
    shippingAddress: addr.shippingAddress,
    notes: addr.notes ?? '',
    isDefault: addr.isDefault,
  };
}

export function addressFormWithProfile(
  name?: string | null,
  phone?: string | null,
  isDefault = false,
): AddressFormData {
  return {
    ...EMPTY_ADDRESS_FORM,
    customerName: name?.trim() ?? '',
    customerPhone: phone?.trim() ?? '',
    isDefault,
  };
}

export function pinFromCustomerAddress(addr: CustomerAddress): LocationPin {
  return {
    latitude: addr.latitude,
    longitude: addr.longitude,
    locationSource: addr.locationSource,
    confirmed: true,
  };
}

export function normalizeFormGovernorate(value: string): 'Cairo' | 'Giza' | null {
  const gov = value.trim().toLowerCase();
  if (gov === 'cairo' || gov === 'القاهرة') return 'Cairo';
  if (gov === 'giza' || gov === 'الجيزة') return 'Giza';
  return toGovernorate(value) || null;
}

export function formatSavedAddressLine(
  addr: Pick<CustomerAddress, 'shippingAddress' | 'area' | 'governorate'>,
  m: Messages,
): string {
  const gov = toGovernorate(addr.governorate);
  const govLabel = gov === 'Cairo' ? m.checkoutCairo : gov === 'Giza' ? m.checkoutGiza : addr.governorate;
  return [addr.shippingAddress, addr.area, govLabel].filter(Boolean).join('، ');
}

export function sortAddressesDefaultFirst(addresses: CustomerAddress[]): CustomerAddress[] {
  return [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

export function validateAddressForm(
  data: AddressFormData,
  pin: LocationPin | null,
  m: Messages,
): {
  fieldErrors: Partial<Record<keyof AddressFormData, string>>;
  pinError: string | null;
  valid: boolean;
} {
  const fieldErrors: Partial<Record<keyof AddressFormData, string>> = {};

  for (const key of REQUIRED_FIELDS) {
    const val = data[key];
    if (typeof val === 'string' && !val.trim()) {
      fieldErrors[key] = m.checkoutRequired;
    }
  }

  const rawPhone = toLatinDigits(data.customerPhone).replace(/[\s-]/g, '');
  if (rawPhone && !normalizeEgyptianMobile(rawPhone)) {
    fieldErrors.customerPhone = m.checkoutPhoneInvalid;
  }

  if (data.governorate.trim() && !normalizeFormGovernorate(data.governorate)) {
    fieldErrors.governorate = m.checkoutMapOutOfService;
  }

  let pinError: string | null = null;
  if (!pin) {
    pinError = m.checkoutMapPinRequired;
  } else if (!pin.confirmed) {
    pinError = m.checkoutMapConfirmRequired;
  }

  return {
    fieldErrors,
    pinError,
    valid: Object.keys(fieldErrors).length === 0 && !pinError,
  };
}
