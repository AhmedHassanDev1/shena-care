import { Controller, Post, Body, Get, Param, Delete } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { AddToCartDto, RemoveFromCartDto } from './dto/cart.dto';
import { CheckoutDto } from './dto/order.dto';

@Controller('ordering')
export class OrderingController {
  constructor(
    private readonly orderingService: OrderingService,
    private readonly cartService: CartService,
  ) {}

  @Get('cart/:sessionId')
  async getCart(@Param('sessionId') sessionId: string) {
    return this.cartService.getCart(sessionId);
  }

  @Post('cart/add')
  async addToCart(@Body() dto: AddToCartDto) {
    return this.cartService.addToCart(dto);
  }

  @Post('cart/remove')
  async removeFromCart(@Body() dto: RemoveFromCartDto) {
    return this.cartService.removeFromCart(dto);
  }

  @Delete('cart/:sessionId')
  async clearCart(@Param('sessionId') sessionId: string) {
    return this.cartService.clearCart(sessionId);
  }

  @Post('checkout')
  async checkout(@Body() dto: CheckoutDto) {
    return this.orderingService.checkout(dto);
  }

  @Get('orders/:idOrOrderNumber')
  async getOrder(@Param('idOrOrderNumber') id: string) {
    return this.orderingService.getOrder(id);
  }
}
