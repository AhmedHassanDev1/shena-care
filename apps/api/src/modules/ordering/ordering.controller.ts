import { Controller, Post, Body, Get, Param, Delete, UseGuards, ForbiddenException, Patch } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { AddToCartDto, RemoveFromCartDto, UpdateCartItemQuantityDto } from './dto/cart.dto';
import { CheckoutDto } from './dto/order.dto';
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
  ) {}

  @Get('cart')
  async getCart(@CurrentUser() customer: any) {
    return this.cartService.getCart(customer.id);
  }

  @Post('cart/add')
  async addToCart(@CurrentUser() customer: any, @Body() dto: AddToCartDto) {
    const payload: AddToCartDto & { sessionId: string } = { ...dto, sessionId: customer.id };
    return this.cartService.addToCart(payload);
  }

  @Post('cart/remove')
  async removeFromCart(@CurrentUser() customer: any, @Body() dto: RemoveFromCartDto) {
    const payload: RemoveFromCartDto & { sessionId: string } = { ...dto, sessionId: customer.id };
    return this.cartService.removeFromCart(payload);
  }

  @Patch('cart/quantity')
  async updateQuantity(@CurrentUser() customer: any, @Body() dto: UpdateCartItemQuantityDto) {
    const payload: UpdateCartItemQuantityDto & { sessionId: string } = { ...dto, sessionId: customer.id };
    return this.cartService.updateQuantity(payload);
  }

  @Delete('cart')
  async clearCart(@CurrentUser() customer: any) {
    return this.cartService.clearCart(customer.id);
  }

  @Post('checkout')
  async checkout(@CurrentUser() customer: any, @Body() dto: CheckoutDto) {
    if (dto.sessionId && dto.sessionId !== customer.id) {
      throw new ForbiddenException('Cannot checkout another customer cart');
    }
    const payload: CheckoutDto & { sessionId: string } = {
      ...dto,
      sessionId: customer.id,
    };
    return this.orderingService.checkout(payload);
  }

  @Get('orders/:idOrOrderNumber')
  async getOrder(@CurrentUser() user: any, @Param('idOrOrderNumber') id: string) {
    // Determine if the user is an internal operator (e.g. Admin or Hub Operator) who has order.read permission
    // For MVP, we check if they have the 'ADMIN' or 'HUB_OPERATOR' roles
    const isInternal = user.roles?.some((r: string) => ['ADMIN', 'HUB_OPERATOR'].includes(r));
    return this.orderingService.getOrder(id, isInternal ? undefined : user.id);
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
