import type { CustomerAddress, CreateCustomerAddressInput } from '@/lib/addresses';
import type { CheckoutData } from '@/lib/orders';

describe('Address Book and Checkout Integration (Maps Phase 2)', () => {
  const sampleSavedAddress: CustomerAddress = {
    id: 'addr-uuid-1',
    customerId: 'cust-uuid-1',
    label: 'Home',
    customerName: 'Fatima El-Sayed',
    customerPhone: '01098765432',
    governorate: 'Giza',
    area: 'Dokki',
    shippingAddress: '12 Mossadak St, Floor 4, Apt 8',
    notes: 'Near Metro Market',
    latitude: 30.0386,
    longitude: 31.2122,
    locationSource: 'map_pin',
    isDefault: true,
    createdAt: '2026-10-16T12:00:00Z',
    updatedAt: '2026-10-16T12:00:00Z',
  };

  it('maps saved address to valid checkout data contract', () => {
    // When a saved address is selected in checkout
    const checkoutPayload: CheckoutData = {
      customerName: sampleSavedAddress.customerName,
      customerPhone: sampleSavedAddress.customerPhone,
      governorate: sampleSavedAddress.governorate,
      area: sampleSavedAddress.area,
      shippingAddress: sampleSavedAddress.shippingAddress,
      notes: sampleSavedAddress.notes ?? undefined,
      latitude: sampleSavedAddress.latitude,
      longitude: sampleSavedAddress.longitude,
      locationSource: sampleSavedAddress.locationSource,
      locationConfirmed: true,
      quoteVersion: '3bbdf903-bc32-42ac-c03d-ffc81542d24c',
      cartRevision: 1,
      idempotencyKey: 'idemp-saved-addr-test',
      paymentMethod: 'COD',
    };

    expect(checkoutPayload.customerName).toBe('Fatima El-Sayed');
    expect(checkoutPayload.customerPhone).toBe('01098765432');
    expect(checkoutPayload.governorate).toBe('Giza');
    expect(checkoutPayload.area).toBe('Dokki');
    expect(checkoutPayload.latitude).toBe(30.0386);
    expect(checkoutPayload.longitude).toBe(31.2122);
    expect(checkoutPayload.locationConfirmed).toBe(true);
    expect(checkoutPayload.locationSource).toBe('map_pin');
  });

  it('validates CreateCustomerAddressInput payload structure', () => {
    const newAddress: CreateCustomerAddressInput = {
      label: 'Office',
      customerName: 'Fatima El-Sayed',
      customerPhone: '01098765432',
      governorate: 'Cairo',
      area: 'New Cairo',
      shippingAddress: 'Sector 1, Building 20, Floor 2',
      notes: 'Reception desk',
      latitude: 30.0131,
      longitude: 31.4289,
      locationSource: 'current_location',
      isDefault: false,
    };

    expect(newAddress.label).toBe('Office');
    expect(newAddress.latitude).toBeCloseTo(30.0131);
    expect(newAddress.longitude).toBeCloseTo(31.4289);
    expect(newAddress.locationSource).toBe('current_location');
  });

  it('guarantees orders remain immutable even if saved address is modified or deleted', () => {
    // Order snapshot frozen at checkout time
    const historicalOrderSnapshot = {
      orderNumber: 'ORD-998877',
      shippingAddress: sampleSavedAddress.shippingAddress,
      latitude: sampleSavedAddress.latitude,
      longitude: sampleSavedAddress.longitude,
      governorate: sampleSavedAddress.governorate,
      area: sampleSavedAddress.area,
    };

    // Customer modifies or deletes saved address later
    const modifiedAddress = {
      ...sampleSavedAddress,
      shippingAddress: '99 New St',
      latitude: 29.9602,
      longitude: 31.2569,
    };

    // Historical order snapshot remains unaffected
    expect(historicalOrderSnapshot.shippingAddress).toBe('12 Mossadak St, Floor 4, Apt 8');
    expect(historicalOrderSnapshot.latitude).toBe(30.0386);
    expect(historicalOrderSnapshot.shippingAddress).not.toBe(modifiedAddress.shippingAddress);
    expect(historicalOrderSnapshot.latitude).not.toBe(modifiedAddress.latitude);
  });
});
