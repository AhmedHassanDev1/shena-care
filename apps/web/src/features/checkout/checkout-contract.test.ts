import type { CheckoutData, CheckoutQuote, OrderTracking } from '@/lib/orders';

describe('Checkout and Order Tracking Contracts', () => {
  const validQuote: CheckoutQuote = {
    quoteVersion: '3bbdf903-bc32-42ac-c03d-ffc81542d24c',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    revision: 2,
    governorate: 'Cairo',
    area: 'Maadi',
    cartRevision: 2,
    subtotal: 200,
    shippingFee: 50,
    codAmount: 250,
    totalAmount: 250,
    currency: 'EGP',
    deliveryPromise: 'Delivery timing will be confirmed after sourcing.',
    availabilityCertainty: 'not_confirmed',
    items: [
      {
        skuId: 'sku-1',
        productName: 'Hydrating Face Cream',
        variantName: '50ml',
        quantity: 2,
        unitPrice: 100,
        lineTotal: 200,
        currency: 'EGP',
      },
    ],
    invalidItems: [],
  };

  it('constructs a compliant CheckoutData payload with mandatory confirmed pin', () => {
    const checkoutPayload: CheckoutData = {
      customerName: 'Ahmad Hassan',
      customerPhone: '01012345678',
      governorate: 'Cairo',
      area: 'Maadi',
      shippingAddress: '15 Road 9, Floor 3, Apt 12',
      notes: 'Near the metro station',
      latitude: 29.9602,
      longitude: 31.2569,
      locationSource: 'map_pin',
      locationConfirmed: true,
      quoteVersion: validQuote.quoteVersion,
      cartRevision: validQuote.cartRevision,
      idempotencyKey: 'idemp-stable-key-12345',
      paymentMethod: 'COD',
    };

    expect(checkoutPayload.locationConfirmed).toBe(true);
    expect(checkoutPayload.locationSource).toBe('map_pin');
    expect(checkoutPayload.latitude).toBeCloseTo(29.9602);
    expect(checkoutPayload.longitude).toBeCloseTo(31.2569);
    expect(checkoutPayload.paymentMethod).toBe('COD');
    expect(checkoutPayload.quoteVersion).toBe(validQuote.quoteVersion);
    expect(checkoutPayload.cartRevision).toBe(validQuote.cartRevision);
  });

  it('verifies order tracking contract preserves confirmed pin and delivery address', () => {
    const trackingResponse: OrderTracking = {
      orderNumber: 'ORD-1234567890ABCDEF',
      createdAt: new Date().toISOString(),
      status: 'RECEIVED',
      orderReceived: true,
      availabilityConfirmed: false,
      customerName: 'Ahmad Hassan',
      deliveryAddress: {
        governorate: 'Cairo',
        area: 'Maadi',
        address: '15 Road 9',
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
      },
      amounts: {
        originalCodAmount: 250,
        currentCodAmount: 250,
        subtotal: 200,
        shippingFee: 50,
        currency: 'EGP',
      },
      items: [
        {
          id: 'item-1',
          skuId: 'sku-1',
          productName: 'Hydrating Face Cream',
          variantName: '50ml',
          quantity: 2,
          unitPrice: 100,
          lineTotal: 200,
          currency: 'EGP',
          status: 'checking',
          lineState: 'active',
        },
      ],
      timeline: [
        { status: 'RECEIVED', occurredAt: new Date().toISOString() },
      ],
      delivery: {
        certainty: 'estimated',
        estimatedDate: null,
        deliveredAt: null,
        nextUpdateBy: null,
        promise: 'Delivery timing will be confirmed after sourcing.',
      },
      actionRequired: null,
      resolutions: [],
    };

    expect(trackingResponse.orderReceived).toBe(true);
    expect(trackingResponse.availabilityConfirmed).toBe(false);
    expect(trackingResponse.deliveryAddress.latitude).toBe(29.9602);
    expect(trackingResponse.deliveryAddress.longitude).toBe(31.2569);
    expect(trackingResponse.amounts.currentCodAmount).toBe(250);
  });
});
