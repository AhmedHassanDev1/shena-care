import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../accounts/guards/auth.guard';
import { RolesGuard } from '../../accounts/guards/roles.guard';
import { Roles } from '../../accounts/decorators/roles.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { AllocationParamsDto, ConfirmSourceAllocationDto, SupplyOrderParamsDto } from '../dto/supply-plan.dto';
import { SupplyPlanService } from '../services/supply-plan.service';

@Controller('sourcing/supply-plans')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'HUB_OPERATOR')
export class SupplyPlanController {
  constructor(private readonly supplyPlan: SupplyPlanService) {}

  @Post('orders/:orderId/initiate')
  @RequirePermissions('sourcing.manage')
  initiate(@Param() params: SupplyOrderParamsDto) {
    return this.supplyPlan.initiateForOrder(params.orderId);
  }

  @Get('orders/:orderId')
  @RequirePermissions('sourcing.read')
  getPlan(@Param() params: SupplyOrderParamsDto) {
    return this.supplyPlan.getPlan(params.orderId);
  }

  @Post('allocations/:allocationId/confirm')
  @RequirePermissions('sourcing.manage')
  confirm(@Param() params: AllocationParamsDto, @Body() dto: ConfirmSourceAllocationDto) {
    return this.supplyPlan.confirmAllocation(params.allocationId, {
      result: dto.result,
      confirmedQuantity: dto.confirmedQuantity, evidenceRef: dto.evidenceRef,
    });
  }
}
