import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { ShipmentStatus } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { signShipmentBarcode } from '../../src/modules/fulfillment/services/shipment-label';

/**
 * GLO-212 / GLO-211 (W20/W19): a driver reads only its own active runs, with just what each stop
 * needs (no item names or prices), and a replayed handoff scan records custody once.
 */
describe('GLO-212 driver run manifest and handoff replay (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hub: Actor; let driver1: Actor; let driver2: Actor;
  let locationId: string;
  const orderIds: string[] = []; const shipmentIds: string[] = []; const batchIds: string[] = [];
  const http = () => request(app.getHttpServer());

  const stop = async (status: ShipmentStatus, customerName: string) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName, customerPhone: '01098765432', governorate: 'Giza', area: 'Dokki',
      shippingAddress: '14 Mossadak St', notes: 'Ring twice', subtotal: 1000, shippingFee: 50,
      totalAmount: 1050, codAmount: 1050, currency: 'EGP', status: 'shipped',
      items: { create: [{ skuId: randomUUID(), quantity: 3, price: 333.33, currency: 'EGP', productName: 'Secret Serum' }] },
    } });
    orderIds.push(order.id);
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status } });
    shipmentIds.push(shipment.id);
    return { orderNumber: order.orderNumber, shipmentId: shipment.id };
  };
  const run = async (driverId: string, status: string, shipments: string[]) => {
    const batch = await prisma.deliveryBatch.create({ data: { locationId, driverId, status,
      stops: { create: shipments.map((shipmentId, i) => ({ shipmentId, sequence: i + 1 })) } } });
    batchIds.push(batch.id);
    return batch.id;
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    hub = await createActor(prisma, 'HUB_OPERATOR');
    driver1 = await createActor(prisma, 'DRIVER');
    driver2 = await createActor(prisma, 'DRIVER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'W20 Hub ' + randomUUID(), address: 'H' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.deliveryBatch.deleteMany({ where: { id: { in: batchIds } } });
      await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.fulfillmentLocationOperator.deleteMany({ where: { locationId } });
      await prisma.fulfillmentLocation.deleteMany({ where: { id: locationId } });
    }
    if (app) await app.close();
  });

  it('lists only the driver\'s own active runs, in stop order, without item details', async () => {
    const first = await stop('out_for_delivery', 'Mariam H.');
    const second = await stop('out_for_delivery', 'Omar K.');
    const mine = await run(driver1.id, 'dispatched', [second.shipmentId, first.shipmentId]);
    const other = await stop('out_for_delivery', 'Someone Else');
    await run(driver2.id, 'dispatched', [other.shipmentId]);
    const done = await stop('delivered', 'Old Stop');
    await run(driver1.id, 'completed', [done.shipmentId]);

    const res = await http().get('/fulfillment/driver/runs').set(driver1.auth).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: mine, status: 'dispatched' });
    const stops = res.body[0].stops;
    expect(stops.map((s: { orderNumber: string }) => s.orderNumber)).toEqual([second.orderNumber, first.orderNumber]);
    expect(stops[1]).toEqual({
      sequence: 2, shipmentId: first.shipmentId, status: 'out_for_delivery', handedOver: false,
      orderNumber: first.orderNumber, recipientName: 'Mariam H.', recipientPhone: '01098765432',
      governorate: 'Giza', area: 'Dokki', address: '14 Mossadak St', deliveryNotes: 'Ring twice',
      codDue: 1050, currency: 'EGP', itemCount: 3,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Secret Serum|333\.33|Someone Else|Old Stop/);
  });

  it('is driver-only', async () => {
    await http().get('/fulfillment/driver/runs').expect(401);
    await http().get('/fulfillment/driver/runs').set(hub.auth).expect(403);
  });

  it('records a replayed handoff scan once', async () => {
    const packed = await stop('packed', 'Handoff Customer');
    await run(driver2.id, 'planning', [packed.shipmentId]);
    const barcode = signShipmentBarcode(packed.shipmentId);
    const a = await http().post(`/fulfillment/shipments/${packed.shipmentId}/events`).set(driver2.auth)
      .send({ type: 'HANDOFF_SCANNED', barcode }).expect(201);
    const b = await http().post(`/fulfillment/shipments/${packed.shipmentId}/events`).set(driver2.auth)
      .send({ type: 'HANDOFF_SCANNED', barcode }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    // Still idempotent once the run has left the hub; a wrong barcode is still rejected.
    await prisma.shipment.update({ where: { id: packed.shipmentId }, data: { status: 'out_for_delivery' } });
    const c = await http().post(`/fulfillment/shipments/${packed.shipmentId}/events`).set(driver2.auth)
      .send({ type: 'HANDOFF_SCANNED', barcode }).expect(201);
    expect(c.body.id).toBe(a.body.id);
    await http().post(`/fulfillment/shipments/${packed.shipmentId}/events`).set(driver2.auth)
      .send({ type: 'HANDOFF_SCANNED', barcode: 'SHP-forged' }).expect(400);
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: packed.shipmentId, type: 'HANDOFF_SCANNED' } })).toBe(1);

    const manifest = await http().get('/fulfillment/driver/runs').set(driver2.auth).expect(200);
    const handedOver = manifest.body.flatMap((r: { stops: Array<{ shipmentId: string; handedOver: boolean }> }) => r.stops)
      .find((s: { shipmentId: string }) => s.shipmentId === packed.shipmentId);
    expect(handedOver.handedOver).toBe(true);
  });
});
