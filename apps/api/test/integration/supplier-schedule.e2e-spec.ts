import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { firstOpenDayAfter } from '../../src/modules/sourcing/services/supplier-schedule';
import { createSellableSku } from '../fixtures/sellable-sku';
import { createActor } from '../fixtures/actors';
import { signInCustomer } from '../fixtures/checkout';
import request from 'supertest';

describe('Supplier schedule drives the promised delivery date (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let skuId: string;
  let supplierId: string;
  let admin: { auth: Record<string, string> };
  const http = () => request(app.getHttpServer());
  const address = { governorate: 'Cairo', area: 'Maadi', latitude: 29.9602, longitude: 31.2569 };
  const quote = async () => {
    const customer = await signInCustomer(app);
    await http().post('/ordering/cart/add').set(customer.auth).send({ skuId, quantity: 1 }).expect(201);
    return { customer, quote: (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body };
  };

  beforeAll(async () => {
    delete process.env.DELIVERY_FEE_POLICY;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const fixture = await createSellableSku(prisma);
    supplierId = fixture.supplierId;
    skuId = (await http().get('/products/' + fixture.productSlug).expect(200)).body.skus[0].id;
    admin = await createActor(prisma, Role.ADMIN);
  });
  afterAll(async () => { await app.close(); });

  it('closes every supplier on Friday by default and quotes the next open day', async () => {
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    expect(supplier).toMatchObject({ closedWeekdays: [5], opensAt: null, closesAt: null });
    const { quote: q } = await quote();
    expect(q.promisedDate).toBe(firstOpenDayAfter(new Date(), [5]));
  });

  it('follows the supplier schedule the owner enters, and stores the promise on the order', async () => {
    // Open on Mondays only: the next Monday is promised.
    await http().patch(`/sourcing/suppliers/${supplierId}`).set(admin.auth)
      .send({ closedWeekdays: [0, 2, 3, 4, 5, 6], opensAt: '09:00', closesAt: '21:00' }).expect(res => { if (res.status !== 200) throw new Error(JSON.stringify(res.body)); });
    const { customer, quote: q } = await quote();
    const expected = firstOpenDayAfter(new Date(), [0, 2, 3, 4, 5, 6]);
    expect(q.promisedDate).toBe(expected);
    const order = (await http().post('/ordering/checkout').set(customer.auth).send({
      ...address, customerName: 'Schedule Tester', customerPhone: '01012345678', shippingAddress: '1 Test St',
      locationSource: 'map_pin', locationConfirmed: true, quoteVersion: q.quoteVersion, cartRevision: q.revision, idempotencyKey: randomUUID(),
    }).expect(201)).body;
    expect(String(order.promisedDate).slice(0, 10)).toBe(expected);
    const tracking = (await http().get('/ordering/orders/' + order.orderNumber + '/tracking').set(customer.auth).expect(200)).body;
    expect(String(tracking.delivery.estimatedDate).slice(0, 10)).toBe(expected);
  });

  it('validates the schedule', async () => {
    const patch = (body: Record<string, unknown>) => http().patch(`/sourcing/suppliers/${supplierId}`).set(admin.auth).send(body);
    await patch({ closedWeekdays: [7] }).expect(400);
    await patch({ closedWeekdays: [5, 5] }).expect(400);
    await patch({ opensAt: '9am' }).expect(400);
    await patch({ opensAt: '21:00', closesAt: '09:00' }).expect(400);
    await patch({ closedWeekdays: [5] }).expect(200);
  });
});
