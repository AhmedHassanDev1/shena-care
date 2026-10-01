import { Controller, Post, Body, Get, Param, Delete, UseGuards, ForbiddenException, Patch } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { AddToCartDto, RemoveFromCartDto, UpdateCartItemQuantityDto } from './dto/cart.dto';
import { CheckoutDto } from './dto/order.dto';
import { CreateResolutionDto, UpdateResolutionStatusDto, CreateSettlementBatchDto } from './dto/reconciliation.dto';
import { ReconciliationService } from './services/reconciliation.service';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';

@Controller('ordering')
@UseGuards(AuthGuard)
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
    return this.cartService.addToCart({ ...dto, sessionId: customer.id });
  }

  @Post('cart/remove')
  async removeFromCart(@CurrentUser() customer: any, @Body() dto: RemoveFromCartDto) {
    return this.cartService.removeFromCart({ ...dto, sessionId: customer.id });
  }

  @Patch('cart/quantity')
  async updateQuantity(@CurrentUser() customer: any, @Body() dto: UpdateCartItemQuantityDto) {
    return this.cartService.updateQuantity({ ...dto, sessionId: customer.id });
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
    return this.orderingService.checkout({ ...dto, sessionId: customer.id });
  }

  @Get('orders/:idOrOrderNumber')
  async getOrder(@CurrentUser() customer: any, @Param('idOrOrderNumber') id: string) {
    return this.orderingService.getOrder(id, customer.id);
  }

  // --- GLO-127: Order Resolutions ---

  @Post('resolutions')
  async createResolution(@CurrentUser() admin: any, @Body() dto: CreateResolutionDto) {
    // In a real scenario, restrict to admins/support roles.
    return this.reconciliationService.createResolution({ ...dto, actorId: admin.id });
  }

  @Patch('resolutions/:id/status')
  async updateResolutionStatus(
    @Param('id') id: string,
    @CurrentUser() admin: any,
    @Body() dto: UpdateResolutionStatusDto
  ) {
    return this.reconciliationService.updateResolutionStatus(id, dto.status, admin.id, dto.notes);
  }

  // --- GLO-128: COD Settlement Reconciliation ---

  @Post('settlements/initialize')
  async initializePaymentCollection(
    @CurrentUser() admin: any,
    @Body() dto: { orderId: string, amount: number, currency: string }
  ) {
    return this.reconciliationService.initializePaymentCollection(dto.orderId, dto.amount, dto.currency);
  }

  @Post('settlements/batch')
  async createSettlementBatch(@CurrentUser() admin: any, @Body() dto: CreateSettlementBatchDto) {
    return this.reconciliationService.createSettlementBatch({ ...dto, actorId: admin.id });
  }
}
