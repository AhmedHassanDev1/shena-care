import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { SupplyPlanService } from '../../src/modules/sourcing/services/supply-plan.service';
import { attachReviewedMedia } from '../fixtures/sellable-sku';
import { createActor } from '../fixtures/actors';
import request from 'supertest';

/** Owner decision (2026-10-25): suppliers keep quantities current; allocation never exceeds what they report. */
describe('Supplier offer quantity caps allocation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: SupplyPlanService;
  let admin: { auth: Record<string, string> };
  const http = () => request(app.getHttpServer());

  const makeSku = async (availableQuantity: number | null) => {
    const suffix = randomUUID();
    const brand = await prisma.brand.create({ data: { name: 'Qty ' + suffix, slug: 'qty-' + suffix } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Qty', slug: 'qty-p-' + suffix, isPublished: true } });
    const sku = await prisma.sku.create({ data: { productId: product.id, code: 'Q' + suffix, variantName: 'Q' } });
    await attachReviewedMedia(prisma, sku.id);
    await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
    await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: 100, currency: 'EGP', validFrom: new Date(Date.now() - 1000), isActive: true } });
    const supplier = await prisma.supplier.create({ data: { name: 'Qty Sup ' + suffix, slug: 'qty-sup-' + suffix } });
    const offer = await prisma.supplierOffer.create({ data: {
      supplierId: supplier.id, skuId: sku.id, costPrice: 50, currency: 'EGP', lastObservedAt: new Date(), lastConfirmedAt: new Date(),
      ...(availableQuantity === null ? {} : { availableQuantity, quantityUpdatedAt: new Date(Date.now() - 1000) }),
    } });
    return { skuId: sku.id, productId: product.id, offerId: offer.id };
  };
  const orderFor = async (sku: { skuId: string; productId: string }, quantity: number) => (await prisma.order.create({ data: {
    orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Qty Customer', customerPhone: '01012345678',
    shippingAddress: '1 Qty St', currency: 'EGP', status: 'placed', subtotal: 100 * quantity, shippingFee: 30, totalAmount: 100 * quantity + 30, codAmount: 100 * quantity + 30,
    items: { create: [{ skuId: sku.skuId, productId: sku.productId, quantity, price: 100, lineTotal: 100 * quantity, currency: 'EGP', productName: 'Qty', skuCode: 'Q', variantName: 'Q' }] },
  } })).id;
  const allocated = async (offerId: string) =>
    (await prisma.sourceAllocation.aggregate({ _sum: { allocatedQuantity: true }, where: { supplierOfferId: offerId } }))._sum.allocatedQuantity ?? 0;

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(SupplyPlanService);
    admin = await createActor(prisma, Role.ADMIN);
  });
  afterAll(async () => { await app.close(); });

  it('allocates only what the supplier reports, and opens an action requirement once it is used up', async () => {
    const sku = await makeSku(3);
    const first = await plans.initiateForOrder(await orderFor(sku, 2));
    expect(first.lines[0].allocations[0]).toMatchObject({ allocatedQuantity: 2 });
    const second = await plans.initiateForOrder(await orderFor(sku, 2));
    expect(second.lines[0].allocations[0]).toMatchObject({ allocatedQuantity: 1 }); // only 1 of 3 is left
    expect(await allocated(sku.offerId)).toBe(3);
    const third = await plans.initiateForOrder(await orderFor(sku, 1));
    expect(third.lines[0].allocations).toHaveLength(0);
    expect(third.lines[0].actionRequirement).toMatchObject({ category: 'SOURCE_EXHAUSTED', unresolvedQuantity: 1 });
  });

  it('never over-allocates when orders arrive at the same moment', async () => {
    const sku = await makeSku(2);
    const orders = await Promise.all([1, 2, 3, 4].map(() => orderFor(sku, 1)));
    await Promise.all(orders.map(id => plans.initiateForOrder(id).catch(() => undefined)));
    await Promise.all(orders.map(id => plans.advance(id).catch(() => undefined)));
    expect(await allocated(sku.offerId)).toBeLessThanOrEqual(2);
    expect(await allocated(sku.offerId)).toBe(2);
  });

  it('serializes direct quantity edits with procurement and trusted feed commits', async () => {
    const sku = await makeSku(4);
    const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: sku.offerId } });
    let unlock!: () => void; let acquired!: () => void;
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'commit:supplier:' + offer.supplierId}))`;
      acquired(); await release;
    });
    await locked;
    let completed = false;
    const edit = http().patch(`/sourcing/offers/${sku.offerId}`).set(admin.auth).send({ availableQuantity: 5 })
      .then(response => { completed = true; return response; });
    try { await new Promise(resolve => setTimeout(resolve, 1500)); expect(completed).toBe(false); }
    finally { unlock(); await holder; await edit; }
    expect((await edit).status).toBe(200);
  });

  it('21 reported, 10 reserved and confirmed leaves 11, including after a newer physical-stock snapshot', async () => {
    const sku = await makeSku(21);
    const first = await plans.initiateForOrder(await orderFor(sku, 10));
    await plans.confirmAllocation(first.lines[0].allocations[0].id, { result: 'confirmed_full', confirmedQuantity: 10 });
    await prisma.supplierOffer.update({ where: { id: sku.offerId }, data: { quantityUpdatedAt: new Date() } });
    const second = await plans.initiateForOrder(await orderFor(sku, 12));
    expect(second.lines[0].allocations[0].allocatedQuantity).toBe(11);
    expect((await prisma.supplierOffer.findUniqueOrThrow({ where: { id: sku.offerId } })).availableQuantity).toBe(21);
  });

  it('counts again from the supplier\'s newest number', async () => {
    const sku = await makeSku(1);
    await plans.initiateForOrder(await orderFor(sku, 1));
    const exhausted = await plans.initiateForOrder(await orderFor(sku, 1));
    expect(exhausted.lines[0].actionRequirement).not.toBeNull();
    const patched = await http().patch(`/sourcing/offers/${sku.offerId}`).set(admin.auth).send({ availableQuantity: 5 }).expect(200);
    expect(patched.body).toMatchObject({ availableQuantity: 5, isAvailable: true });
    const orderId = await orderFor(sku, 3);
    const plan = await plans.initiateForOrder(orderId);
    expect(plan.lines[0].allocations[0]).toMatchObject({ allocatedQuantity: 3 });
  });

  it('treats zero as out of stock and rejects nonsense; no reported quantity means no cap', async () => {
    const sku = await makeSku(4);
    const patched = await http().patch(`/sourcing/offers/${sku.offerId}`).set(admin.auth).send({ availableQuantity: 0 }).expect(200);
    expect(patched.body).toMatchObject({ availableQuantity: 0, isAvailable: false });
    await http().patch(`/sourcing/offers/${sku.offerId}`).set(admin.auth).send({ availableQuantity: -1 }).expect(400);
    await http().patch(`/sourcing/offers/${sku.offerId}`).set(admin.auth).send({ availableQuantity: 1.5 }).expect(400);

    const uncapped = await makeSku(null);
    const plan = await plans.initiateForOrder(await orderFor(uncapped, 50));
    expect(plan.lines[0].allocations[0]).toMatchObject({ allocatedQuantity: 50 });
  });
});
