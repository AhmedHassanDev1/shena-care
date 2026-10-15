import { randomUUID } from 'crypto';
import request from 'supertest';

/** A customer-confirmed delivery pin inside the Cairo service area (Maadi). */
export const CAIRO_PIN = { latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true };

export interface PlacedOrder {
  id: string;
  orderNumber: string;
  items: Array<{ id: string; skuId: string; quantity: number }>;
  codAmount: number;
  totalAmount: number;
  guestAccessToken?: string;
  cartToken: string;
  body: Record<string, unknown>;
}

/**
 * Places a real guest COD order through the public HTTP checkout: cart → quote → submit.
 * `lines` are added to one guest cart; `overrides` change the submitted delivery details.
 */
export async function placeGuestOrder(
  server: Parameters<typeof request>[0],
  lines: Array<{ skuId: string; quantity: number }>,
  overrides: Record<string, unknown> = {},
): Promise<PlacedOrder> {
  const http = () => request(server);
  let token: string | undefined;
  for (const line of lines) {
    const added = await http().post('/ordering/cart/add').set(token ? { 'x-cart-token': token } : {})
      .send(line).expect(201);
    token = token ?? added.body.guestCartToken;
  }
  const address = { governorate: 'Cairo', area: 'Maadi' };
  const quote = await http().post('/ordering/checkout/quote').set('x-cart-token', token!).send(address).expect(201);
  const body = {
    ...address, customerName: 'C2C Customer', customerPhone: '01012345678',
    shippingAddress: '12 Road 9, Maadi', ...CAIRO_PIN,
    quoteVersion: quote.body.quoteVersion, cartRevision: quote.body.revision, idempotencyKey: randomUUID(),
    ...overrides,
  };
  const placed = await http().post('/ordering/checkout').set('x-cart-token', token!).send(body).expect(201);
  return { ...placed.body, cartToken: token!, body };
}
