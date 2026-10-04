import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AuthGuard } from '../../accounts/guards/auth.guard';

/**
 * Authentication is optional: a request carrying an Authorization header must be a valid
 * session (invalid -> 401, never silently downgraded to guest); a request without one proceeds
 * anonymously and `request.user` stays undefined.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly inner: AuthGuard;

  constructor(prisma: PrismaService) {
    this.inner = new AuthGuard(prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (process.env.TEST_BYPASS_AUTH === 'true' || request.headers.authorization) {
      return this.inner.canActivate(context);
    }
    return true;
  }
}
