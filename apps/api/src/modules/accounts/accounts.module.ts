import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { PrismaService } from '../../platform/database/prisma.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { StaffAuthService } from './staff-auth.service';
import { StaffOtpTransport } from './staff-otp.transport';
import rateLimit from 'express-rate-limit';

/** Per-IP ceiling for the staff OTP routes; per-number limits live in StaffAuthService. JSON, not plain text. */
const staffOtpLimiter = (max: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }),
  });

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, StaffAuthService, StaffOtpTransport, PrismaService, AuthGuard, RolesGuard],
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
    consumer.apply(staffOtpLimiter(20)).forRoutes({ path: 'accounts/staff/otp/send', method: RequestMethod.POST });
    consumer.apply(staffOtpLimiter(30)).forRoutes({ path: 'accounts/staff/otp/verify', method: RequestMethod.POST });
  }
}
