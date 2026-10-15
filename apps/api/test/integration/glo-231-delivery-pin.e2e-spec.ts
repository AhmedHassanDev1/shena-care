import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';
import { CAIRO_PIN, placeGuestOrder } from '../fixtures/checkout';

/**
 * GLO-231 backend subsection: every new COD order carries a customer-placed, confirmed pin inside
 * Cairo/Giza; the pin survives a 409 re-quote; dispatch refuses unpinned orders; the assigned driver
 * (only) gets coordinates and a keyless navigation link.
 */
describe('GLO-231 mandatory confirmed delivery pin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let skuId: string;
  let hub: Actor; let driver: Actor; let otherDriver: Actor; let customer: Actor; let supplier: Actor;
  let locationId: string;
  const http = () => request(app.getHttpServer());

  const quoteFor = async (address = { governorate: 'Cairo', area: 'Maadi' }) => {
    const added = await http().post('/ordering/cart/add').send({ skuId, quantity: 1 }).expect(201);
    const token = added.body.guestCartToken as string;
    const quote = await http().post('/ordering/checkout/quote').set('x-cart-token', token).send(address).expect(201);
    return { token, quote: quote.body };
  };
  const submit = (token: string, quote: { quoteVersion: string; revision: number }, overrides: Record<string, unknown>) =>
    http().post('/ordering/checkout').set('x-cart-token', token).send({
      governorate: 'Cairo', area: 'Maadi', customerName: 'Pin Customer', customerPhone: '01012345678',
      shippingAddress: '5 Pin Street', ...CAIRO_PIN, quoteVersion: quote.quoteVersion, cartRevision: quote.revision,
      idempotencyKey: randomUUID(), ...overrides,
    });
  const packedShipment = async (pin: boolean) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Legacy Customer', customerPhone: '01011112222', shippingAddress: '9 Legacy St',
      governorate: 'Giza', area: 'Dokki', totalAmount: 250, codAmount: 250, currency: 'EGP', status: 'packing',
      ...(pin ? { latitude: 30.0386, longitude: 31.2122, locationSource: 'map_pin' } : {}),
    } });
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'packed' } });
    return { order, shipment };
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    skuId = (await createSellableSku(prisma)).id;
    hub = await createActor(prisma, 'HUB_OPERATOR');
    driver = await createActor(prisma, 'DRIVER');
    otherDriver = await createActor(prisma, 'DRIVER');
    customer = await createActor(prisma, 'CUSTOMER');
    supplier = await createActor(prisma, 'SUPPLIER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'GLO-231 Hub ' + randomUUID(), address: 'Giza' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('rejects a missing, unconfirmed or geocoded pin at validation', async () => {
    const { token, quote } = await quoteFor();
    await submit(token, quote, { latitude: undefined, longitude: undefined }).expect(400);
    await submit(token, quote, { locationConfirmed: false }).expect(400);
    await submit(token, quote, { locationConfirmed: undefined }).expect(400);
    await submit(token, quote, { locationSource: 'geocoded_address' }).expect(400);
    await submit(token, quote, { latitude: 'thirty' }).expect(400);
    expect((await prisma.cartItem.count({ where: { cart: { guestTokenHash: { not: null } }, skuId } }))).toBeGreaterThan(0);
  });

  it('rejects a map default centre and pins outside Cairo/Giza with typed 422 codes', async () => {
    const { token, quote } = await quoteFor();
    const centre = await submit(token, quote, { latitude: 30.0444, longitude: 31.2357 }).expect(422);
    expect(centre.body.code).toBe('LOCATION_PIN_IMPROBABLE');
    const alexandria = await submit(token, quote, { latitude: 31.2001, longitude: 29.9187 }).expect(422);
    expect(alexandria.body.code).toBe('OUT_OF_SERVICE_AREA');
    const governorate = await http().post('/ordering/checkout/quote').set('x-cart-token', token)
      .send({ governorate: 'Alexandria', area: 'Smouha' }).expect(422);
    expect(governorate.body.code).toBe('OUT_OF_SERVICE_AREA');
    // Nothing was consumed: the same quote still places the order with a valid pin.
    await submit(token, quote, {}).expect(201);
  });

  it('accepts Giza (Arabic) and stores an immutable customer-confirmed snapshot', async () => {
    const address = { governorate: 'الجيزة', area: 'الدقي' };
    const { token, quote } = await quoteFor(address);
    const placed = await submit(token, quote, { ...address, latitude: 30.0386, longitude: 31.2122, locationSource: 'current_location' }).expect(201);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: placed.body.id } });
    expect(stored).toMatchObject({ latitude: 30.0386, longitude: 31.2122, locationSource: 'current_location', locationConfirmedBy: 'customer' });
    expect(stored.locationConfirmedAt).toBeInstanceOf(Date);
    // A customer pin is never overwritten by an operator.
    const corrected = await http().patch(`/ordering/orders/${stored.id}/delivery-location`).set(hub.auth)
      .send({ latitude: 30.05, longitude: 31.25, reason: 'customer called' }).expect(409);
    expect(corrected.body.code).toBe('LOCATION_ALREADY_CONFIRMED');
  });

  it('keeps the pin through a 409 price change and re-quote', async () => {
    const order = await (async () => {
      const { token, quote } = await quoteFor();
      const price = await prisma.sellingPrice.create({ data: {
        skuId, amount: quote.items[0].unitPrice + 5, currency: 'EGP', validFrom: new Date(), isActive: true,
      } });
      try {
        const pin = { latitude: 30.0071, longitude: 31.4913 }; // New Cairo
        expect((await submit(token, quote, pin).expect(409)).body.code).toBe('CHECKOUT_REVIEW_REQUIRED');
        const requote = await http().post('/ordering/checkout/quote').set('x-cart-token', token)
          .send({ governorate: 'Cairo', area: 'Maadi' }).expect(201);
        return (await submit(token, requote.body, pin).expect(201)).body;
      } finally {
        await prisma.sellingPrice.delete({ where: { id: price.id } });
      }
    })();
    expect(order).toMatchObject({ latitude: 30.0071, longitude: 31.4913 });
  });

  it('refuses to put an unpinned (legacy) order on a run until an operator corrects it', async () => {
    const { order, shipment } = await packedShipment(false);
    const run = await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Pin run', driverId: driver.id }).expect(201);
    const refused = await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(hub.auth)
      .send({ stops: [{ shipmentId: shipment.id }] }).expect(409);
    expect(refused.body.code).toBe('LOCATION_REQUIRED');

    const body = { latitude: 30.0386, longitude: 31.2122, reason: 'Pin confirmed with customer by phone' };
    await http().patch(`/ordering/orders/${order.id}/delivery-location`).set(customer.auth).send(body).expect(403);
    await http().patch(`/ordering/orders/${order.id}/delivery-location`).set(driver.auth).send(body).expect(403);
    await http().patch(`/ordering/orders/${order.id}/delivery-location`).set(hub.auth)
      .send({ ...body, latitude: 31.2001, longitude: 29.9187 }).expect(422);
    await http().patch(`/ordering/orders/${order.id}/delivery-location`).set(hub.auth).send(body).expect(200);
    const corrected = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(corrected).toMatchObject({ locationSource: 'operator_corrected', locationConfirmedBy: hub.id });
    expect(await prisma.notificationOutbox.count({ where: { aggregateId: order.id, eventType: 'order.location_corrected' } })).toBe(1);

    await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(hub.auth)
      .send({ stops: [{ shipmentId: shipment.id }] }).expect(201);
  });

  it('gives the assigned driver only coordinates and a navigation link for their own stops', async () => {
    const { order, shipment } = await packedShipment(true);
    const run = await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Pin run', driverId: driver.id }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(hub.auth).send({ stops: [{ shipmentId: shipment.id }] }).expect(201);

    const mine = await http().get('/fulfillment/driver/runs').set(driver.auth).expect(200);
    const stop = mine.body.flatMap((r: { stops: unknown[] }) => r.stops).find((s: { shipmentId: string }) => s.shipmentId === shipment.id);
    expect(stop.location).toEqual({
      latitude: 30.0386, longitude: 31.2122, source: 'map_pin',
      navigationUrl: 'https://www.google.com/maps/dir/?api=1&destination=30.0386,31.2122',
    });
    const theirs = await http().get('/fulfillment/driver/runs').set(otherDriver.auth).expect(200);
    expect(JSON.stringify(theirs.body)).not.toContain(shipment.id);
    expect(JSON.stringify(theirs.body)).not.toContain(order.orderNumber);
    await http().get(`/fulfillment/shipments/${shipment.id}`).set(otherDriver.auth).expect(404);
    await http().get('/fulfillment/driver/runs').set(supplier.auth).expect(403);
    await http().get('/fulfillment/driver/runs').set(customer.auth).expect(403);
  });

  it('shows the customer their own pin and nobody else', async () => {
    const placed = await placeGuestOrder(app.getHttpServer(), [{ skuId, quantity: 1 }]);
    const tracked = await http().get(`/ordering/guest/orders/${placed.orderNumber}/tracking`)
      .set('x-order-access-token', placed.guestAccessToken!).expect(200);
    expect(tracked.body.deliveryAddress).toMatchObject({ latitude: CAIRO_PIN.latitude, longitude: CAIRO_PIN.longitude });
    await http().get(`/ordering/guest/orders/${placed.orderNumber}/tracking`).expect(401);
    await http().get(`/ordering/orders/${placed.orderNumber}`).set(customer.auth).expect(404);
  });
});
