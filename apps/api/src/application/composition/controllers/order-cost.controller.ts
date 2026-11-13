import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { OrderCostService, RecordOrderCostDto } from '../services/order-cost.service';

/**
 * Actual courier and packaging cost per order. Hub operators record them at the Hub (the packaging type is chosen at the pack step,
 * the courier cost once the order has left); only an Admin can correct a recorded value, with a reason.
 */
@Controller('order-costs')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'HUB_OPERATOR')
@RequirePermissions('hub.pack')
export class OrderCostController {
  constructor(private readonly costs: OrderCostService) {}

  @Get('pending')
  pending(@Query('take') take?: string) {
    return this.costs.pending(Math.min(Math.max(Number.parseInt(take ?? '100', 10) || 100, 1), 200));
  }

  @Get(':orderId')
  forOrder(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.costs.forOrder(orderId);
  }

  @Put(':orderId')
  @HttpCode(HttpStatus.OK)
  record(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: RecordOrderCostDto, @CurrentUser() user: { id: string; roles?: string[] }) {
    return this.costs.record(orderId, dto, { id: user.id, roles: user.roles ?? [] });
  }
}
