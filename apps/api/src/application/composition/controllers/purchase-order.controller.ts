import { Controller, Post, Get, Body, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PurchaseOrderService } from '../../../modules/sourcing/public';
import { CreatePurchaseOrderDto, ConfirmPurchaseOrderDto } from '../../../modules/sourcing/public';

type RequestUser = { roles?: string[]; supplierId?: string | null };

@Controller('purchase-orders')
@UseGuards(AuthGuard, RolesGuard)
export class PurchaseOrderController {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  /** Staff see every purchase order; a supplier account only its own supplier's orders. */
  private async ownedPurchaseOrder(user: RequestUser, id: string) {
    const order = await this.purchaseOrderService.getPurchaseOrder(id);
    const isStaff = user.roles?.some(role => role === 'ADMIN' || role === 'HUB_OPERATOR');
    if (!isStaff && (!user.supplierId || order.supplierId !== user.supplierId)) {
      throw new ForbiddenException('Cannot access another supplier purchase order');
    }
    return order;
  }

  @Post()
  @Roles('ADMIN', 'HUB_OPERATOR')
  async createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrderService.createPurchaseOrder(dto);
  }

  @Get(':id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getPurchaseOrder(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.ownedPurchaseOrder(user, id);
  }

  @Post(':id/confirm')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async confirmPurchaseOrder(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ConfirmPurchaseOrderDto,
  ) {
    await this.ownedPurchaseOrder(user, id);
    return this.purchaseOrderService.confirmPurchaseOrder(id, dto);
  }
}
