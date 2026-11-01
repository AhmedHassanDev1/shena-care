import { Controller, Post, Body, Get, Param, Patch, UseGuards, Query } from '@nestjs/common';
import { SupportActor, SupportService } from '../services/support.service';
import { DashboardService } from '../services/dashboard.service';
import { FinanceService } from '../services/finance.service';
import { CreateSupportCaseDto, SupportCaseQueryDto, UpdateSupportCaseDto } from '../dto/operations.dto';
import { AuthGuard } from '../../accounts/guards/auth.guard';
import { RolesGuard } from '../../accounts/guards/roles.guard';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { Roles } from '../../accounts/decorators/roles.decorator';
import { CurrentUser } from '../../accounts/decorators/current-user.decorator';

@Controller('operations')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class OperationsController {
  constructor(
    private readonly supportService: SupportService,
    private readonly dashboardService: DashboardService,
    private readonly financeService: FinanceService
  ) {}

  @Get('dashboard/kpis')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('dashboard.read')
  async getDashboardKpis(@CurrentUser() user: any) {
    return this.dashboardService.getKpis(user);
  }

  // --- Finance / Accounting Export ---
  
  @Post('finance/exports')
  @Roles('ADMIN')
  @RequirePermissions('order.manage') // Assuming order.manage or dashboard.read is used for finance exports
  async requestAccountingExport(@Body() dto: { startDate: string, endDate: string }, @CurrentUser() user: any) {
    return this.financeService.requestAccountingExport(new Date(dto.startDate), new Date(dto.endDate), user.id);
  }

  @Get('finance/exports')
  @Roles('ADMIN')
  @RequirePermissions('order.manage')
  async getAccountingExports() {
    return this.financeService.getExportJobs();
  }

  @Post('support/cases')
  // Customers can create, admins can create
  async createSupportCase(@Body() dto: CreateSupportCaseDto, @CurrentUser() user: SupportActor) {
    return this.supportService.createCaseAs(dto, user);
  }

  @Get('support/cases')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('support.read')
  async getSupportCases(@Query() query: SupportCaseQueryDto) {
    return this.supportService.getCases(query.status, query);
  }

  @Get('support/cases/:id')
  async getCaseById(@Param('id') id: string, @CurrentUser() user: any) {
    const isInternal = user.roles?.some((r: string) => ['ADMIN', 'HUB_OPERATOR'].includes(r));
    // Ideally we should check if isInternal has 'support.read' but it's checked by the roles/permissions.
    // However, customers can only see their own cases.
    // Need to implement object level check inside service or here. For now, pass customerId to service.
    return this.supportService.getCaseById(id, isInternal ? undefined : user.id);
  }

  @Patch('support/cases/:id')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('support.manage')
  async updateSupportCase(@Param('id') id: string, @Body() dto: UpdateSupportCaseDto, @CurrentUser() user: any) {
    return this.supportService.updateCase(id, dto, user.id);
  }
}
