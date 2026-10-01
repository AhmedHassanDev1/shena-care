import { Controller, Post, Body, Get, Param, Patch, UseGuards, Query } from '@nestjs/common';
import { SupportService } from '../services/support.service';
import { DashboardService } from '../services/dashboard.service';
import { FinanceService } from '../services/finance.service';
import { CreateSupportCaseDto, UpdateSupportCaseDto } from '../dto/operations.dto';
import { AuthGuard } from '../../accounts/guards/auth.guard';
import { RolesGuard } from '../../accounts/guards/roles.guard';
import { Roles } from '../../accounts/decorators/roles.decorator';
import { CurrentUser } from '../../accounts/decorators/current-user.decorator';

@Controller('operations')
@UseGuards(AuthGuard, RolesGuard)
export class OperationsController {
  constructor(
    private readonly supportService: SupportService,
    private readonly dashboardService: DashboardService,
    private readonly financeService: FinanceService
  ) {}

  @Get('dashboard/kpis')
  @Roles('ADMIN')
  async getDashboardKpis() {
    return this.dashboardService.getKpis();
  }

  // --- Finance / Accounting Export ---
  
  @Post('finance/exports')
  @Roles('ADMIN')
  async requestAccountingExport(@Body() dto: { startDate: string, endDate: string }, @CurrentUser() user: any) {
    return this.financeService.requestAccountingExport(new Date(dto.startDate), new Date(dto.endDate), user.id);
  }

  @Get('finance/exports')
  @Roles('ADMIN')
  async getAccountingExports() {
    return this.financeService.getExportJobs();
  }

  @Post('support/cases')
  // Customers can create, admins can create
  async createSupportCase(@Body() dto: CreateSupportCaseDto, @CurrentUser() user: any) {
    if (user.roles.includes('CUSTOMER') && !user.roles.includes('ADMIN')) {
      dto.customerId = user.id; // Force customer ID for self-service
    }
    return this.supportService.createCase(dto);
  }

  @Get('support/cases')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getSupportCases(@Query('status') status?: string) {
    return this.supportService.getCases(status);
  }

  @Get('support/cases/:id')
  async getCaseById(@Param('id') id: string) {
    return this.supportService.getCaseById(id);
  }

  @Patch('support/cases/:id')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async updateSupportCase(@Param('id') id: string, @Body() dto: UpdateSupportCaseDto, @CurrentUser() user: any) {
    return this.supportService.updateCase(id, dto, user.id);
  }
}
