import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CommerceService } from '../../commerce/public';
import { SourcingService } from '../../sourcing/public';
import { CUSTOMER_VERIFIED_EVENT, CustomerVerifiedEvent } from '../../accounts/public';
import { AddToCartDto, RemoveFromCartDto, UpdateCartItemQuantityDto } from '../dto/cart.dto';

export const MAX_LINE_QUANTITY = 20;
export const MAX_CART_LINES = 50;

/** Cart owner: an authenticated customer or an opaque server-issued guest token. */
export type CartOwner = { customerId: string } | { guestToken: string };

export interface CartItemDetail {
  id: string;
  skuId: string;
  quantity: number;
  /** Current backend-resolved price (the only pricing authority). */
  price: number | null;
  /** Price observed when added (transparency only). */
  priceAtAdd: number | null;
  priceObservedAt: Date | null;
  priceChangedSinceAdd: boolean;
  canOrder: boolean;
  availability: 'available' | 'unavailable';
  lineTotal: number;
  sourceType: string | null;
}

export interface CartDetail {
  id: string | null;
  ownerType: 'customer' | 'guest';
  revision: number;
  items: CartItemDetail[];
  totalAmount: number;
  /** Present only when a new guest cart was just created; the client must keep it. */
  guestCartToken?: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceService: CommerceService,
    private readonly sourcingService: SourcingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Read the cart. Never persists anything; an unknown owner yields an empty projection. */
  async getCart(owner: CartOwner): Promise<CartDetail> {
    const cart = await this.findCart(owner);
    if (!cart) {
      if ('guestToken' in owner) throw new UnauthorizedException('Invalid cart token');
      return { id: null, ownerType: 'customer', revision: 0, items: [], totalAmount: 0 };
    }
    return this.project(cart, 'guestToken' in owner ? 'guest' : 'customer');
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Add an item. `owner = null` means anonymous with no cart yet: a guest cart is created and
   * its opaque token returned once as `guestCartToken`.
   */
  async addToCart(owner: CartOwner | null, dto: AddToCartDto): Promise<CartDetail> {
    const { price } = await this.assertSellable(dto.skuId);

    let issuedToken: string | undefined;
    let resolved: CartOwner;
    if (owner) {
      resolved = owner;
    } else {
      issuedToken = randomUUID();
      resolved = { guestToken: issuedToken };
      await this.prisma.cart.create({ data: { guestTokenHash: hashToken(issuedToken) } });
    }

    await this.mutate(resolved, dto.expectedRevision, async (tx, cart) => {
      const existing = cart.items.find((i) => i.skuId === dto.skuId);
      if (existing) {
        const quantity = existing.quantity + dto.quantity;
        if (quantity > MAX_LINE_QUANTITY) {
          throw new BadRequestException(`Maximum quantity per item is ${MAX_LINE_QUANTITY}.`);
        }
        await tx.cartItem.update({ where: { id: existing.id }, data: { quantity } });
        return;
      }
      if (cart.items.length >= MAX_CART_LINES) {
        throw new BadRequestException(`A cart can hold at most ${MAX_CART_LINES} different items.`);
      }
      if (dto.quantity > MAX_LINE_QUANTITY) {
        throw new BadRequestException(`Maximum quantity per item is ${MAX_LINE_QUANTITY}.`);
      }
      await tx.cartItem.create({
        data: {
          cartId: cart.id,
          skuId: dto.skuId,
          quantity: dto.quantity,
          priceAtAdd: price,
          priceObservedAt: new Date(),
          sourceType: dto.sourceType ?? null,
        },
      });
    });

    const detail = await this.getCart(resolved);
    if (issuedToken) detail.guestCartToken = issuedToken;
    return detail;
  }

  async updateQuantity(owner: CartOwner, dto: UpdateCartItemQuantityDto): Promise<CartDetail> {
    if (dto.quantity > MAX_LINE_QUANTITY) {
      throw new BadRequestException(`Maximum quantity per item is ${MAX_LINE_QUANTITY}.`);
    }
    await this.mutate(owner, dto.expectedRevision, async (tx, cart) => {
      const existing = cart.items.find((i) => i.skuId === dto.skuId);
      if (!existing) throw new BadRequestException('Item not found in cart');
      await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: dto.quantity } });
    });
    return this.getCart(owner);
  }

  async removeFromCart(owner: CartOwner, dto: RemoveFromCartDto): Promise<CartDetail> {
    await this.mutate(owner, dto.expectedRevision, async (tx, cart) => {
      const existing = cart.items.find((i) => i.skuId === dto.skuId);
      // Idempotent: removing an absent item is a no-op (revision still advances once).
      if (existing) await tx.cartItem.delete({ where: { id: existing.id } });
    });
    return this.getCart(owner);
  }

  async clearCart(owner: CartOwner, expectedRevision?: number): Promise<CartDetail> {
    await this.mutate(owner, expectedRevision, async (tx, cart) => {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    });
    return this.getCart(owner);
  }

  /** Called by checkout inside its own transaction to empty the customer's cart. */
  async clearAfterOrder(tx: Prisma.TransactionClient, cartId: string): Promise<void> {
    await tx.cartItem.deleteMany({ where: { cartId } });
    await tx.cart.update({ where: { id: cartId }, data: { revision: { increment: 1 } } });
  }

  // ---------------------------------------------------------------------------
  // Guest -> account adoption (contract: accounts/guest-adoption.contract.ts)
  // ---------------------------------------------------------------------------

  /**
   * Idempotent per (customerId, guestToken). If the customer has no cart the guest cart is
   * re-owned in place; otherwise lines are merged (same SKU sums, clamped to the line limit).
   * The guest cart is consumed, so replays find nothing and do nothing.
   */
  @OnEvent(CUSTOMER_VERIFIED_EVENT)
  async handleCustomerVerified(event: CustomerVerifiedEvent): Promise<void> {
    await this.adoptGuestCart(event.customerId, event.guestId);
  }

  async adoptGuestCart(customerId: string, guestToken: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const guest = await tx.cart.findUnique({
        where: { guestTokenHash: hashToken(guestToken) },
        include: { items: true },
      });
      if (!guest) return; // unknown or already adopted

      const mine = await tx.cart.findUnique({ where: { customerId }, include: { items: true } });
      if (!mine) {
        await tx.cart.update({
          where: { id: guest.id },
          data: { customerId, guestTokenHash: null, revision: { increment: 1 } },
        });
        return;
      }

      for (const item of guest.items) {
        const same = mine.items.find((i) => i.skuId === item.skuId);
        if (same) {
          await tx.cartItem.update({
            where: { id: same.id },
            data: { quantity: Math.min(same.quantity + item.quantity, MAX_LINE_QUANTITY) },
          });
        } else if (mine.items.length < MAX_CART_LINES) {
          mine.items.push(
            await tx.cartItem.create({
              data: {
                cartId: mine.id,
                skuId: item.skuId,
                quantity: Math.min(item.quantity, MAX_LINE_QUANTITY),
                priceAtAdd: item.priceAtAdd,
                priceObservedAt: item.priceObservedAt,
                sourceType: item.sourceType,
              },
            }),
          );
        }
      }
      await tx.cart.update({ where: { id: mine.id }, data: { revision: { increment: 1 } } });
      await tx.cart.delete({ where: { id: guest.id } });
    });
    this.logger.log(`Guest cart adopted for customer ${customerId}`);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async findCart(owner: CartOwner) {
    return this.prisma.cart.findUnique({
      where: 'customerId' in owner
        ? { customerId: owner.customerId }
        : { guestTokenHash: hashToken(owner.guestToken) },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
  }

  private async assertSellable(skuId: string): Promise<{ price: number }> {
    const [terms, isAvailable] = await Promise.all([
      this.commerceService.getSellingTerms(skuId),
      this.sourcingService.checkAvailability(skuId),
    ]);
    const price = terms?.price?.amount ?? null;
    if (!(terms?.canOrder && isAvailable) || price === null) {
      throw new BadRequestException('This item is currently unavailable for ordering.');
    }
    return { price };
  }

  /** Run a mutation atomically with optimistic revision control. */
  private async mutate(
    owner: CartOwner,
    expectedRevision: number | undefined,
    fn: (
      tx: Prisma.TransactionClient,
      cart: NonNullable<Awaited<ReturnType<CartService['findCart']>>>,
    ) => Promise<void>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      let cart = await tx.cart.findUnique({
        where: 'customerId' in owner
          ? { customerId: owner.customerId }
          : { guestTokenHash: hashToken(owner.guestToken) },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });
      if (!cart) {
        if ('guestToken' in owner) throw new UnauthorizedException('Invalid cart token');
        cart = await tx.cart.upsert({
          where: { customerId: owner.customerId },
          create: { customerId: owner.customerId },
          update: {},
          include: { items: { orderBy: { createdAt: 'asc' } } },
        });
      }
      if (expectedRevision !== undefined && cart.revision !== expectedRevision) {
        throw new ConflictException('Cart has changed; reload and retry.');
      }
      await fn(tx, cart);
      const bumped = await tx.cart.updateMany({
        where: { id: cart.id, revision: cart.revision },
        data: { revision: { increment: 1 } },
      });
      if (bumped.count !== 1) throw new ConflictException('Cart has changed; reload and retry.');
    });
  }

  private async project(
    cart: NonNullable<Awaited<ReturnType<CartService['findCart']>>>,
    ownerType: 'customer' | 'guest',
  ): Promise<CartDetail> {
    let totalAmount = 0;
    const items = await Promise.all(
      cart.items.map(async (item): Promise<CartItemDetail> => {
        const [terms, isAvailable] = await Promise.all([
          this.commerceService.getSellingTerms(item.skuId),
          this.sourcingService.checkAvailability(item.skuId),
        ]);
        const canOrder = (terms?.canOrder ?? false) && isAvailable;
        const price = terms?.price?.amount ?? null;
        const priceAtAdd = item.priceAtAdd ? item.priceAtAdd.toNumber() : null;
        const lineTotal = canOrder && price !== null ? price * item.quantity : 0;
        totalAmount += lineTotal;
        return {
          id: item.id,
          skuId: item.skuId,
          quantity: item.quantity,
          price,
          priceAtAdd,
          priceObservedAt: item.priceObservedAt,
          priceChangedSinceAdd: price !== null && priceAtAdd !== null && price !== priceAtAdd,
          canOrder,
          availability: canOrder ? 'available' : 'unavailable',
          lineTotal,
          sourceType: item.sourceType,
        };
      }),
    );
    return { id: cart.id, ownerType, revision: cart.revision, items, totalAmount };
  }
}
