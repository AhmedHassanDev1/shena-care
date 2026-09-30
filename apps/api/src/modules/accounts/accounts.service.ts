import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RegisterDto, LoginDto } from './dto/accounts.dto';
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'crypto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
  }

  private verifyPassword(password: string, hash: string): boolean {
    const [salt, key] = hash.split(':');
    if (!salt || !key) return false;
    
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = scryptSync(password, salt, 64);
    
    if (keyBuffer.length !== derivedKey.length) {
      return false;
    }
    return timingSafeEqual(keyBuffer, derivedKey);
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { email: dto.email }
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = this.hashPassword(dto.password);

    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name,
        email: dto.email,
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

    if (!this.verifyPassword(dto.password, identity.passwordHash)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.createSession(identity.customerId);
  }

  private async createSession(customerId: string) {
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
      expiresAt: session.expiresAt
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
}
