import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('Accounts (e2e)', () => {
  let app: INestApplication;
  
  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    await clearFixturePhoneChallenges();
  });

  afterAll(async () => {
    await clearFixturePhoneChallenges();
    await app.close();
  });

  /**
   * The suite reuses fixed phone numbers; without this, repeated runs against the same test
   * database hit the real per-phone OTP rate limit (5/hour) and fail with 409.
   */
  const clearFixturePhoneChallenges = async () => {
    const { PrismaService } = require('../../src/platform/database/prisma.service');
    await app.get(PrismaService).otpChallenge.deleteMany({ where: { phoneNumber: { in: [
      '+201155555555', '+201166666666', '+201177777777', '+201188888888', '+201199999999', '+201211111111', '+201511111111',
      '+201022220001', '+201022220002', '+201022220003', '+201022220004',
    ] } } });
  };

  const testEmail = `test-${Date.now()}@example.com`;
  let token: string;

  it('should register a new account', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({
        name: 'Test User',
        email: testEmail,
        password: 'password123',
      })
      .expect(201);

    expect(res.body.token).toBeDefined();
    token = res.body.token;
  });

  it('should not allow duplicate email registration', async () => {
    await request(app.getHttpServer())
      .post('/accounts/register')
      .send({
        name: 'Test User 2',
        email: testEmail,
        password: 'password123',
      })
      .expect(409);
  });

  it('should login and return a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts/login')
      .send({
        email: testEmail,
        password: 'password123',
      })
      .expect(201);

    expect(res.body.token).toBeDefined();
    token = res.body.token;
  });

  it('should fail login with wrong password', async () => {
    await request(app.getHttpServer())
      .post('/accounts/login')
      .send({
        email: testEmail,
        password: 'wrongpassword',
      })
      .expect(401);
  });

  it('should get current user info (me)', async () => {
    const res = await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.email).toBe(testEmail);
    expect(res.body.name).toBe('Test User');
  });

  it('should fail get me without token', async () => {
    await request(app.getHttpServer())
      .get('/accounts/me')
      .expect(401);
  });
  
  it('should logout and invalidate token', async () => {
    await request(app.getHttpServer())
      .post('/accounts/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
      
    await request(app.getHttpServer())
      .get('/accounts/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  describe('OTP Flow', () => {
    const testPhone = '01211111111';
    let otpCode = '';
    
    it('should send OTP and normalize Egyptian phone', async () => {
      const res = await request(app.getHttpServer())
        .post('/accounts/otp/send')
        .send({ phoneNumber: testPhone })
        .expect(201);
        
      expect(res.body.success).toBe(true);
      
      // Fetch OTP directly from DB for testing
      const { PrismaService } = require('../../src/platform/database/prisma.service');
      const prisma = app.get(PrismaService);
      const challenge = await prisma.otpChallenge.findFirst({
        where: { phoneNumber: '+201211111111' },
        orderBy: { createdAt: 'desc' }
      });
      
      expect(challenge).toBeDefined();
      otpCode = challenge.code;
    });

    it('should reject wrong OTP code', async () => {
      await request(app.getHttpServer())
        .post('/accounts/otp/verify')
        .send({ phoneNumber: testPhone, code: '000000' })
        .expect(401);
    });

    it('should prevent requesting new OTP immediately (cooldown)', async () => {
      await request(app.getHttpServer())
        .post('/accounts/otp/send')
        .send({ phoneNumber: testPhone })
        .expect(409);
    });

    it('should verify correct OTP and return token', async () => {
      const res = await request(app.getHttpServer())
        .post('/accounts/otp/verify')
        .send({ phoneNumber: testPhone, code: otpCode })
        .expect(201);
        
      expect(res.body.token).toBeDefined();

      // The new phone account: its verified number for checkout's recipient, and no name until the customer gives one.
      const me = await request(app.getHttpServer()).get('/accounts/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
      expect(me.body).toMatchObject({ phoneNumber: '+201211111111', name: null });
    });

    it('should reject reused OTP', async () => {
      await request(app.getHttpServer())
        .post('/accounts/otp/verify')
        .send({ phoneNumber: testPhone, code: otpCode })
        .expect(401);
    });
    
    it('should limit failed attempts', async () => {
      const phone2 = '01511111111';
      await request(app.getHttpServer())
        .post('/accounts/otp/send')
        .send({ phoneNumber: phone2 })
        .expect(201);
        
      // Try 3 wrong codes
      await request(app.getHttpServer()).post('/accounts/otp/verify').send({ phoneNumber: phone2, code: '000000' }).expect(401);
      await request(app.getHttpServer()).post('/accounts/otp/verify').send({ phoneNumber: phone2, code: '000000' }).expect(401);
      await request(app.getHttpServer()).post('/accounts/otp/verify').send({ phoneNumber: phone2, code: '000000' }).expect(401);
      
      // 4th attempt should be rejected even if correct because max attempts reached
      const { PrismaService } = require('../../src/platform/database/prisma.service');
      const prisma = app.get(PrismaService);
      const challenge = await prisma.otpChallenge.findFirst({
        where: { phoneNumber: '+201511111111' },
        orderBy: { createdAt: 'desc' }
      });
      
      await request(app.getHttpServer())
        .post('/accounts/otp/verify')
        .send({ phoneNumber: phone2, code: challenge.code })
        .expect(401);
    });
  });

  describe('pendingIntent / returnTo', () => {
    const intentPhone = '01155555555';
    let otpCode = '';
    
    it('should safely store valid pendingIntent and return it on verify', async () => {
      // 1. Send OTP with pendingIntent
      await request(app.getHttpServer())
        .post('/accounts/otp/send')
        .send({ phoneNumber: intentPhone, pendingIntent: '/checkout' })
        .expect(201);
        
      // Fetch OTP code
      const { PrismaService } = require('../../src/platform/database/prisma.service');
      const prisma = app.get(PrismaService);
      const challenge = await prisma.otpChallenge.findFirst({
        where: { phoneNumber: '+201155555555' },
        orderBy: { createdAt: 'desc' }
      });
      otpCode = challenge.code;

      // 2. Verify OTP and check returnTo, and also pass guestId
      const res = await request(app.getHttpServer())
        .post('/accounts/otp/verify')
        .send({ phoneNumber: intentPhone, code: otpCode, guestId: '3f9c2c0e-5a41-4d57-9d54-0b6a9f1c1a11' })
        .expect(201);
        
      expect(res.body.token).toBeDefined();
      expect(res.body.returnTo).toBe('/checkout');
    });

    it('should ignore unsafe or malformed pendingIntent', async () => {
      const unsafePhone = '01166666666';
      await request(app.getHttpServer())
        .post('/accounts/otp/send')
        .send({ phoneNumber: unsafePhone, pendingIntent: 'https://evil.com/phishing' })
        .expect(201);
        
      const { PrismaService } = require('../../src/platform/database/prisma.service');
      const prisma = app.get(PrismaService);
      const challenge = await prisma.otpChallenge.findFirst({
        where: { phoneNumber: '+201166666666' },
        orderBy: { createdAt: 'desc' }
      });
      
      const res = await request(app.getHttpServer())
        .post('/accounts/otp/verify')
        .send({ phoneNumber: unsafePhone, code: challenge.code })
        .expect(201);
        
      expect(res.body.token).toBeDefined();
      expect(res.body.returnTo).toBeUndefined();
    });
  });

  describe('guest adoption contract', () => {
    const { EventEmitter2 } = require('@nestjs/event-emitter');
    const { PrismaService } = require('../../src/platform/database/prisma.service');
    const guestId = '7b1d6a52-8c3e-4f0a-9a57-2d1e4b6c8f90';

    const login = async (phone: string, canonical: string, extra: object = {}) => {
      await request(app.getHttpServer()).post('/accounts/otp/send').send({ phoneNumber: phone }).expect(201);
      const prisma = app.get(PrismaService);
      const challenge = await prisma.otpChallenge.findFirst({
        where: { phoneNumber: canonical }, orderBy: { createdAt: 'desc' },
      });
      return request(app.getHttpServer())
        .post('/accounts/otp/verify')
        .send({ phoneNumber: phone, code: challenge.code, ...extra });
    };

    it('emits customer.verified once with customerId and guestId, without duplicating the customer', async () => {
      const events: any[] = [];
      const emitter = app.get(EventEmitter2);
      const listener = (e: any) => events.push(e);
      emitter.on('customer.verified', listener);
      try {
        const res = await login('01177777777', '+201177777777', { guestId });
        expect(res.status).toBe(201);
        expect(events).toHaveLength(1);
        expect(events[0].guestId).toBe(guestId);
        expect(typeof events[0].customerId).toBe('string');

        const prisma = app.get(PrismaService);
        const identities = await prisma.identity.count({ where: { provider: 'PHONE', providerId: '+201177777777' } });
        expect(identities).toBe(1);
      } finally {
        emitter.off('customer.verified', listener);
      }
    });

    it('does not emit when no guestId is supplied', async () => {
      const events: any[] = [];
      const emitter = app.get(EventEmitter2);
      const listener = (e: any) => events.push(e);
      emitter.on('customer.verified', listener);
      try {
        const res = await login('01188888888', '+201188888888');
        expect(res.status).toBe(201);
        expect(events).toHaveLength(0);
      } finally {
        emitter.off('customer.verified', listener);
      }
    });

    it('rejects a malformed guestId before any OTP is consumed', async () => {
      await request(app.getHttpServer())
        .post('/accounts/otp/verify')
        .send({ phoneNumber: '01199999999', code: '123456', guestId: 'not-a-uuid' })
        .expect(400);
    });
  });

  /** The challenge contract the SAHEL phone sign-in screens read (Authentication Addendum, GLO-200). */
  describe('OTP challenge contract and error codes', () => {
    const http = () => request(app.getHttpServer());
    const prisma = () => app.get(PrismaService);
    const latestCode = async (phone: string) =>
      (await prisma().otpChallenge.findFirstOrThrow({ where: { phoneNumber: phone }, orderBy: { createdAt: 'desc' } })).code;

    it('returns the code length, expiry and resend wait, and the cooldown carries retryAfter', async () => {
      const sent = await http().post('/accounts/otp/send').send({ phoneNumber: '010 2222 0001' }).expect(201);
      expect(sent.body).toMatchObject({ success: true, codeLength: 6, retryAfter: 60 });
      const expiresIn = new Date(sent.body.expiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(4 * 60_000);
      expect(expiresIn).toBeLessThanOrEqual(5 * 60_000);
      expect(await latestCode('+201022220001')).toMatch(/^[0-9]{6}$/);

      const again = await http().post('/accounts/otp/send').send({ phoneNumber: '01022220001' }).expect(409);
      expect(again.body.code).toBe('OTP_COOLDOWN');
      expect(again.body.retryAfter).toBeGreaterThan(0);
      expect(again.body.retryAfter).toBeLessThanOrEqual(60);
      // The code already sent stays the one to type: the cooldown describes it.
      expect(again.body).toMatchObject({ codeLength: 6, expiresAt: sent.body.expiresAt });
    });

    it('accepts Arabic-Indic digits and rejects invalid and non-Egyptian numbers with typed codes', async () => {
      await http().post('/accounts/otp/send').send({ phoneNumber: '٠١٠٢٢٢٢٠٠٠٢' }).expect(201);
      expect(await latestCode('+201022220002')).toMatch(/^[0-9]{6}$/);
      expect((await http().post('/accounts/otp/send').send({ phoneNumber: '0102222' }).expect(400)).body.code).toBe('OTP_PHONE_INVALID');
      expect((await http().post('/accounts/otp/send').send({ phoneNumber: '+447700900123' }).expect(400)).body.code).toBe('OTP_PHONE_NOT_EGYPTIAN');
    });

    it('distinguishes a wrong code, an exhausted challenge and a used or missing one', async () => {
      const phone = '01022220003';
      expect((await http().post('/accounts/otp/verify').send({ phoneNumber: phone, code: '000000' }).expect(401)).body.code).toBe('OTP_EXPIRED');
      await http().post('/accounts/otp/send').send({ phoneNumber: phone }).expect(201);
      const code = await latestCode('+201022220003');
      const wrong = code === '000000' ? '111111' : '000000';
      expect((await http().post('/accounts/otp/verify').send({ phoneNumber: phone, code: wrong }).expect(401)).body.code).toBe('OTP_INVALID');
      expect((await http().post('/accounts/otp/verify').send({ phoneNumber: phone, code: wrong }).expect(401)).body.code).toBe('OTP_INVALID');
      expect((await http().post('/accounts/otp/verify').send({ phoneNumber: phone, code: wrong }).expect(401)).body.code).toBe('OTP_ATTEMPTS_EXHAUSTED');
      // The exhausted challenge is revoked: even the right code now needs a new request.
      expect((await http().post('/accounts/otp/verify').send({ phoneNumber: phone, code }).expect(401)).body.code).toBe('OTP_EXPIRED');
    });

    it('never signs a staff account in with customer OTP, and answers like a wrong code', async () => {
      const staff = await prisma().customer.create({ data: {
        name: 'Staff With Phone', email: 'staff-otp-' + Date.now() + '@fixtures.test', roles: ['ADMIN'],
        identities: { create: { provider: 'PHONE', providerId: '+201022220004' } },
      } });
      try {
        await http().post('/accounts/otp/send').send({ phoneNumber: '01022220004' }).expect(201);
        const refused = await http().post('/accounts/otp/verify')
          .send({ phoneNumber: '01022220004', code: await latestCode('+201022220004') }).expect(401);
        expect(refused.body.code).toBe('OTP_INVALID');
        expect(refused.body.token).toBeUndefined();
        expect(await prisma().session.count({ where: { customerId: staff.id } })).toBe(0);
      } finally {
        await prisma().identity.deleteMany({ where: { customerId: staff.id } });
        await prisma().customer.delete({ where: { id: staff.id } });
      }
    });
  });
});
