import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CartService } from '../../src/modules/ordering/services/cart.service';

describe('Cart APIs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cartService: CartService;
  let skuId: string;
  let secondSkuId: string;

  const http = () => request(app.getHttpServer());

  const newCustomer = async () => {
    const res = await http()
      .post('/accounts/register')
      .send({ name: 'Cart Tester', email: `cart-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, password: 'password123' });
    const auth = `Bearer ${res.body.token}`;
    const me = await http().get('/accounts/me').set('Authorization', auth);
    return { auth, id: me.body.id as string };
  };

  const otpLogin = async (guestId?: string) => {
    const digits = Math.floor(10000000 + Math.random() * 89999999).toString();
    const phone = `011${digits}`;
    await http().post('/accounts/otp/send').send({ phoneNumber: phone }).expect(201);
    const challenge = await prisma.otpChallenge.findFirst({
      where: { phoneNumber: `+2011${digits}` },
      orderBy: { createdAt: 'desc' },
    });
    const res = await http()
      .post('/accounts/otp/verify')
      .send({ phoneNumber: phone, code: challenge!.code, ...(guestId ? { guestId } : {}) })
      .expect(201);
    return `Bearer ${res.body.token}`;
  };

  const guestAdd = async (sku: string, quantity: number, token?: string) => {
    const req = http().post('/ordering/cart/add');
    if (token) req.set('x-cart-token', token);
    return req.send({ skuId: sku, quantity });
  };

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    cartService = app.get(CartService);

    const productRes = await http().get('/products/cerave-moisturizing-cream');
    skuId = productRes.body.skus[0].id;

    // A second sellable SKU, if the seed has one.
    const all = await http().get('/products');
    const list = Array.isArray(all.body) ? all.body : all.body.items ?? [];
    for (const p of list) {
      const detail = await http().get(`/products/${p.slug ?? p.id}`);
      const other = detail.body?.skus?.find((s: any) => s.id !== skuId);
      if (other) { secondSkuId = other.id; break; }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authenticated cart', () => {
    let customer: { auth: string; id: string };
    beforeAll(async () => { customer = await newCustomer(); });

    it('returns an empty cart initially', async () => {
      const res = await http().get('/ordering/cart').set('Authorization', customer.auth).expect(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.totalAmount).toBe(0);
    });

    it('adds, merges same SKU into one line, updates and removes', async () => {
      let res = await http().post('/ordering/cart/add').set('Authorization', customer.auth)
        .send({ skuId, quantity: 2, sourceType: 'PDP' }).expect(201);
      expect(res.body.ownerType).toBe('customer');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ skuId, quantity: 2, sourceType: 'PDP', canOrder: true });
      expect(res.body.items[0].priceAtAdd).toBe(res.body.items[0].price);
      expect(res.body.totalAmount).toBeGreaterThan(0);
      const itemId = res.body.items[0].id;

      res = await http().post('/ordering/cart/add').set('Authorization', customer.auth)
        .send({ skuId, quantity: 3 }).expect(201);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].quantity).toBe(5);
      expect(res.body.items[0].id).toBe(itemId); // stable line id

      res = await http().patch('/ordering/cart/quantity').set('Authorization', customer.auth)
        .send({ skuId, quantity: 7 }).expect(200);
      expect(res.body.items[0].quantity).toBe(7);
      expect(res.body.items[0].lineTotal).toBeCloseTo(res.body.items[0].price * 7);

      res = await http().post('/ordering/cart/remove').set('Authorization', customer.auth).send({ skuId }).expect(201);
      expect(res.body.items).toHaveLength(0);

      // remove is idempotent
      await http().post('/ordering/cart/remove').set('Authorization', customer.auth).send({ skuId }).expect(201);
    });

    it('enforces quantity limits and input validation', async () => {
      await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId, quantity: 0 }).expect(400);
      await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId, quantity: 21 }).expect(400);
      await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId: 'nope', quantity: 1 }).expect(400);
      // client cannot send price or an owner
      await http().post('/ordering/cart/add').set('Authorization', customer.auth)
        .send({ skuId, quantity: 1, price: 1 }).expect(400);
      await http().post('/ordering/cart/add').set('Authorization', customer.auth)
        .send({ skuId, quantity: 1, sessionId: 'someone-else' }).expect(400);
      await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId, quantity: 20 }).expect(201);
      await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId, quantity: 1 }).expect(400);
      await http().delete('/ordering/cart').set('Authorization', customer.auth).expect(200);
    });

    it('rejects unknown / unsellable SKUs', async () => {
      await http().post('/ordering/cart/add').set('Authorization', customer.auth)
        .send({ skuId: '00000000-0000-4000-8000-000000000000', quantity: 1 }).expect(400);
    });

    it('rejects stale revisions with 409 and accepts the fresh one', async () => {
      await http().delete('/ordering/cart').set('Authorization', customer.auth).expect(200);
      const first = await http().post('/ordering/cart/add').set('Authorization', customer.auth)
        .send({ skuId, quantity: 1 }).expect(201);
      const rev = first.body.revision;
      await http().patch('/ordering/cart/quantity').set('Authorization', customer.auth)
        .send({ skuId, quantity: 2, expectedRevision: rev }).expect(200);
      await http().patch('/ordering/cart/quantity').set('Authorization', customer.auth)
        .send({ skuId, quantity: 9, expectedRevision: rev }).expect(409); // stale retry
      const cur = await http().get('/ordering/cart').set('Authorization', customer.auth).expect(200);
      expect(cur.body.items[0].quantity).toBe(2);
      expect(cur.body.revision).toBe(rev + 1);
    });

    it('clear empties the cart', async () => {
      const res = await http().delete('/ordering/cart').set('Authorization', customer.auth).expect(200);
      expect(res.body.items).toHaveLength(0);
    });

    it('isolates carts between customers', async () => {
      const other = await newCustomer();
      await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId, quantity: 1 }).expect(201);
      const res = await http().get('/ordering/cart').set('Authorization', other.auth).expect(200);
      expect(res.body.items).toHaveLength(0);
      await http().delete('/ordering/cart').set('Authorization', customer.auth).expect(200);
    });
  });

  describe('guest cart', () => {
    it('GET without owner returns an empty projection and persists nothing', async () => {
      const before = await prisma.cart.count();
      const res = await http().get('/ordering/cart').expect(200);
      expect(res.body.items).toEqual([]);
      expect(await prisma.cart.count()).toBe(before);
    });

    it('creates a guest cart on first add, returns an opaque token, and resumes with it', async () => {
      const created = await guestAdd(skuId, 2);
      expect(created.status).toBe(201);
      const token = created.body.guestCartToken;
      expect(token).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.headers['x-cart-token']).toBe(token);
      expect(created.body.ownerType).toBe('guest');

      // token is stored hashed, never raw
      const raw = await prisma.cart.findFirst({ where: { guestTokenHash: token } });
      expect(raw).toBeNull();

      const resumed = await http().get('/ordering/cart').set('x-cart-token', token).expect(200);
      expect(resumed.body.items).toHaveLength(1);
      expect(resumed.body.guestCartToken).toBeUndefined();

      const again = await guestAdd(skuId, 1, token);
      expect(again.body.items[0].quantity).toBe(3);
    });

    it('rejects malformed and unknown cart tokens; mutations without a cart', async () => {
      await http().get('/ordering/cart').set('x-cart-token', 'garbage').expect(400);
      await http().get('/ordering/cart').set('x-cart-token', '11111111-1111-4111-8111-111111111111').expect(401);
      await http().patch('/ordering/cart/quantity').send({ skuId, quantity: 2 }).expect(400);
      await http().post('/ordering/cart/add').set('x-cart-token', '11111111-1111-4111-8111-111111111111')
        .send({ skuId, quantity: 1 }).expect(401);
    });

    it('an authenticated session takes precedence over a guest token', async () => {
      const customer = await newCustomer();
      const guest = await guestAdd(skuId, 4);
      const res = await http().get('/ordering/cart')
        .set('Authorization', customer.auth).set('x-cart-token', guest.body.guestCartToken).expect(200);
      expect(res.body.ownerType).toBe('customer');
      expect(res.body.items).toHaveLength(0);
    });
  });

  describe('guest -> account adoption', () => {
    it('re-owns the guest cart when the customer has none, and a replay is a no-op', async () => {
      const guest = await guestAdd(skuId, 3);
      const token = guest.body.guestCartToken;
      const auth = await otpLogin(token);

      const mine = await http().get('/ordering/cart').set('Authorization', auth).expect(200);
      expect(mine.body.items).toHaveLength(1);
      expect(mine.body.items[0]).toMatchObject({ skuId, quantity: 3 });

      // guest token is consumed
      await http().get('/ordering/cart').set('x-cart-token', token).expect(401);

      // replay (e.g. duplicate event) must not duplicate or change anything
      const me = await http().get('/accounts/me').set('Authorization', auth);
      await cartService.adoptGuestCart(me.body.id, token);
      const after = await http().get('/ordering/cart').set('Authorization', auth).expect(200);
      expect(after.body.items).toHaveLength(1);
      expect(after.body.items[0].quantity).toBe(3);
    });

    it('merges into an existing customer cart: same SKU sums (clamped), different SKU appended', async () => {
      const customer = await newCustomer();
      await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId, quantity: 19 }).expect(201);
      const guest = await guestAdd(skuId, 5);
      const token = guest.body.guestCartToken;
      if (secondSkuId) await guestAdd(secondSkuId, 1, token);

      await cartService.adoptGuestCart(customer.id, token);
      await cartService.adoptGuestCart(customer.id, token); // idempotent

      const res = await http().get('/ordering/cart').set('Authorization', customer.auth).expect(200);
      const same = res.body.items.filter((i: any) => i.skuId === skuId);
      expect(same).toHaveLength(1);
      expect(same[0].quantity).toBe(20);
      if (secondSkuId) {
        expect(res.body.items.filter((i: any) => i.skuId === secondSkuId)).toHaveLength(1);
      }
    });

    it('does not let one customer adopt a cart that already belongs to another', async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      await http().post('/ordering/cart/add').set('Authorization', a.auth).send({ skuId, quantity: 2 }).expect(201);
      // A customer id is never a guest token; nothing to adopt.
      await cartService.adoptGuestCart(b.id, a.id);
      const res = await http().get('/ordering/cart').set('Authorization', b.auth).expect(200);
      expect(res.body.items).toHaveLength(0);
      const still = await http().get('/ordering/cart').set('Authorization', a.auth).expect(200);
      expect(still.body.items[0].quantity).toBe(2);
    });
  });

  describe('price + availability projection', () => {
    it('flags price changed since add, with backend price remaining the truth', async () => {
      const customer = await newCustomer();
      const added = await http().post('/ordering/cart/add').set('Authorization', customer.auth)
        .send({ skuId, quantity: 1 }).expect(201);
      const oldPrice = added.body.items[0].price;

      const bump = await prisma.sellingPrice.create({
        data: { skuId, amount: oldPrice + 5, currency: 'EGP', validFrom: new Date(Date.now() - 1000), isActive: true },
      });
      try {
        const res = await http().get('/ordering/cart').set('Authorization', customer.auth).expect(200);
        expect(res.body.items[0].price).toBeCloseTo(oldPrice + 5);
        expect(res.body.items[0].priceAtAdd).toBe(oldPrice);
        expect(res.body.items[0].priceChangedSinceAdd).toBe(true);
        expect(res.body.totalAmount).toBeCloseTo(oldPrice + 5);
      } finally {
        await prisma.sellingPrice.delete({ where: { id: bump.id } });
      }
    });

    it('projects an unlisted line as unavailable and excludes it from the total', async () => {
      const customer = await newCustomer();
      await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId, quantity: 1 }).expect(201);
      const listing = await prisma.listing.findUnique({ where: { skuId } });
      await prisma.listing.update({ where: { skuId }, data: { isListed: false } });
      try {
        const res = await http().get('/ordering/cart').set('Authorization', customer.auth).expect(200);
        expect(res.body.items[0].canOrder).toBe(false);
        expect(res.body.items[0].availability).toBe('unavailable');
        expect(res.body.totalAmount).toBe(0);
        await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId, quantity: 1 }).expect(400);
      } finally {
        await prisma.listing.update({ where: { skuId }, data: { isListed: listing!.isListed } });
      }
    });
  });

  describe('checkout integration', () => {
    it('checkout consumes the customer cart and bumps its revision', async () => {
      const customer = await newCustomer();
      const added = await http().post('/ordering/cart/add').set('Authorization', customer.auth).send({ skuId, quantity: 2 }).expect(201);
      const quote = await http().post('/ordering/checkout/quote').set('Authorization', customer.auth)
        .send({ governorate: 'Cairo', area: 'Maadi' }).expect(201);
      const order = await http().post('/ordering/checkout').set('Authorization', customer.auth)
        .send({ customerName: 'Cart Tester', customerPhone: '+201000000000', shippingAddress: '1 Test St, Cairo', governorate: 'Cairo', area: 'Maadi', quoteVersion: quote.body.quoteVersion, cartRevision: quote.body.revision, idempotencyKey: `cart-${Date.now()}` });
      expect(order.status).toBe(201);
      const cart = await http().get('/ordering/cart').set('Authorization', customer.auth).expect(200);
      expect(cart.body.items).toHaveLength(0);
      expect(cart.body.revision).toBeGreaterThan(added.body.revision);
    });
  });
});
