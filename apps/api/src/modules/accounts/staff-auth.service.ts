import {
  HttpException, HttpStatus, Injectable, ServiceUnavailableException,
} from '@nestjs/common'
import { Role } from '@prisma/client'
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto'
import { PrismaService } from '../../platform/database/prisma.service'
import { AccountsService } from './accounts.service'
import { normalizeEgyptianMobile } from './phone'
import { StaffOtpTransport } from './staff-otp.transport'

export const STAFF_ROLES: Role[] = ['ADMIN', 'HUB_OPERATOR', 'SUPPLIER', 'DRIVER']

const PURPOSE = 'STAFF_LOGIN'
const CODE_LENGTH = 6
const EXPIRES_IN_SECONDS = 5 * 60
const RESEND_COOLDOWN_SECONDS = 60
const MAX_ISSUES_PER_HOUR = 5
const MAX_ATTEMPTS = 3
/** Stored in place of a code hash for numbers that are not staff: it can never match a submitted code. */
const DECOY = 'decoy'

function coded(code: string, message: string, status: HttpStatus, extra: Record<string, unknown> = {}) {
  return new HttpException({ statusCode: status, message, code, ...extra }, status)
}

/**
 * Staff phone sign-in. Authentication only: it proves control of a number that the owner already
 * provisioned on a staff account (`npm run staff:provision -- --phone`). It never creates accounts, never
 * grants or selects roles, and answers identically for staff and non-staff numbers so it cannot be used
 * to discover who works here.
 */
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly transport: StaffOtpTransport,
  ) {}

  /** What the sign-in screen may offer. Phone is advertised only when a real delivery channel exists. */
  authOptions() {
    const available = this.transport.isAvailable()
    return {
      password: true,
      phone: {
        available,
        ...(available ? {} : { reason: 'PROVIDER_NOT_CONFIGURED' }),
        codeLength: CODE_LENGTH,
        expiresInSeconds: EXPIRES_IN_SECONDS,
        resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
      },
    }
  }

  private fingerprint(id: string, phone: string, code: string): string {
    return createHash('sha256').update(`${id}:${phone}:${code}`).digest('hex')
  }

  private phoneOrThrow(raw: string): string {
    const phone = normalizeEgyptianMobile(raw)
    if (!phone) throw coded('INVALID_PHONE', 'Enter a valid Egyptian mobile number.', HttpStatus.BAD_REQUEST)
    return phone
  }

  private async staffAccountForPhone(phone: string) {
    const identity = await this.prisma.identity.findUnique({
      where: { provider_providerId: { provider: 'PHONE', providerId: phone } },
      include: { customer: { select: { id: true, roles: true } } },
    })
    return identity && identity.customer.roles.some(role => STAFF_ROLES.includes(role)) ? identity.customer : null
  }

  async sendCode(rawPhone: string) {
    const phone = this.phoneOrThrow(rawPhone)
    if (!this.transport.isAvailable()) {
      throw new ServiceUnavailableException({
        statusCode: 503, code: 'OTP_UNAVAILABLE', message: 'Phone sign-in is not available right now.',
      })
    }

    const now = Date.now()
    const recent = await this.prisma.otpChallenge.findFirst({
      where: { phoneNumber: phone, purpose: PURPOSE, createdAt: { gte: new Date(now - RESEND_COOLDOWN_SECONDS * 1000) } },
      orderBy: { createdAt: 'desc' },
    })
    if (recent) {
      const retryAfterSeconds = Math.max(1, Math.ceil((recent.createdAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000))
      throw coded('OTP_COOLDOWN', 'Please wait before requesting a new code.', HttpStatus.TOO_MANY_REQUESTS, { retryAfterSeconds })
    }
    const window = await this.prisma.otpChallenge.findMany({
      where: { phoneNumber: phone, purpose: PURPOSE, createdAt: { gte: new Date(now - 3600 * 1000) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })
    if (window.length >= MAX_ISSUES_PER_HOUR) {
      const retryAfterSeconds = Math.max(1, Math.ceil((window[0].createdAt.getTime() + 3600 * 1000 - now) / 1000))
      throw coded('OTP_RATE_LIMITED', 'Too many requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS, { retryAfterSeconds })
    }

    const staff = await this.staffAccountForPhone(phone)
    const id = randomUUID()
    const code = randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0')
    await this.prisma.otpChallenge.create({
      data: {
        id, phoneNumber: phone, purpose: PURPOSE, maxAttempts: MAX_ATTEMPTS,
        code: staff ? this.fingerprint(id, phone, code) : DECOY,
        expiresAt: new Date(now + EXPIRES_IN_SECONDS * 1000),
      },
    })
    if (staff) {
      try {
        await this.transport.deliver(phone, code)
      } catch {
        await this.prisma.otpChallenge.update({ where: { id }, data: { isRevoked: true } })
        throw new ServiceUnavailableException({
          statusCode: 503, code: 'OTP_DELIVERY_FAILED', message: 'We could not send the code. Try again shortly.',
        })
      }
    }
    // Identical for staff and non-staff numbers: a decoy challenge keeps cooldown and limits uniform too.
    return { sent: true, expiresInSeconds: EXPIRES_IN_SECONDS, resendCooldownSeconds: RESEND_COOLDOWN_SECONDS, codeLength: CODE_LENGTH }
  }

  async verifyCode(rawPhone: string, code: string) {
    const phone = this.phoneOrThrow(rawPhone)
    const invalid = (extra: Record<string, unknown> = {}) =>
      coded('OTP_INVALID', 'The code is incorrect or no longer valid.', HttpStatus.UNAUTHORIZED, extra)

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phoneNumber: phone, purpose: PURPOSE, isUsed: false, isRevoked: false },
      orderBy: { createdAt: 'desc' },
    })
    if (!challenge) throw invalid()
    if (challenge.expiresAt.getTime() <= Date.now()) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { isRevoked: true } })
      throw coded('OTP_EXPIRED', 'The code has expired. Request a new one.', HttpStatus.UNAUTHORIZED)
    }

    // Count the attempt first and atomically, so parallel guesses cannot exceed the limit.
    const counted = await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } })
    if (counted.attempts > challenge.maxAttempts) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { isRevoked: true } })
      throw coded('OTP_LOCKED', 'Too many incorrect codes. Request a new one.', HttpStatus.UNAUTHORIZED)
    }

    const expected = Buffer.from(challenge.code)
    const given = Buffer.from(this.fingerprint(challenge.id, phone, code))
    const matches = expected.length === given.length && timingSafeEqual(expected, given)
    if (!matches) {
      const remaining = challenge.maxAttempts - counted.attempts
      if (remaining <= 0) {
        await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { isRevoked: true } })
        throw coded('OTP_LOCKED', 'Too many incorrect codes. Request a new one.', HttpStatus.UNAUTHORIZED)
      }
      throw invalid({ attemptsRemaining: remaining })
    }

    // Single use, even under concurrent submissions of the right code.
    const claimed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, isUsed: false, isRevoked: false },
      data: { isUsed: true },
    })
    if (claimed.count !== 1) throw invalid()

    const staff = await this.staffAccountForPhone(phone)
    if (!staff) throw invalid()
    return this.accounts.createSession(staff.id)
  }
}
