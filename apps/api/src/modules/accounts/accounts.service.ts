import { Injectable, UnauthorizedException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RegisterDto, LoginDto } from './dto/accounts.dto';
import { CUSTOMER_VERIFIED_EVENT, CustomerVerifiedEvent } from './guest-adoption.contract';
import * as bcrypt from 'bcrypt';
import { randomUUID, randomInt } from 'crypto';

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

    return this.createSession(identity.customerId);
  }

  private normalizeEgyptianPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('01') && cleaned.length === 11) {
      return `+20${cleaned.substring(1)}`;
    }
    if (cleaned.startsWith('201') && cleaned.length === 12) {
      return `+${cleaned}`;
    }
    if (cleaned.startsWith('1') && cleaned.length === 10) {
      return `+20${cleaned}`;
    }
    return phone; // fallback
  }

  async sendOtp(phoneNumber: string, pendingIntent?: string) {
    const canonicalPhone = this.normalizeEgyptianPhone(phoneNumber);

    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentChallenge = await this.prisma.otpChallenge.findFirst({
      where: {
        phoneNumber: canonicalPhone,
        createdAt: { gte: oneMinuteAgo }
      }
    });

    if (recentChallenge) {
      throw new ConflictException('Please wait before requesting a new OTP');
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentChallengesCount = await this.prisma.otpChallenge.count({
      where: {
        phoneNumber: canonicalPhone,
        createdAt: { gte: oneHourAgo }
      }
    });

    if (recentChallengesCount >= 5) {
      throw new ConflictException('Too many requests. Please try again later.');
    }
    
    // Validate pendingIntent to prevent open redirects (must be a local path)
    let safeIntent = null;
    if (pendingIntent && pendingIntent.startsWith('/') && !pendingIntent.startsWith('//')) {
      safeIntent = pendingIntent;
    }

    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.otpChallenge.create({
      data: {
        phoneNumber: canonicalPhone,
        code,
        expiresAt,
        pendingIntent: safeIntent,
      }
    });

    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      console.log(`[DEV OTP SERVICE] OTP issued for ${canonicalPhone.slice(0, 5)}***** : ${code}`);
      return { success: true, message: 'OTP sent to console (Dev/Test only)' };
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

    if (!challenge) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    if (new Date() > challenge.expiresAt) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { isRevoked: true }
      });
      throw new UnauthorizedException('OTP has expired');
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { isRevoked: true }
      });
      throw new UnauthorizedException('Max attempts reached. Please request a new OTP.');
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
      throw new UnauthorizedException('Invalid OTP code');
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { isUsed: true }
    });

    let identity = await this.prisma.identity.findUnique({
      where: {
        provider_providerId: {
          provider: 'PHONE',
          providerId: canonicalPhone
        }
      },
      include: { customer: true }
    });

    let customerId: string;
    if (!identity) {
      const customer = await this.prisma.customer.create({
        data: {
          name: 'New User',
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

  async getMe(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      }
    });
    
    if (!customer) {
      throw new UnauthorizedException('Customer not found');
    }
    
    return customer;
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
