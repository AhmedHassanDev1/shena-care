import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { PrismaService } from '../../platform/database/prisma.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import rateLimit from 'express-rate-limit';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, PrismaService, AuthGuard, RolesGuard],
  exports: [AccountsService, AuthGuard, RolesGuard],
})
export class AccountsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        rateLimit({
          windowMs: 5 * 60 * 1000, // 5 minutes
          max: 5, // 5 login attempts
          message: 'Too many login attempts from this IP, please try again later.',
        })
      )
      .forRoutes({ path: 'accounts/login', method: RequestMethod.POST });
  }
}
