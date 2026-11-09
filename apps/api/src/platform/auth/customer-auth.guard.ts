import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuthGuard } from '../../modules/accounts/guards/auth.guard';

/**
 * Customer Authentication Guard:
 * Strictly validates the session Bearer token via database lookup.
 * Never trusts unauthenticated or client-supplied x-customer-id headers.
 */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  private readonly inner: AuthGuard;

  constructor(prisma: PrismaService) {
    this.inner = new AuthGuard(prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    return this.inner.canActivate(context);
  }
}
