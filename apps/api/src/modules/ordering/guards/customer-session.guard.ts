import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AuthGuard } from '../../accounts/guards/auth.guard';

/**
 * Order placement requires a signed-in customer (owner decision 2026-10-18, SAHEL V18: an account is needed at
 * «إتمام الطلب»; supersedes GLO-71's guest checkout). Browsing, the guest cart and checkout quotes stay open.
 *
 * - no or invalid session → 401 `SIGN_IN_REQUIRED` (the storefront sends the customer through phone OTP and back);
 * - a session whose account is not a customer (staff) → 403: staff accounts never place storefront orders.
 */
@Injectable()
export class CustomerSessionGuard implements CanActivate {
  private readonly inner: AuthGuard;

  constructor(prisma: PrismaService) {
    this.inner = new AuthGuard(prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await this.inner.canActivate(context);
    } catch {
      throw new UnauthorizedException({ code: 'SIGN_IN_REQUIRED', message: 'Sign in with your mobile number to place the order.' });
    }
    const user = context.switchToHttp().getRequest().user as { roles?: Role[] } | undefined;
    if (!user?.roles?.includes(Role.CUSTOMER)) {
      throw new ForbiddenException({ code: 'CUSTOMER_ACCOUNT_REQUIRED', message: 'Only customer accounts can place storefront orders.' });
    }
    return true;
  }
}
