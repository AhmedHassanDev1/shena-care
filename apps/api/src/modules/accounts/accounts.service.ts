import { Role } from '@prisma/client';
import { BadRequestException, Injectable, UnauthorizedException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RegisterDto, LoginDto } from './dto/accounts.dto';
import { CUSTOMER_PHONE_VERIFIED_EVENT, CUSTOMER_VERIFIED_EVENT, CustomerPhoneVerifiedEvent, CustomerVerifiedEvent } from './guest-adoption.contract';
import * as bcrypt from 'bcrypt';
import { randomUUID, randomInt } from 'crypto';

/** OTP challenge contract (GLO-200). The client renders cells, expiry and resend countdown from these values only. */
/** Name stored for an account created at phone sign-in, before the customer gives one (never shown as a name). */
export const PHONE_SIGNUP_NAME = 'New User';

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_HOURLY_LIMIT = 5;

const secondsUntil = (at: number, now: number) => Math.max(1, Math.ceil((at - now) / 1000));

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private eventEmitter: EventEmitter2
  ) {}

  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 12; // Secure default
    return bcrypt.hash(password, saltRounds);
  }

  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { email: dto.email }
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await this.hashPassword(dto.password);

    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name,
        email: dto.email,
        roles: ['CUSTOMER'],
        identities: {
          create: {
            provider: 'EMAIL',
            providerId: dto.email,
            passwordHash,
          }
        }
      }
    });

    return this.createSession(customer.id);
  }

  async login(dto: LoginDto) {
    const identity = await this.prisma.identity.findUnique({
      where: {
        provider_providerId: {
          provider: 'EMAIL',
          providerId: dto.email
        }
      },
      include: { customer: true }
    });

    if (!identity || !identity.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await this.verifyPassword(dto.password, identity.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!identity.customer.isActive) {
      throw new UnauthorizedException('Account has been deactivated');
    }

    return this.createSession(identity.customerId);
  }

  /**
   * Egyptian mobile → E.164 (+201XXXXXXXXX). Accepts 01XXXXXXXXX, 201XXXXXXXXX and 1XXXXXXXXX with any separators and
   * Arabic-Indic digits. An international number with another country code is OTP_PHONE_NOT_EGYPTIAN; anything else is
   * OTP_PHONE_INVALID (Authentication Addendum §States: separate errors for invalid and non-Egyptian numbers).
   */
  private normalizeEgyptianPhone(phone: string): string {
    const latin = phone
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
    const international = /^\s*(\+|00)/.test(latin);
    const cleaned = latin.replace(/\D/g, '').replace(/^00/, '');
    if (!international && cleaned.startsWith('01') && cleaned.length === 11) {
      return `+20${cleaned.substring(1)}`;
    }
    if (cleaned.startsWith('201') && cleaned.length === 12) {
      return `+${cleaned}`;
    }
    if (!international && cleaned.startsWith('1') && cleaned.length === 10) {
      return `+20${cleaned}`;
    }
    if (international && !cleaned.startsWith('20')) {
      throw new BadRequestException({ code: 'OTP_PHONE_NOT_EGYPTIAN', message: 'Only Egyptian mobile numbers can sign in for now.' });
    }
    throw new BadRequestException({ code: 'OTP_PHONE_INVALID', message: 'Enter an Egyptian mobile number: 11 digits starting with 01.' });
  }

  async sendOtp(phoneNumber: string, pendingIntent?: string) {
    const canonicalPhone = this.normalizeEgyptianPhone(phoneNumber);
    const now = Date.now();

    const recentChallenge = await this.prisma.otpChallenge.findFirst({
      where: { phoneNumber: canonicalPhone, createdAt: { gte: new Date(now - OTP_RESEND_COOLDOWN_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recentChallenge) {
      // Every limited response carries retryAfter (seconds), so the resend countdown survives a refresh. The code
      // sent moments ago is still the one to type, so the cooldown also describes it (no client defaults).
      throw new ConflictException({
        code: 'OTP_COOLDOWN',
        message: 'Please wait before requesting a new OTP',
        retryAfter: secondsUntil(recentChallenge.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS, now),
        codeLength: recentChallenge.code.length,
        expiresAt: recentChallenge.expiresAt.toISOString(),
      });
    }

    const recentChallenges = await this.prisma.otpChallenge.findMany({
      where: { phoneNumber: canonicalPhone, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (recentChallenges.length >= OTP_HOURLY_LIMIT) {
      throw new ConflictException({
        code: 'OTP_RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
        retryAfter: secondsUntil(recentChallenges[0].createdAt.getTime() + 60 * 60 * 1000, now),
      });
    }

    // Validate pendingIntent to prevent open redirects (must be a local path)
    let safeIntent = null;
    if (pendingIntent && pendingIntent.startsWith('/') && !pendingIntent.startsWith('//') && !pendingIntent.startsWith('/\\')) {
      safeIntent = pendingIntent;
    }

    const code = randomInt(10 ** (OTP_CODE_LENGTH - 1), 10 ** OTP_CODE_LENGTH).toString();
    const expiresAt = new Date(now + OTP_TTL_MS);
    // Dev-only: no SMS delivery yet, so the code is printed to the server log. Never in production.
    if (process.env.NODE_ENV !== 'production') console.log('phone code:', code);

    await this.prisma.otpChallenge.create({
      data: {
        phoneNumber: canonicalPhone,
        code,
        expiresAt,
        pendingIntent: safeIntent,
      }
    });

    // The challenge the client renders from (Addendum §Code input: no client defaults). Identical for every valid
    // number, known or new, so the response never reveals whether an account exists.
    const challenge = { codeLength: OTP_CODE_LENGTH, expiresAt, retryAfter: Math.round(OTP_RESEND_COOLDOWN_MS / 1000) };

    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      console.log(`[DEV OTP SERVICE] OTP issued for ${canonicalPhone.slice(0, 5)}***** : ${code}`);
      return { success: true, message: 'OTP sent to console (Dev/Test only)', ...challenge };
    }

    throw new ServiceUnavailableException('OTP delivery provider is not configured for this environment');
  }

  async verifyOtp(phoneNumber: string, code: string, guestId?: string) {
    const canonicalPhone = this.normalizeEgyptianPhone(phoneNumber);

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: {
        phoneNumber: canonicalPhone,
        isUsed: false,
        isRevoked: false,
      },
      orderBy: { createdAt: 'desc' }
    });

    // Distinct, machine-readable failures (Addendum §API: wrong, expired, attempts exhausted). None reveals whether
    // the number has an account.
    if (!challenge) {
      throw new UnauthorizedException({ code: 'OTP_EXPIRED', message: 'Invalid or expired OTP' });
    }

    if (new Date() > challenge.expiresAt) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { isRevoked: true }
      });
      throw new UnauthorizedException({ code: 'OTP_EXPIRED', message: 'OTP has expired' });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { isRevoked: true }
      });
      throw new UnauthorizedException({ code: 'OTP_ATTEMPTS_EXHAUSTED', message: 'Max attempts reached. Please request a new OTP.' });
    }

    if (challenge.code !== code) {
      const newAttempts = challenge.attempts + 1;
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: {
          attempts: newAttempts,
          isRevoked: newAttempts >= challenge.maxAttempts
        }
      });
      if (newAttempts >= challenge.maxAttempts) {
        throw new UnauthorizedException({ code: 'OTP_ATTEMPTS_EXHAUSTED', message: 'Max attempts reached. Please request a new OTP.' });
      }
      throw new UnauthorizedException({ code: 'OTP_INVALID', message: 'Invalid OTP code' });
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { isUsed: true }
    });

    const identity = await this.prisma.identity.findUnique({
      where: {
        provider_providerId: {
          provider: 'PHONE',
          providerId: canonicalPhone
        }
      },
      include: { customer: true }
    });

    // Customer OTP never authenticates staff: an account holding any non-customer role signs in through the staff
    // workspace only. The answer is the generic wrong-code error, so the number's account type is not revealed.
    if (identity && identity.customer.roles.some((role) => role !== Role.CUSTOMER)) {
      console.warn(`[ACCOUNTS] OTP sign-in refused for a staff account (${canonicalPhone.slice(0, 5)}*****)`);
      throw new UnauthorizedException({ code: 'OTP_INVALID', message: 'Invalid OTP code' });
    }

    if (identity && !identity.customer.isActive) {
      throw new UnauthorizedException('Account has been deactivated');
    }

    let customerId: string;
    if (!identity) {
      const customer = await this.prisma.customer.create({
        data: {
          name: PHONE_SIGNUP_NAME,
          email: `${canonicalPhone.replace(/[^0-9]/g, '')}@placeholder.com`,
          roles: ['CUSTOMER'],
          identities: {
            create: {
              provider: 'PHONE',
              providerId: canonicalPhone,
            }
          }
        }
      });
      customerId = customer.id;
    } else {
      customerId = identity.customerId;
    }

    // The account now controls this number: guest orders placed with it can join the account.
    const verified: CustomerPhoneVerifiedEvent = { customerId, phoneNumber: canonicalPhone };
    try {
      await this.eventEmitter.emitAsync(CUSTOMER_PHONE_VERIFIED_EVENT, verified);
    } catch (err) {
      console.error(`[ACCOUNTS] guest order adoption failed for customer ${customerId}: ${(err as Error).message}`);
    }

    if (guestId) {
      // Guest adoption contract: consumers must be idempotent per (customerId, guestId).
      const payload: CustomerVerifiedEvent = { customerId, guestId };
      try {
        await this.eventEmitter.emitAsync(CUSTOMER_VERIFIED_EVENT, payload);
      } catch (err) {
        console.error(`[ACCOUNTS] guest adoption failed for customer ${customerId}: ${(err as Error).message}`);
      }
    }
    return this.createSession(customerId, challenge.pendingIntent);
  }

  private async createSession(customerId: string, pendingIntent?: string | null) {
    const token = randomUUID();
    // 30 days expiration
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const session = await this.prisma.session.create({
      data: {
        token,
        customerId,
        expiresAt,
        isValid: true
      }
    });

    return {
      token: session.token,
      expiresAt: session.expiresAt,
      ...(pendingIntent ? { returnTo: pendingIntent } : {})
    };
  }

  async logout(token: string) {
    await this.prisma.session.update({
      where: { token },
      data: { isValid: false }
    });
    return { success: true };
  }

  /**
   * The signed-in customer's own profile. `phoneNumber` is the verified sign-in number (E.164) so checkout can offer
   * it as the recipient's; `name` is null until the customer gives one (phone sign-up stores a placeholder).
   */
  async getMe(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        identities: { where: { provider: 'PHONE' }, select: { providerId: true }, take: 1 },
      }
    });

    if (!customer) {
      throw new UnauthorizedException('Customer not found');
    }

    const { identities, ...profile } = customer;
    return {
      ...profile,
      name: profile.name === PHONE_SIGNUP_NAME ? null : profile.name,
      phoneNumber: identities[0]?.providerId ?? null,
    };
  }

  /** Business Workspace identity: roles and supplier scope (hub scope is composed from Fulfillment). */
  async getWorkspaceIdentity(accountId: string) {
    const account = await this.prisma.customer.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, email: true, roles: true, supplierId: true, isActive: true, supplier: { select: { name: true } } },
    });
    if (!account) throw new UnauthorizedException('Account not found');
    if (!account.isActive) throw new UnauthorizedException('Account has been deactivated');
    return {
      id: account.id, name: account.name, email: account.email, roles: account.roles,
      supplierId: account.supplierId, supplierName: account.supplier?.name ?? null,
      isActive: account.isActive,
    };
  }

  /** Staff directory for assignment pickers: ids and names only (no email/phone), active accounts only. */
  async listAccountsWithRole(role: Role) {
    return this.prisma.customer.findMany({
      where: { roles: { has: role }, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' },
    });
  }

  async exportCustomerData(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        identities: true,
      }
    });

    if (!customer) {
      throw new UnauthorizedException('Customer not found');
    }

    // Strip out sensitive fields (like passwordHash) from the export
    const exportData = {
      ...customer,
      identities: (customer as any).identities?.map((id: any) => ({ provider: id.provider, providerId: id.providerId })) || []
    };

    return exportData;
  }

  async deleteCustomerAccount(customerId: string) {
    // For MVP, we perform a hard delete of the customer, which cascades to identities/sessions.
    // If soft-delete is preferred, we would update a deletedAt column.
    // Ensure all PII is scrubbed.
    await this.prisma.customer.delete({
      where: { id: customerId }
    });
    return { success: true, message: 'Account deleted successfully' };
  }
}
