import { BadRequestException, Body, Controller, Headers, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { OptionalAuthGuard } from '../../../modules/accounts/guards/optional-auth.guard';
import { MyRoutinesService, RoutineCartDto, RoutineProposalService } from '../../../modules/care/public';
import { CartOwner, CartService } from '../../../modules/ordering/public';

type AuthedRequest = { user?: { id: string }; headers: Record<string, string | string[] | undefined> };
type HeaderWriter = { setHeader(name: string, value: string): void };

const CART_TOKEN_HEADER = 'x-cart-token';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «ضيف الروتين للسلة» (ROUTINE_SYSTEM.md §5.5): adds the steps still to buy, one cart line each, through the
 * Ordering module. Lines already in the cart are left as they are (never doubled); unsellable ones are reported.
 */
@Controller('care')
export class RoutineCartController {
  constructor(
    private readonly myRoutines: MyRoutinesService,
    private readonly proposals: RoutineProposalService,
    private readonly cart: CartService,
  ) {}

  @Post('me/routines/:id/cart')
  @UseGuards(AuthGuard)
  async addSavedRoutine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RoutineCartDto, @Req() req: AuthedRequest & { user: { id: string } }) {
    const items = await this.myRoutines.purchasableItems(id, req.user.id, dto.phase ?? 'ALL');
    return this.addAll({ customerId: req.user.id }, items);
  }

  @Post('workspace/proposals/:id/cart')
  @UseGuards(OptionalAuthGuard)
  async addProposal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RoutineCartDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: HeaderWriter,
    @Headers('x-guest-token') guestToken?: string,
  ) {
    const items = await this.proposals.purchasableFromProposal(id, { customerId: req.user?.id, guestToken: guestToken || undefined }, dto.phase ?? 'ALL');
    const result = await this.addAll(this.cartOwner(req), items);
    if (result.cart?.guestCartToken) res.setHeader(CART_TOKEN_HEADER, result.cart.guestCartToken);
    return result;
  }

  private cartOwner(req: AuthedRequest): CartOwner | null {
    if (req.user?.id) return { customerId: req.user.id };
    const raw = req.headers[CART_TOKEN_HEADER];
    if (raw === undefined) return null;
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!UUID_RE.test(token)) throw new BadRequestException('Malformed cart token');
    return { guestToken: token };
  }

  private async addAll(owner: CartOwner | null, items: Array<{ roleKey: string; skuId: string }>) {
    const added: string[] = [];
    const skipped: Array<{ roleKey: string; skuId: string; reason: string }> = [];
    let current = owner;
    let cart = current ? await this.cart.getCart(current).catch(() => null) : null;
    for (const item of items) {
      if (cart?.items.some(line => line.skuId === item.skuId)) {
        skipped.push({ ...item, reason: 'ALREADY_IN_CART' });
        continue;
      }
      try {
        const detail = await this.cart.addToCart(current, { skuId: item.skuId, quantity: 1, sourceType: 'ROUTINE' });
        if (!current && detail.guestCartToken) current = { guestToken: detail.guestCartToken };
        cart = { ...detail, guestCartToken: cart?.guestCartToken ?? detail.guestCartToken };
        added.push(item.roleKey);
      } catch (error: unknown) {
        const e = error as { response?: { code?: string }; message?: string };
        skipped.push({ ...item, reason: e.response?.code ?? e.message ?? 'NOT_ADDED' });
      }
    }
    return { added, skipped, cart };
  }
}
