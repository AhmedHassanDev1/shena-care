import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RegisterDto, LoginDto } from './dto/accounts.dto';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

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
