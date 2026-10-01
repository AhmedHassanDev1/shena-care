import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { PrismaService } from '../../platform/database/prisma.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, PrismaService, AuthGuard, RolesGuard],
  exports: [AccountsService, AuthGuard, RolesGuard],
})
export class AccountsModule {}
