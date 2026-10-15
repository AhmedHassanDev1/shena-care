import { Controller, Post, Body, Get, Param, UseGuards, Patch, ParseUUIDPipe } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { OrderTrackingService } from './services/order-tracking.service';
import { OrderLookupParamsDto } from './dto/order-tracking.dto';
import { AddDeliveryInstructionDto, CorrectDeliveryLocationDto } from './dto/order.dto';
import { CreateResolutionDto, UpdateResolutionStatusDto, InitializePaymentCollectionDto, InitiateRefundDto, UpdateRefundStatusDto } from './dto/reconciliation.dto';
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

  /** Pin for a legacy order without one; dispatch refuses orders without a confirmed pin (GLO-231). */
  @Patch('orders/:id/delivery-location')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('delivery.plan')
  async correctDeliveryLocation(@CurrentUser() actor: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectDeliveryLocationDto) {
    return this.orderingService.correctDeliveryLocation(id, dto, actor.id);
  }

  /** Operator clarification or corrected meeting point; the customer's pin is preserved (RT08). */
  @Post('orders/:id/delivery-instructions')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('delivery.plan')
  async addDeliveryInstruction(@CurrentUser() actor: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddDeliveryInstructionDto) {
    return this.orderingService.addDeliveryInstruction(id, dto, actor.id);
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
    @Body() dto: InitiateRefundDto
  ) {
    return this.reconciliationService.initiateRefund(id, dto.amount, dto.currency, dto.paymentProvider);
  }

  @Patch('resolutions/:id/refund/status')
  @Roles('ADMIN')
  @RequirePermissions('return.manage')
  async updateRefundStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRefundStatusDto
  ) {
    return this.reconciliationService.updateRefundStatus(id, dto.status, dto.providerRef, dto.errorReason);
  }

  // --- GLO-128: COD Settlement Reconciliation ---

  // Drivers record deliveries; they never set expected cash or settle it (GLO-206 GAP-09).
  @Post('settlements/initialize')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('cod.reconcile')
  async initializePaymentCollection(@Body() dto: InitializePaymentCollectionDto) {
    return this.reconciliationService.initializePaymentCollection(dto.orderId, dto.amount, dto.currency);
  }

}
