import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor } from '../fixtures/actors';
import request from 'supertest';

/** Owner decision 2026-10-25: a return's loss is attributed by cause, recorded and audited. */
describe('Return loss responsibility (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: { id: string; auth: Record<string, string> };
  let hub: { auth: Record<string, string> };
  const http = () => request(app.getHttpServer());

  const resolution = async () => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Loss Customer', customerPhone: '01012345678',
      shippingAddress: '1 Loss St', currency: 'EGP', status: 'delivered', subtotal: 100, shippingFee: 30, totalAmount: 130, codAmount: 130,
      items: { create: [{ skuId: randomUUID(), quantity: 1, price: 100, lineTotal: 100, currency: 'EGP', productName: 'Loss', skuCode: 'L', variantName: 'L' }] },
    }, include: { items: true } });
    return prisma.orderResolution.create({ data: {
      orderId: order.id, type: 'return', status: 'received', actorId: 'seed', reasonCode: 'DAMAGED_OR_LEAKING',
      resolutionDetails: { description: 'leaking cap' }, items: { create: [{ orderItemId: order.items[0].id, quantity: 1 }] },
    } });
  };
  const decide = (id: string, body: Record<string, unknown>, who = admin) => http().patch(`/ordering/resolutions/${id}/responsibility`).set(who.auth).send(body);

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, Role.ADMIN);
    hub = await createActor(prisma, Role.HUB_OPERATOR);
  });
  afterAll(async () => { await app.close(); });

  it('records the party, its shares and the disposition, keeping the customer\'s own details', async () => {
    const r = await resolution();
    const res = await decide(r.id, { party: 'SUPPLIER', disposition: 'RETURN_TO_SUPPLIER', note: 'factory defect' }).expect(200);
    expect(res.body.resolutionDetails).toMatchObject({
      description: 'leaking cap',
      responsibility: { party: 'SUPPLIER', shares: { supplier: 100, hub: 0, shinacare: 0 }, disposition: 'RETURN_TO_SUPPLIER', note: 'factory defect', decidedBy: admin.id },
    });
    const events = await prisma.orderResolutionEvent.findMany({ where: { resolutionId: r.id } });
    expect(events.some(e => e.notes?.includes('Responsibility: SUPPLIER'))).toBe(true);
  });

  it('splits a general problem between ShinaCare and the hub, and several at fault by the owner\'s shares', async () => {
    const general = await resolution();
    expect((await decide(general.id, { party: 'GENERAL', disposition: 'WRITE_OFF' }).expect(200)).body.resolutionDetails.responsibility.shares)
      .toEqual({ supplier: 0, hub: 50, shinacare: 50 });
    const split = await resolution();
    expect((await decide(split.id, { party: 'SPLIT', supplierShare: 70, hubShare: 30, shinacareShare: 0 }).expect(200)).body.resolutionDetails.responsibility.shares)
      .toEqual({ supplier: 70, hub: 30, shinacare: 0 });
    await decide(split.id, { party: 'SPLIT', supplierShare: 70, hubShare: 20 }).expect(400); // does not add up to 100
    expect((await decide(split.id, { party: 'APP' }).expect(200)).body.resolutionDetails.responsibility.party).toBe('APP'); // a correction replaces it…
    expect(await prisma.orderResolutionEvent.count({ where: { resolutionId: split.id, notes: { startsWith: 'Responsibility:' } } })).toBe(2); // …and the trail keeps both
  });

  it('is an admin decision', async () => {
    const r = await resolution();
    await decide(r.id, { party: 'HUB' }, hub as never).expect(403);
    await http().patch(`/ordering/resolutions/${r.id}/responsibility`).send({ party: 'HUB' }).expect(401);
    await decide(r.id, { party: 'NOBODY' }).expect(400);
    await decide(randomUUID(), { party: 'HUB' }).expect(404);
  });
});
