import { Controller, Post, Body, Get, Param, Delete, UseGuards, ForbiddenException } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { AddToCartDto, RemoveFromCartDto } from './dto/cart.dto';
import { CheckoutDto } from './dto/order.dto';
import { CustomerAuthGuard, CurrentCustomer } from '../../platform/auth';

@Controller('ordering')
@UseGuards(CustomerAuthGuard)
export class OrderingController {
  constructor(
    private readonly orderingService: OrderingService,
    private readonly cartService: CartService,
  ) {}

  @Get('cart')
  async getCart(@CurrentCustomer() customerId: string) {
    return this.cartService.getCart(customerId);
  }

  @Post('cart/add')
  async addToCart(@CurrentCustomer() customerId: string, @Body() dto: AddToCartDto) {
    // Forcing the DTO's sessionId to match the authenticated customer
    return this.cartService.addToCart({ ...dto, sessionId: customerId });
  }

  @Post('cart/remove')
  async removeFromCart(@CurrentCustomer() customerId: string, @Body() dto: RemoveFromCartDto) {
    return this.cartService.removeFromCart({ ...dto, sessionId: customerId });
  }

  @Delete('cart')
  async clearCart(@CurrentCustomer() customerId: string) {
    return this.cartService.clearCart(customerId);
  }

  @Post('checkout')
  async checkout(@CurrentCustomer() customerId: string, @Body() dto: CheckoutDto) {
    if (dto.sessionId && dto.sessionId !== customerId) {
      throw new ForbiddenException('Cannot checkout another customer cart');
    }
    return this.orderingService.checkout({ ...dto, sessionId: customerId });
  }

  @Get('orders/:idOrOrderNumber')
  async getOrder(@CurrentCustomer() customerId: string, @Param('idOrOrderNumber') id: string) {
    // The service must verify the order belongs to the customer
    return this.orderingService.getOrder(id, customerId);
  }
}
