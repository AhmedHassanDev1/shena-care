import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'
const request = require('supertest')
import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/platform/database/prisma.service'
import { StaffOtpTransport } from '../../src/modules/accounts/staff-otp.transport'
import { AllExceptionsFilter } from '../../src/platform/errors/all-exceptions.filter'

/** Staff authentication for the Business app: email + password (existing contract) and staff phone codes. */
describe('Staff authentication (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let available = true
  const delivered: Array<{ phone: string; code: string }> = []
  const transport = {
    isAvailable: () => available,
    deliver: async (phone: string, code: string) => { delivered.push({ phone, code }) },
  }

  const run = Date.now().toString().slice(-7)
  const phoneOf = (suffix: string) => `0101${run.slice(-5)}${suffix}`
  const canonical = (local: string) => `+20${local.slice(1)}`

  const password = 'a-long-staff-password-1'
  const staff: Record<string, { id: string; email: string; phone: string }> = {}
  let customerPhone: string

  const api = () => request(app.getHttpServer())
  /** The error envelope nests the API's own body under `message`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detail = (res: any) => res.body.message
  const lastCode = (phone: string) => [...delivered].reverse().find(d => d.phone === canonical(phone))!.code
  /** The per-number cooldown is real; tests that resend age the previous challenge instead of sleeping. */
  const ageChallenges = (phone: string) =>
    prisma.otpChallenge.updateMany({ where: { phoneNumber: canonical(phone) }, data: { createdAt: new Date(Date.now() - 120_000) } })

  async function makeStaff(key: string, role: 'ADMIN' | 'HUB_OPERATOR' | 'SUPPLIER' | 'DRIVER', phoneSuffix: string) {
    const email = `${key}-${randomUUID()}@staff-auth.test`
    const phone = phoneOf(phoneSuffix)
    const customer = await prisma.customer.create({
      data: {
        name: `Staff ${key}`, email, roles: [role],
        identities: { create: [
          { provider: 'EMAIL', providerId: email, passwordHash: await bcrypt.hash(password, 4) },
          { provider: 'PHONE', providerId: canonical(phone) },
        ] },
      },
    })
    staff[key] = { id: customer.id, email, phone }
  }

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false'
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StaffOtpTransport).useValue(transport)
      .compile()
    app = moduleFixture.createNestApplication()
    // Same error envelope as production (main.ts): the browser sees what these tests see.
    app.useGlobalFilters(new AllExceptionsFilter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init()
    prisma = app.get(PrismaService)

    await makeStaff('admin', 'ADMIN', '01')
    await makeStaff('hub', 'HUB_OPERATOR', '02')
    await makeStaff('driver', 'DRIVER', '03')
    customerPhone = phoneOf('09')
    await prisma.customer.create({
      data: {
        name: 'Shopper', email: `shopper-${randomUUID()}@staff-auth.test`, roles: ['CUSTOMER'],
        identities: { create: { provider: 'PHONE', providerId: canonical(customerPhone) } },
      },
    })
  })

  afterAll(async () => {
    await prisma.otpChallenge.deleteMany({ where: { phoneNumber: { startsWith: `+20101${run.slice(-5)}` } } })
    await app.close()
  })

  beforeEach(() => { available = true })

  describe('auth options', () => {
    it('advertises password sign-in and the policy numbers the UI needs', async () => {
      const res = await api().get('/accounts/staff/auth-options').expect(200)
      expect(res.body.password).toBe(true)
      expect(res.body.phone).toMatchObject({ available: true, codeLength: 6, expiresInSeconds: 300, resendCooldownSeconds: 60 })
    })

    it('reports phone sign-in as unavailable when no delivery channel exists', async () => {
      available = false
      const res = await api().get('/accounts/staff/auth-options').expect(200)
      expect(res.body.phone).toMatchObject({ available: false, reason: 'PROVIDER_NOT_CONFIGURED' })
    })
  })

  describe('email + password (existing contract)', () => {
    it('signs a provisioned staff member in and exposes only their own roles', async () => {
      const login = await api().post('/accounts/login').send({ email: staff.admin.email, password }).expect(201)
      const me = await api().get('/workspace/me').set('Authorization', `Bearer ${login.body.token}`).expect(200)
      expect(me.body.roles).toEqual(['ADMIN'])
      expect(me.body.email).toBe(staff.admin.email)
    })

    it('fails identically for a wrong password and an unknown account', async () => {
      const wrong = await api().post('/accounts/login').send({ email: staff.admin.email, password: 'nope-nope-nope' })
      const unknown = await api().post('/accounts/login').send({ email: 'nobody@staff-auth.test', password })
      expect(wrong.status).toBe(401)
      expect(unknown.status).toBe(401)
      expect(wrong.body.message).toEqual(unknown.body.message)
    })

    it('invalidates the session on logout', async () => {
      const login = await api().post('/accounts/login').send({ email: staff.hub.email, password }).expect(201)
      const auth = { Authorization: `Bearer ${login.body.token}` }
      await api().post('/accounts/logout').set(auth).expect(201)
      await api().get('/workspace/me').set(auth).expect(401)
    })

    it('does not let a non-staff session reach privileged workspace endpoints', async () => {
      const email = `shopper-pw-${randomUUID()}@staff-auth.test`
      const reg = await api().post('/accounts/register').send({ name: 'Shopper', email, password }).expect(201)
      const auth = { Authorization: `Bearer ${reg.body.token}` }
      const me = await api().get('/workspace/me').set(auth).expect(200)
      expect(me.body.roles).toEqual(['CUSTOMER'])
      await api().get('/workspace/drivers').set(auth).expect(403)
    })
  })

  describe('staff phone codes', () => {
    it('rejects numbers that are not Egyptian mobiles without issuing anything', async () => {
      const res = await api().post('/accounts/staff/otp/send').send({ phoneNumber: '12345' }).expect(400)
      expect(detail(res).code).toBe('INVALID_PHONE')
    })

    it('refuses to issue codes when no delivery channel is configured (never pretends to send)', async () => {
      available = false
      const before = delivered.length
      const res = await api().post('/accounts/staff/otp/send').send({ phoneNumber: staff.admin.phone }).expect(503)
      expect(detail(res).code).toBe('OTP_UNAVAILABLE')
      expect(delivered.length).toBe(before)
      expect(await prisma.otpChallenge.count({ where: { phoneNumber: canonical(staff.admin.phone), purpose: 'STAFF_LOGIN' } })).toBe(0)
    })

    it('signs a provisioned staff member in with a delivered code, once only', async () => {
      const sent = await api().post('/accounts/staff/otp/send').send({ phoneNumber: staff.hub.phone }).expect(201)
      expect(sent.body).toEqual({ sent: true, expiresInSeconds: 300, resendCooldownSeconds: 60, codeLength: 6 })

      const stored = await prisma.otpChallenge.findFirst({ where: { phoneNumber: canonical(staff.hub.phone), purpose: 'STAFF_LOGIN' } })
      expect(stored!.code).not.toContain(lastCode(staff.hub.phone)) // fingerprint, never the code itself

      const ok = await api().post('/accounts/staff/otp/verify').send({ phoneNumber: staff.hub.phone, code: lastCode(staff.hub.phone) }).expect(201)
      const me = await api().get('/workspace/me').set('Authorization', `Bearer ${ok.body.token}`).expect(200)
      expect(me.body.id).toBe(staff.hub.id)
      expect(me.body.roles).toEqual(['HUB_OPERATOR'])

      const reuse = await api().post('/accounts/staff/otp/verify').send({ phoneNumber: staff.hub.phone, code: lastCode(staff.hub.phone) })
      expect(reuse.status).toBe(401)
      expect(detail(reuse).code).toBe('OTP_INVALID')
    })

    it('accepts any common formatting of the same number', async () => {
      await api().post('/accounts/staff/otp/send').send({ phoneNumber: `+20 ${staff.driver.phone.slice(1, 3)} ${staff.driver.phone.slice(3)}` }).expect(201)
      await api().post('/accounts/staff/otp/verify').send({ phoneNumber: canonical(staff.driver.phone), code: lastCode(staff.driver.phone) }).expect(201)
    })

    it('enforces the resend cooldown on the backend', async () => {
      await api().post('/accounts/staff/otp/send').send({ phoneNumber: staff.admin.phone }).expect(201)
      const again = await api().post('/accounts/staff/otp/send').send({ phoneNumber: staff.admin.phone }).expect(429)
      expect(detail(again).code).toBe('OTP_COOLDOWN')
      expect(detail(again).retryAfterSeconds).toBeGreaterThan(0)
      expect(detail(again).retryAfterSeconds).toBeLessThanOrEqual(60)
    })

    it('locks a code after three wrong guesses, even if the right one follows', async () => {
      const phone = staff.admin.phone
      await ageChallenges(phone)
      await api().post('/accounts/staff/otp/send').send({ phoneNumber: phone }).expect(201)
      const right = lastCode(phone)
      const wrong = right === '000000' ? '111111' : '000000'
      const first = await api().post('/accounts/staff/otp/verify').send({ phoneNumber: phone, code: wrong }).expect(401)
      expect(detail(first)).toMatchObject({ code: 'OTP_INVALID', attemptsRemaining: 2 })
      await api().post('/accounts/staff/otp/verify').send({ phoneNumber: phone, code: wrong }).expect(401)
      const third = await api().post('/accounts/staff/otp/verify').send({ phoneNumber: phone, code: wrong }).expect(401)
      expect(detail(third).code).toBe('OTP_LOCKED')
      const late = await api().post('/accounts/staff/otp/verify').send({ phoneNumber: phone, code: right }).expect(401)
      expect(detail(late).code).toBe('OTP_INVALID')
    })

    it('reports an expired code as expired', async () => {
      const phone = staff.admin.phone
      await ageChallenges(phone)
      await api().post('/accounts/staff/otp/send').send({ phoneNumber: phone }).expect(201)
      await prisma.otpChallenge.updateMany({
        where: { phoneNumber: canonical(phone), purpose: 'STAFF_LOGIN', isRevoked: false, isUsed: false },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      const res = await api().post('/accounts/staff/otp/verify').send({ phoneNumber: phone, code: lastCode(phone) }).expect(401)
      expect(detail(res).code).toBe('OTP_EXPIRED')
    })

    it('caps issued codes per number per hour', async () => {
      const phone = staff.driver.phone
      await prisma.otpChallenge.deleteMany({ where: { phoneNumber: canonical(phone) } })
      for (let i = 0; i < 5; i++) {
        await prisma.otpChallenge.create({ data: {
          phoneNumber: canonical(phone), purpose: 'STAFF_LOGIN', code: 'decoy', expiresAt: new Date(Date.now() + 1000),
          createdAt: new Date(Date.now() - (65 + i) * 1000),
        } })
      }
      const res = await api().post('/accounts/staff/otp/send').send({ phoneNumber: phone }).expect(429)
      expect(detail(res).code).toBe('OTP_RATE_LIMITED')
    })

    it('answers the same for non-staff and unknown numbers, delivers nothing, and signs nobody in', async () => {
      const unknown = phoneOf('07')
      const before = delivered.length
      const forCustomer = await api().post('/accounts/staff/otp/send').send({ phoneNumber: customerPhone }).expect(201)
      const forUnknown = await api().post('/accounts/staff/otp/send').send({ phoneNumber: unknown }).expect(201)
      expect(forCustomer.body).toEqual(forUnknown.body)
      expect(delivered.length).toBe(before)
      for (const phone of [customerPhone, unknown]) {
        const res = await api().post('/accounts/staff/otp/verify').send({ phoneNumber: phone, code: '123456' }).expect(401)
        expect(detail(res).code).toBe('OTP_INVALID')
      }
      const cooldown = await api().post('/accounts/staff/otp/send').send({ phoneNumber: unknown }).expect(429)
      expect(detail(cooldown).code).toBe('OTP_COOLDOWN')
    })

    it('never creates an account for an unknown number', async () => {
      const unknown = phoneOf('06')
      const customersBefore = await prisma.customer.count()
      await api().post('/accounts/staff/otp/send').send({ phoneNumber: unknown }).expect(201)
      await api().post('/accounts/staff/otp/verify').send({ phoneNumber: unknown, code: '000000' }).expect(401)
      expect(await prisma.customer.count()).toBe(customersBefore)
      expect(await prisma.identity.count({ where: { provider: 'PHONE', providerId: canonical(unknown) } })).toBe(0)
    })

    it('keeps staff challenges out of the storefront OTP flow', async () => {
      const phone = staff.admin.phone
      await ageChallenges(phone)
      await prisma.otpChallenge.deleteMany({ where: { phoneNumber: canonical(phone), isUsed: false, isRevoked: false } })
      await api().post('/accounts/staff/otp/send').send({ phoneNumber: phone }).expect(201)
      const staffCode = lastCode(phone)
      // The storefront endpoint must not see (or be satisfiable by) a staff challenge.
      const res = await api().post('/accounts/otp/verify').send({ phoneNumber: phone, code: staffCode })
      expect(res.status).toBe(401)
    })
  })
})
