import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { OrderingService } from '../../src/modules/ordering/services/ordering.service';
import { CartService } from '../../src/modules/ordering/services/cart.service';
import type { CheckoutDto } from '../../src/modules/ordering/dto/order.dto';
import { createActor, Actor } from './actors';

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
 * Seeds a LEGACY guest COD order: a real guest cart and quote over HTTP, then the order through OrderingService with
 * the guest owner. Since the SAHEL V18 decision (2026-10-18) HTTP order placement requires a signed-in customer, so
 * new guest orders can only exist as data created before that change; guest tracking, cancellation, support and
 * recovery still serve them. Downstream suites (sourcing, finance, delivery) use this to get a placed order.
 */
export async function placeGuestOrder(
  app: INestApplication,
  lines: Array<{ skuId: string; quantity: number }>,
  overrides: Record<string, unknown> = {},
): Promise<PlacedOrder> {
  const http = () => request(app.getHttpServer());
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
  const placed = await app.get(OrderingService).checkout({ guestToken: token! }, body as unknown as CheckoutDto);
  return { ...(JSON.parse(JSON.stringify(placed)) as PlacedOrder), cartToken: token!, body };
}

/**
 * A signed-in customer for HTTP checkout (CustomerSessionGuard). `adoptGuestCart` attaches a guest cart to the
 * account exactly as phone sign-in does (CUSTOMER_VERIFIED_EVENT → CartService.adoptGuestCart).
 */
export async function signInCustomer(app: INestApplication, guestCartToken?: string): Promise<Actor> {
  const customer = await createActor(app.get(PrismaService), Role.CUSTOMER);
  if (guestCartToken) await app.get(CartService).adoptGuestCart(customer.id, guestCartToken);
  return customer;
}
