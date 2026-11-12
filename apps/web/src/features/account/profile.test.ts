import { displayEmail } from '@/lib/auth';
import { messages } from '@/lib/i18n/messages';
import type { CustomerAddress } from '@/lib/addresses';
import {
  addressFormWithProfile,
  EMPTY_ADDRESS_FORM,
  formatSavedAddressLine,
  sortAddressesDefaultFirst,
  validateAddressForm,
} from './lib/address-helpers';

describe('Customer Profile Helpers & Contracts', () => {
  it('hides synthetic placeholder emails while preserving customer emails', () => {
    expect(displayEmail('201012345678@placeholder.com')).toBeNull();
    expect(displayEmail('201012345678@PLACEHOLDER.COM')).toBeNull();
    expect(displayEmail('')).toBeNull();
    expect(displayEmail(null)).toBeNull();
    expect(displayEmail('sara@example.com')).toBe('sara@example.com');
  });

  it('sorts default delivery address first without mutating original array', () => {
    const base = {
      customerId: 'cust-1',
      customerName: 'سارة',
      customerPhone: '01012345678',
      governorate: 'Cairo',
      area: 'Nasr City',
      shippingAddress: 'Street 10',
      notes: null,
      latitude: 30.06,
      longitude: 31.33,
      locationSource: 'map_pin' as const,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };
    const items: CustomerAddress[] = [
      { ...base, id: 'addr-1', label: 'Work', isDefault: false },
      { ...base, id: 'addr-2', label: 'Home', isDefault: true },
    ];

    const sorted = sortAddressesDefaultFirst(items);
    expect(sorted.map((a) => a.id)).toEqual(['addr-2', 'addr-1']);
    expect(items[0].id).toBe('addr-1');
  });

  it('formats Cairo and Giza governorates in the active locale', () => {
    expect(
      formatSavedAddressLine(
        { shippingAddress: '14 Makram Ebeid', area: 'Nasr City', governorate: 'Cairo' },
        messages.ar,
      ),
    ).toBe('14 Makram Ebeid، Nasr City، القاهرة');

    expect(
      formatSavedAddressLine(
        { shippingAddress: '5 Dokki St', area: 'Dokki', governorate: 'الجيزة' },
        messages.en,
      ),
    ).toBe('5 Dokki St، Dokki، Giza');
  });

  it('prefills new address form cleanly with profile name and mobile', () => {
    const form = addressFormWithProfile('سارة أحمد', '+201012345678', true);
    expect(form.customerName).toBe('سارة أحمد');
    expect(form.customerPhone).toBe('+201012345678');
    expect(form.isDefault).toBe(true);
  });

  it('enforces Egyptian mobile, Cairo/Giza bounds, and confirmed map pin on address form', () => {
    const missingPin = validateAddressForm(
      {
        ...EMPTY_ADDRESS_FORM,
        customerName: 'Sara Ahmed',
        customerPhone: '01012345678',
        governorate: 'Alexandria',
        area: 'Smouha',
        shippingAddress: 'Street 1',
      },
      null,
      messages.en,
    );
    expect(missingPin.valid).toBe(false);
    expect(missingPin.fieldErrors.governorate).toBe(messages.en.checkoutMapOutOfService);
    expect(missingPin.pinError).toBe(messages.en.checkoutMapPinRequired);

    const invalidPhone = validateAddressForm(
      {
        ...EMPTY_ADDRESS_FORM,
        customerName: 'Sara Ahmed',
        customerPhone: '0212345',
        governorate: 'Cairo',
        area: 'Maadi',
        shippingAddress: 'Road 9',
      },
      { latitude: 29.96, longitude: 31.25, locationSource: 'map_pin', confirmed: true },
      messages.en,
    );
    expect(invalidPhone.valid).toBe(false);
    expect(invalidPhone.fieldErrors.customerPhone).toBe(messages.en.checkoutPhoneInvalid);

    const valid = validateAddressForm(
      {
        ...EMPTY_ADDRESS_FORM,
        customerName: 'Sara Ahmed',
        customerPhone: '01012345678',
        governorate: 'القاهرة',
        area: 'المعادي',
        shippingAddress: 'شارع ٩',
      },
      { latitude: 29.96, longitude: 31.25, locationSource: 'map_pin', confirmed: true },
      messages.ar,
    );
    expect(valid.valid).toBe(true);
    expect(valid.fieldErrors).toEqual({});
    expect(valid.pinError).toBeNull();
  });
});
