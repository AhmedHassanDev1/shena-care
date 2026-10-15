import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { CancelOrderDto } from '../../../modules/ordering/public';
import { OrderCancellationService } from '../services/order-cancellation.service';

/** Staff cancellation before the parcel leaves the hub (GLO-240). Admin decision, audited. */
@Controller('ordering/orders')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class OrderCancellationController {
  constructor(private readonly cancellation: OrderCancellationService) {}

  @Post(':id/cancel')
  @Roles('ADMIN')
  @RequirePermissions('order.manage')
  cancel(@CurrentUser() actor: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto) {
    return this.cancellation.cancel(id, actor.id, dto);
  }
}
