import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CommerceService, SellingTerms } from '../../commerce/public';
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

export interface ReorderItemResult {
  skuId: string;
  productName: string | null;
  variantName: string | null;
  requestedQuantity: number;
  addedQuantity: number;
  price: number | null;
  status: 'added' | 'partially_added' | 'unavailable' | 'quantity_limit_reached' | 'cart_full';
  reason?: string;
}

export interface ReorderResult {
  cart: CartDetail;
  added: ReorderItemResult[];
  skipped: ReorderItemResult[];
  summary: {
    totalRequested: number;
    totalAdded: number;
    totalSkipped: number;
  };
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
    const { price, terms } = await this.assertSellable(dto.skuId);

    let issuedToken: string | undefined;
    let cart: NonNullable<Awaited<ReturnType<CartService['findCart']>>>;
    let ownerType: 'customer' | 'guest';

    if (!owner) {
      if (dto.quantity > MAX_LINE_QUANTITY) {
        throw new BadRequestException(`Maximum quantity per item is ${MAX_LINE_QUANTITY}.`);
      }
      issuedToken = randomUUID();
      ownerType = 'guest';
      cart = await this.prisma.cart.create({
        data: {
          guestTokenHash: hashToken(issuedToken),
          revision: 1,
          items: {
            create: {
              skuId: dto.skuId,
              quantity: dto.quantity,
              priceAtAdd: price,
              priceObservedAt: new Date(),
              sourceType: dto.sourceType ?? null,
            },
          },
        },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });
    } else {
      ownerType = 'guestToken' in owner ? 'guest' : 'customer';
      const result = await this.mutate(owner, dto.expectedRevision, async (tx, c) => {
        const existing = c.items.find((i) => i.skuId === dto.skuId);
        if (existing) {
          const quantity = existing.quantity + dto.quantity;
          if (quantity > MAX_LINE_QUANTITY) {
            throw new BadRequestException(`Maximum quantity per item is ${MAX_LINE_QUANTITY}.`);
          }
          await tx.cartItem.update({ where: { id: existing.id }, data: { quantity } });
          existing.quantity = quantity;
          return;
        }
        if (c.items.length >= MAX_CART_LINES) {
          throw new BadRequestException(`A cart can hold at most ${MAX_CART_LINES} different items.`);
        }
        if (dto.quantity > MAX_LINE_QUANTITY) {
          throw new BadRequestException(`Maximum quantity per item is ${MAX_LINE_QUANTITY}.`);
        }
        const created = await tx.cartItem.create({
          data: {
            cartId: c.id,
            skuId: dto.skuId,
            quantity: dto.quantity,
            priceAtAdd: price,
            priceObservedAt: new Date(),
            sourceType: dto.sourceType ?? null,
          },
        });
        c.items.push(created);
      });
      cart = result.cart;
    }

    const detail = await this.project(cart, ownerType, new Map([[dto.skuId, terms]]));
    if (issuedToken) detail.guestCartToken = issuedToken;
    return detail;
  }

  /**
   * Reorders eligible items from a previous order into the cart.
   *
   * Reuses cart validation, clamps or skips according to item and cart capacity limits,
   * skips unavailable or unlisted SKUs with clear status and reason,
   * and always resolves current catalog prices instead of historical order prices.
   */
  async reorderFromOrder(
    cartOwner: CartOwner | null,
    orderRef: { customerId?: string; guestToken?: string; idOrOrderNumber: string },
    options?: { skuIds?: string[] },
  ): Promise<ReorderResult> {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUUID = UUID_RE.test(orderRef.idOrOrderNumber);

    const where: Prisma.OrderWhereInput = {};
    if (orderRef.customerId) {
      where.customerId = orderRef.customerId;
      if (isUUID) where.id = orderRef.idOrOrderNumber;
      else where.orderNumber = orderRef.idOrOrderNumber;
    } else if (orderRef.guestToken) {
      where.orderNumber = orderRef.idOrOrderNumber;
      where.customerId = null;
      where.guestAccessTokenHash = hashToken(orderRef.guestToken);
      where.guestAccessExpiresAt = { gt: new Date() };
      where.guestAccessRevokedAt = null;
    } else {
      throw new UnauthorizedException('Authentication or order access token required');
    }

    const order = await this.prisma.order.findFirst({
      where,
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    let itemsToConsider = order.items.filter((item) => item.lineState === 'active');
    if (options?.skuIds && options.skuIds.length > 0) {
      const skuSet = new Set(options.skuIds);
      itemsToConsider = itemsToConsider.filter((item) => skuSet.has(item.skuId));
    }
    if (itemsToConsider.length === 0) {
      throw new BadRequestException('No items available to reorder from this order.');
    }

    let issuedToken: string | undefined;
    let resolvedOwner: CartOwner;
    if (cartOwner) {
      resolvedOwner = cartOwner;
    } else {
      issuedToken = randomUUID();
      resolvedOwner = { guestToken: issuedToken };
      await this.prisma.cart.create({ data: { guestTokenHash: hashToken(issuedToken) } });
    }

    const added: ReorderItemResult[] = [];
    const skipped: ReorderItemResult[] = [];

    const skuIdsToConsider = itemsToConsider.map((item) => item.skuId);
    const [termsBatch, availabilityBatch] = await Promise.all([
      this.commerceService.getSellingTermsBatch(skuIdsToConsider),
      this.sourcingService.checkAvailabilityBatch(skuIdsToConsider),
    ]);

    const { cart: updatedCart, ownerType } = await this.mutate(resolvedOwner, undefined, async (tx, cart) => {
      for (const item of itemsToConsider) {
        const terms = termsBatch.get(item.skuId);
        const isAvailable = availabilityBatch.get(item.skuId) ?? false;
        const currentPrice = terms?.price?.amount ?? null;
        const canOrder = (terms?.canOrder ?? false) && isAvailable && currentPrice !== null;

        if (!canOrder) {
          skipped.push({
            skuId: item.skuId,
            productName: item.productName,
            variantName: item.variantName,
            requestedQuantity: item.quantity,
            addedQuantity: 0,
            price: null,
            status: 'unavailable',
            reason: 'This item is currently unavailable or discontinued.',
          });
          continue;
        }

        const existing = cart.items.find((i) => i.skuId === item.skuId);
        const currentQuantity = existing ? existing.quantity : 0;
        const spaceAvailable = MAX_LINE_QUANTITY - currentQuantity;

        if (spaceAvailable <= 0) {
          skipped.push({
            skuId: item.skuId,
            productName: item.productName,
            variantName: item.variantName,
            requestedQuantity: item.quantity,
            addedQuantity: 0,
            price: currentPrice,
            status: 'quantity_limit_reached',
            reason: `Maximum quantity per item is ${MAX_LINE_QUANTITY}.`,
          });
          continue;
        }

        if (!existing && cart.items.length >= MAX_CART_LINES) {
          skipped.push({
            skuId: item.skuId,
            productName: item.productName,
            variantName: item.variantName,
            requestedQuantity: item.quantity,
            addedQuantity: 0,
            price: currentPrice,
            status: 'cart_full',
            reason: `A cart can hold at most ${MAX_CART_LINES} different items.`,
          });
          continue;
        }

        const qtyToAdd = Math.min(item.quantity, spaceAvailable);
        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: currentQuantity + qtyToAdd },
          });
          existing.quantity += qtyToAdd;
        } else {
          const created = await tx.cartItem.create({
            data: {
              cartId: cart.id,
              skuId: item.skuId,
              quantity: qtyToAdd,
              priceAtAdd: currentPrice,
              priceObservedAt: new Date(),
              sourceType: 'REORDER',
            },
          });
          cart.items.push(created);
        }

        added.push({
          skuId: item.skuId,
          productName: item.productName,
          variantName: item.variantName,
          requestedQuantity: item.quantity,
          addedQuantity: qtyToAdd,
          price: currentPrice,
          status: qtyToAdd < item.quantity ? 'partially_added' : 'added',
        });
      }
    });

    const cartDetail = await this.project(updatedCart, ownerType, termsBatch);
    if (issuedToken) cartDetail.guestCartToken = issuedToken;

    return {
      cart: cartDetail,
      added,
      skipped,
      summary: {
        totalRequested: itemsToConsider.length,
        totalAdded: added.reduce((sum, i) => sum + i.addedQuantity, 0),
        totalSkipped: skipped.length,
      },
    };
  }

  async updateQuantity(owner: CartOwner, dto: UpdateCartItemQuantityDto): Promise<CartDetail> {
    if (dto.quantity > MAX_LINE_QUANTITY) {
      throw new BadRequestException(`Maximum quantity per item is ${MAX_LINE_QUANTITY}.`);
    }
    const { cart, ownerType } = await this.mutate(owner, dto.expectedRevision, async (tx, c) => {
      const existing = c.items.find((i) => i.skuId === dto.skuId);
      if (!existing) throw new BadRequestException('Item not found in cart');
      await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: dto.quantity } });
      existing.quantity = dto.quantity;
    });
    return this.project(cart, ownerType);
  }

  async removeFromCart(owner: CartOwner, dto: RemoveFromCartDto): Promise<CartDetail> {
    const { cart, ownerType } = await this.mutate(owner, dto.expectedRevision, async (tx, c) => {
      const idx = c.items.findIndex((i) => i.skuId === dto.skuId);
      // Idempotent: removing an absent item is a no-op (revision still advances once).
      if (idx !== -1) {
        await tx.cartItem.delete({ where: { id: c.items[idx].id } });
        c.items.splice(idx, 1);
      }
    });
    return this.project(cart, ownerType);
  }

  async clearCart(owner: CartOwner, expectedRevision?: number): Promise<CartDetail> {
    const { cart, ownerType } = await this.mutate(owner, expectedRevision, async (tx, c) => {
      await tx.cartItem.deleteMany({ where: { cartId: c.id } });
      c.items = [];
    });
    return this.project(cart, ownerType);
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

  private async assertSellable(skuId: string): Promise<{ price: number; terms: SellingTerms }> {
    const [terms, isAvailable] = await Promise.all([
      this.commerceService.getSellingTerms(skuId),
      this.sourcingService.checkAvailability(skuId),
    ]);
    const price = terms?.price?.amount ?? null;
    if (!(terms?.canOrder && isAvailable) || price === null) {
      throw new BadRequestException('This item is currently unavailable for ordering.');
    }
    return { price, terms };
  }

  /** Run a mutation atomically with optimistic revision control. Returns updated cart and ownerType. */
  private async mutate(
    owner: CartOwner,
    expectedRevision: number | undefined,
    fn: (
      tx: Prisma.TransactionClient,
      cart: NonNullable<Awaited<ReturnType<CartService['findCart']>>>,
    ) => Promise<void>,
  ): Promise<{ cart: NonNullable<Awaited<ReturnType<CartService['findCart']>>>; ownerType: 'customer' | 'guest' }> {
    const ownerType: 'customer' | 'guest' = 'guestToken' in owner ? 'guest' : 'customer';
    const updatedCart = await this.prisma.$transaction(async (tx) => {
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
      cart.revision += 1;
      return cart;
    });
    return { cart: updatedCart, ownerType };
  }

  private async project(
    cart: NonNullable<Awaited<ReturnType<CartService['findCart']>>>,
    ownerType: 'customer' | 'guest',
    knownTerms?: Map<string, SellingTerms | null>,
  ): Promise<CartDetail> {
    if (cart.items.length === 0) {
      return { id: cart.id, ownerType, revision: cart.revision, items: [], totalAmount: 0 };
    }

    const skuIds = cart.items.map((i) => i.skuId);
    const missingSkuIds = knownTerms ? skuIds.filter((id) => !knownTerms.has(id)) : skuIds;

    const [batchTermsMap, availabilityMap] = await Promise.all([
      missingSkuIds.length > 0
        ? this.commerceService.getSellingTermsBatch(missingSkuIds)
        : Promise.resolve(new Map<string, SellingTerms | null>()),
      this.sourcingService.checkAvailabilityBatch(skuIds),
    ]);

    let totalAmount = 0;
    const items: CartItemDetail[] = cart.items.map((item): CartItemDetail => {
      const terms = (knownTerms && knownTerms.get(item.skuId)) ?? batchTermsMap.get(item.skuId);
      const isAvailable = availabilityMap.get(item.skuId) ?? false;
      const canOrder = (terms?.canOrder ?? false) && isAvailable;
      const price = terms?.price?.amount ?? null;
      const priceAtAdd = item.priceAtAdd
        ? typeof (item.priceAtAdd as any).toNumber === 'function'
          ? (item.priceAtAdd as any).toNumber()
          : Number(item.priceAtAdd)
        : null;
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
    });
    return { id: cart.id, ownerType, revision: cart.revision, items, totalAmount };
  }
}
