import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { CustomerAddressesService } from './services/customer-addresses.service';
import { CustomerAddressesController } from './controllers/customer-addresses.controller';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import rateLimit from 'express-rate-limit';

import { StaffManagementService } from './services/staff-management.service';
import { StaffManagementController } from './controllers/staff-management.controller';

// PrismaService comes from the global DatabaseModule: one connection pool for the whole app (GLO-281).
@Module({
  controllers: [AccountsController, CustomerAddressesController, StaffManagementController],
  providers: [AccountsService, CustomerAddressesService, StaffManagementService, AuthGuard, RolesGuard],
  exports: [AccountsService, CustomerAddressesService, StaffManagementService, AuthGuard, RolesGuard],
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
