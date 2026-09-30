import { Controller, Post, Body, Get, Param, Delete, UseGuards, ForbiddenException, Patch } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { AddToCartDto, RemoveFromCartDto, UpdateCartItemQuantityDto } from './dto/cart.dto';
import { CheckoutDto } from './dto/order.dto';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';

@Controller('ordering')
@UseGuards(AuthGuard)
export class OrderingController {
  constructor(
    private readonly orderingService: OrderingService,
    private readonly cartService: CartService,
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
}
