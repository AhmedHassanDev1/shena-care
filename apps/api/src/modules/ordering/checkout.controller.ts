import { Controller, Post, Body, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CheckoutDto, CheckoutQuoteRequestDto } from './dto/order.dto';
import { OptionalAuthGuard } from './guards/optional-auth.guard';
import { CustomerSessionGuard } from './guards/customer-session.guard';
import { CartOwner } from './services/cart.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CART_TOKEN_HEADER = 'x-cart-token';

@Controller('ordering/checkout')
export class CheckoutController {
  constructor(private readonly orderingService: OrderingService) {}

  private resolveOwner(req: any): CartOwner | null {
    if (req.user?.id) return { customerId: req.user.id };
    const raw = req.headers[CART_TOKEN_HEADER];
    if (raw === undefined) return null;
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!UUID_RE.test(token)) throw new BadRequestException('Malformed cart token');
    return { guestToken: token };
  }

  private requireOwner(req: any): CartOwner {
    const owner = this.resolveOwner(req);
    if (!owner) throw new BadRequestException('No cart: add an item first.');
    return owner;
  }

  /** Open to guests: a quote creates nothing and charges nothing (the guest cart stays usable before sign-in). */
  @Post('quote')
  @UseGuards(OptionalAuthGuard)
  async quote(@Req() req: any, @Body() dto: CheckoutQuoteRequestDto) {
    return this.orderingService.getCheckoutQuote(this.requireOwner(req), dto);
  }

  /**
   * Order placement requires a signed-in customer (CustomerSessionGuard). The order is always placed from that
   * customer's cart; guest carts reach it through adoption at sign-in (CUSTOMER_VERIFIED_EVENT).
   */
  @Post()
  @UseGuards(CustomerSessionGuard)
  async checkout(@Req() req: any, @Body() dto: CheckoutDto) {
    return this.orderingService.checkout({ customerId: req.user.id }, dto);
  }
}
