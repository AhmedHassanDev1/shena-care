import { Controller, Post, Body, Get, Param, UseGuards, Patch } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { OrderTrackingService } from './services/order-tracking.service';
import { OrderLookupParamsDto } from './dto/order-tracking.dto';
import { CreateResolutionDto, UpdateResolutionStatusDto, CreateSettlementBatchDto } from './dto/reconciliation.dto';
import { ReconciliationService } from './services/reconciliation.service';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { PermissionsGuard, RequirePermissions } from '../../platform/auth';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { Roles } from '../accounts/decorators/roles.decorator';

@Controller('ordering')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class OrderingController {
  constructor(
    private readonly orderingService: OrderingService,
    private readonly cartService: CartService,
    private readonly reconciliationService: ReconciliationService,
    private readonly orderTrackingService: OrderTrackingService,
  ) {}



  @Get('orders/:idOrOrderNumber')
  async getOrder(@CurrentUser() user: any, @Param() params: OrderLookupParamsDto) {
    return this.orderTrackingService.forCustomer(params.idOrOrderNumber, user.id);
  }

  @Get('orders/:idOrOrderNumber/tracking')
  async trackOrder(@CurrentUser() user: any, @Param() params: OrderLookupParamsDto) {
    return this.orderTrackingService.forCustomer(params.idOrOrderNumber, user.id);
  }

  // --- GLO-127: Order Resolutions ---

  @Post('resolutions')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('return.manage')
  async createResolution(@CurrentUser() admin: any, @Body() dto: CreateResolutionDto) {
    return this.reconciliationService.createResolution({ ...dto, actorId: admin.id });
  }

  @Patch('resolutions/:id/status')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('return.manage')
  async updateResolutionStatus(
    @Param('id') id: string,
    @CurrentUser() admin: any,
    @Body() dto: UpdateResolutionStatusDto
  ) {
    return this.reconciliationService.updateResolutionStatus(id, dto.status, admin.id, dto.notes);
  }

  // --- Refunds ---
  @Post('resolutions/:id/refund')
  @Roles('ADMIN')
  @RequirePermissions('return.manage')
  async initiateRefund(
    @Param('id') id: string,
    @Body() dto: { amount: number, currency: string, paymentProvider?: string }
  ) {
    return this.reconciliationService.initiateRefund(id, dto.amount, dto.currency, dto.paymentProvider);
  }

  @Patch('resolutions/:id/refund/status')
  @Roles('ADMIN')
  @RequirePermissions('return.manage')
  async updateRefundStatus(
    @Param('id') id: string,
    @Body() dto: { status: 'succeeded' | 'failed' | 'processing', providerRef?: string, errorReason?: string }
  ) {
    return this.reconciliationService.updateRefundStatus(id, dto.status as any, dto.providerRef, dto.errorReason);
  }

  // --- GLO-128: COD Settlement Reconciliation ---

  @Post('settlements/initialize')
  @Roles('ADMIN', 'DRIVER', 'HUB_OPERATOR')
  @RequirePermissions('cod.reconcile')
  async initializePaymentCollection(
    @CurrentUser() admin: any,
    @Body() dto: { orderId: string, amount: number, currency: string }
  ) {
    return this.reconciliationService.initializePaymentCollection(dto.orderId, dto.amount, dto.currency);
  }

  @Post('settlements/batch')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('cod.reconcile')
  async createSettlementBatch(@CurrentUser() admin: any, @Body() dto: CreateSettlementBatchDto) {
    return this.reconciliationService.createSettlementBatch({ ...dto, actorId: admin.id });
  }
}
