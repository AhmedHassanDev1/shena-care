import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CartOwner, CartService } from './services/cart.service';
import {
  AddToCartDto,
  ClearCartDto,
  RemoveFromCartDto,
  UpdateCartItemQuantityDto,
} from './dto/cart.dto';
import { OptionalAuthGuard } from './guards/optional-auth.guard';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CART_TOKEN_HEADER = 'x-cart-token';

/**
 * Guest-first cart. Owner resolution (server-side only; the client never names an owner):
 *  1. valid Bearer session  -> that customer's cart
 *  2. `x-cart-token` header -> that guest cart
 *  3. neither               -> anonymous; the first add creates a guest cart and returns
 *                              `guestCartToken` once in the body (and `x-cart-token` header).
 */
@Controller('ordering/cart')
@UseGuards(OptionalAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

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

  @Get()
  async getCart(@Req() req: any) {
    const owner = this.resolveOwner(req);
    if (!owner) return { id: null, ownerType: 'guest', revision: 0, items: [], totalAmount: 0 };
    return this.cartService.getCart(owner);
  }

  @Post('add')
  async add(@Req() req: any, @Body() dto: AddToCartDto, @Res({ passthrough: true }) res: any) {
    const result = await this.cartService.addToCart(this.resolveOwner(req), dto);
    if (result.guestCartToken) res.setHeader(CART_TOKEN_HEADER, result.guestCartToken);
    return result;
  }

  @Patch('quantity')
  async updateQuantity(@Req() req: any, @Body() dto: UpdateCartItemQuantityDto) {
    return this.cartService.updateQuantity(this.requireOwner(req), dto);
  }

  @Post('remove')
  async remove(@Req() req: any, @Body() dto: RemoveFromCartDto) {
    return this.cartService.removeFromCart(this.requireOwner(req), dto);
  }

  @Delete()
  async clear(@Req() req: any, @Body() dto: ClearCartDto) {
    return this.cartService.clearCart(this.requireOwner(req), dto?.expectedRevision);
  }
}
