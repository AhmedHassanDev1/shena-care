import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
const request = require('supertest');

describe('Return Eligibility + Refund Tracking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  const registerCustomer = async () => {
    const registration = await http().post('/accounts/register').send({
      name: 'Return Customer', email: 'return-' + randomUUID() + '@example.com', password: 'password123',
    }).expect(201);
    const auth = 'Bearer ' + registration.body.token;
    const me = await http().get('/accounts/me').set('Authorization', auth).expect(200);
    return { auth, id: me.body.id as string };
  };

  const makeOrder = async (customerId: string | null, status: 'placed' | 'delivered' = 'placed', deliveredAt?: Date) => {
    const orderNumber = 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
    const skuId = randomUUID();
    const order = await prisma.order.create({ data: {
      orderNumber, customerId, customerName: 'Return Customer', customerPhone: '01012345678',
      shippingAddress: '1 Return Street', totalAmount: 150, shippingFee: 50, currency: 'EGP', status,
      codAmount: 150, subtotal: 100,
      items: { create: [{
        skuId, quantity: 1, price: 100, productId: randomUUID(), productName: 'Return Product',
        skuCode: 'RET', variantName: 'Return 50ml', currency: 'EGP', lineTotal: 100,
      }] },
      statusEvents: { create: [
        { status: 'placed', createdAt: new Date(Date.now() - 60000) },
        ...(status === 'delivered' ? [{ status: 'delivered' as any, createdAt: deliveredAt ?? new Date() }] : [])
      ]}
    }, include: { items: true } });
    return order;
  };

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  it('projects normal return window for delivered order', async () => {
    const owner = await registerCustomer();
    const deliveredAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const order = await makeOrder(owner.id, 'delivered', deliveredAt);
    const itemId = order.items[0].id;

    const el = await http().get(`/ordering/orders/${order.orderNumber}/items/${itemId}/eligibility`)
      .set('Authorization', owner.auth).expect(200);
    
    expect(el.body.isEligible).toBe(true);
    expect(el.body.allowedReasons).toContain('CHANGE_OF_MIND');
    expect(el.body.allowedReasons).toContain('DEFECT_OR_QUALITY_CONCERN');

    // Submit return
    const ret = await http().post(`/ordering/orders/${order.orderNumber}/items/${itemId}/returns`)
      .set('Authorization', owner.auth)
      .send({ reasonCode: 'DEFECT_OR_QUALITY_CONCERN', quantity: 1, description: 'Broken seal' })
      .expect(201);
    
    expect(ret.body.status).toBe('requested');
    expect(ret.body.type).toBe('return');

    // Verify refund projection in tracking
    // We mock a refund transaction for the resolution
    await prisma.refundTransaction.create({
      data: {
        resolutionId: ret.body.id,
        orderId: order.id,
        amount: 100,
        currency: 'EGP',
        status: 'pending',
      }
    });

    const tracking = await http().get(`/ordering/orders/${order.orderNumber}/tracking`)
      .set('Authorization', owner.auth).expect(200);
    
    const resolution = tracking.body.resolutions.find((r: any) => r.category === 'return');
    expect(resolution).toBeDefined();
    expect(resolution.refund).toMatchObject({
      amount: 100,
      currency: 'EGP',
      status: 'INITIATED'
    });
  });

  it('rejects CHANGE_OF_MIND if normal window is closed but allows DEFECT', async () => {
    const owner = await registerCustomer();
    const deliveredAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // 20 days ago, past 14 days normal window
    const order = await makeOrder(owner.id, 'delivered', deliveredAt);
    const itemId = order.items[0].id;

    const el = await http().get(`/ordering/orders/${order.orderNumber}/items/${itemId}/eligibility`)
      .set('Authorization', owner.auth).expect(200);
    
    expect(el.body.isEligible).toBe(true);
    expect(el.body.allowedReasons).not.toContain('CHANGE_OF_MIND');
    expect(el.body.allowedReasons).toContain('DEFECT_OR_QUALITY_CONCERN');

    await http().post(`/ordering/orders/${order.orderNumber}/items/${itemId}/returns`)
      .set('Authorization', owner.auth)
      .send({ reasonCode: 'CHANGE_OF_MIND', quantity: 1 })
      .expect(400); // Should be rejected because it's outside the window
  });
});
