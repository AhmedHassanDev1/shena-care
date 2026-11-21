import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { ConfirmDamageDto, OrderCostService, RecordOrderCostDto } from '../services/order-cost.service';
import { OrderProfitabilityService } from '../services/order-profitability.service';

/**
 * Actual courier and packaging cost per order. Hub operators record them at the Hub (the packaging type is chosen at the pack step,
 * the courier cost once the order has left); only an Admin can correct a recorded value, with a reason.
 */
@Controller('order-costs')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'HUB_OPERATOR')
@RequirePermissions('hub.pack')
export class OrderCostController {
  constructor(private readonly costs: OrderCostService, private readonly profit: OrderProfitabilityService) {}

  @Get('pending')
  pending(@Query('take') take?: string) {
    return this.costs.pending(Math.min(Math.max(Number.parseInt(take ?? '100', 10) || 100, 1), 200));
  }

  /** Internal margin of one order (Admin only: hub operators record costs, they do not see profit). */
  @Get(':orderId/profitability')
  @Roles('ADMIN')
  profitability(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.profit.evaluate(orderId);
  }

  @Get(':orderId')
  forOrder(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.costs.forOrder(orderId);
  }

  /** An Admin confirms that goods bought for a cancelled or returned order are damaged (otherwise they stay recoverable, not a loss). */
  @Put(':orderId/damage')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  confirmDamage(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: ConfirmDamageDto, @CurrentUser() user: { id: string }) {
    return this.costs.confirmDamage(orderId, dto, { id: user.id });
  }

  @Put(':orderId')
  @HttpCode(HttpStatus.OK)
  record(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: RecordOrderCostDto, @CurrentUser() user: { id: string; roles?: string[] }) {
    return this.costs.record(orderId, dto, { id: user.id, roles: user.roles ?? [] });
  }
}
