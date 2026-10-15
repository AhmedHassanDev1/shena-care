import { Controller, Post, Get, Body, Param, Query, UseGuards, ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { PurchaseOrderService } from '../../../modules/sourcing/public';
import {
  CreatePurchaseOrderDto, ConfirmPurchaseOrderDto, DistributePurchaseOrderLineDto, FlushProcurementBatchDto, ListPurchaseOrdersQueryDto,
} from '../../../modules/sourcing/public';

type RequestUser = { id: string; roles?: string[]; supplierId?: string | null };

@Controller('purchase-orders')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class PurchaseOrderController {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  private isStaff(user: RequestUser) {
    return !!user.roles?.some(role => role === 'ADMIN' || role === 'HUB_OPERATOR');
  }

  /** Staff see every purchase order; a supplier account only its own supplier's orders. */
  private async ownedPurchaseOrder(user: RequestUser, id: string) {
    const order = await this.purchaseOrderService.getPurchaseOrder(id);
    if (!this.isStaff(user) && (!user.supplierId || order.supplierId !== user.supplierId)) {
      throw new ForbiddenException('Cannot access another supplier purchase order');
    }
    return order;
  }

  /** Suppliers never see order/customer lineage; staff get the full PO-line → allocation ledger. */
  private present(user: RequestUser, order: Awaited<ReturnType<PurchaseOrderService['getPurchaseOrder']>>) {
    return this.isStaff(user) ? order : this.purchaseOrderService.toSupplierView(order);
  }

  @Post()
  @Roles('ADMIN', 'HUB_OPERATOR')
  async createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrderService.createPurchaseOrder(dto);
  }

  /** Consolidate pending order allocations into supplier POs now (manual flush; GLO-237). */
  @Post('batches')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('sourcing.manage')
  async flushBatch(@CurrentUser() user: RequestUser, @Body() dto: FlushProcurementBatchDto) {
    return this.purchaseOrderService.flushProcurementBatch(user.id, dto);
  }

  /** Supplier inbox (own POs only) or staff list. */
  @Get()
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async listPurchaseOrders(@CurrentUser() user: RequestUser, @Query() query: ListPurchaseOrdersQueryDto) {
    if (!this.isStaff(user) && !user.supplierId) throw new ForbiddenException('Supplier account is not linked to a supplier');
    const result = await this.purchaseOrderService.listPurchaseOrders(query, this.isStaff(user) ? undefined : user.supplierId!);
    return { total: result.total, items: result.items.map(order => this.present(user, order)) };
  }

  @Get(':id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getPurchaseOrder(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.present(user, await this.ownedPurchaseOrder(user, id));
  }

  @Post(':id/confirm')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async confirmPurchaseOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPurchaseOrderDto,
  ) {
    await this.ownedPurchaseOrder(user, id);
    return this.present(user, await this.purchaseOrderService.confirmPurchaseOrder(id, dto));
  }

  /** Supplier: confirmed goods are ready for pickup/delivery. Does not receive anything at the Hub. */
  @Post(':id/ready')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async markReady(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.ownedPurchaseOrder(user, id);
    return this.present(user, await this.purchaseOrderService.markReady(id));
  }

  /** Admin decision: split a partial confirmation shared by several orders (scarce-stock priority). */
  @Post(':id/lines/:lineId/distribute')
  @Roles('ADMIN')
  @RequirePermissions('sourcing.manage')
  async distribute(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: DistributePurchaseOrderLineDto,
  ) {
    return this.purchaseOrderService.distributeLine(id, lineId, dto, user.id);
  }
}
