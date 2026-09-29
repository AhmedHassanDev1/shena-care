import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CommerceService } from '../../commerce/public';
import { SourcingService } from '../../sourcing/public';
import { AddToCartDto, RemoveFromCartDto } from '../dto/cart.dto';

export interface CartDetail {
  id: string;
  sessionId: string;
  items: Array<{
    id: string;
    skuId: string;
    quantity: number;
    price: number | null; // Latest price Snapshot
    canOrder: boolean;
  }>;
  totalAmount: number;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceService: CommerceService,
    private readonly sourcingService: SourcingService,
  ) {}

  async getCart(sessionId: string): Promise<CartDetail> {
    let cart = await this.prisma.cart.findUnique({
      where: { sessionId },
      include: { items: true },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { sessionId },
        include: { items: true },
      });
    }

    let totalAmount = 0;
    const enrichedItems = await Promise.all(
      cart.items.map(async (item) => {
        const [terms, isAvailable] = await Promise.all([
          this.commerceService.getSellingTerms(item.skuId),
          this.sourcingService.checkAvailability(item.skuId),
        ]);

        const canOrder = (terms?.canOrder ?? false) && isAvailable;
        const price = terms?.price?.amount ?? null;

        if (canOrder && price !== null) {
          totalAmount += price * item.quantity;
        }

        return {
          id: item.id,
          skuId: item.skuId,
          quantity: item.quantity,
          price,
          canOrder,
        };
      }),
    );

    return {
      id: cart.id,
      sessionId: cart.sessionId,
      items: enrichedItems,
      totalAmount,
    };
  }

  async addToCart(dto: AddToCartDto): Promise<CartDetail> {
    let cart = await this.prisma.cart.findUnique({
      where: { sessionId: dto.sessionId },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { sessionId: dto.sessionId },
      });
    }

    const [terms, isAvailable] = await Promise.all([
      this.commerceService.getSellingTerms(dto.skuId),
      this.sourcingService.checkAvailability(dto.skuId),
    ]);

    const canOrder = (terms?.canOrder ?? false) && isAvailable;
    if (!canOrder) {
      throw new BadRequestException('This item is currently unavailable for ordering.');
    }

    const existingItem = await this.prisma.cartItem.findUnique({
      where: {
        cartId_skuId: {
          cartId: cart.id,
          skuId: dto.skuId,
        },
      },
    });

    if (existingItem) {
      await this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + dto.quantity },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          skuId: dto.skuId,
          quantity: dto.quantity,
        },
      });
    }

    return this.getCart(dto.sessionId);
  }

  async removeFromCart(dto: RemoveFromCartDto): Promise<CartDetail> {
    const cart = await this.prisma.cart.findUnique({
      where: { sessionId: dto.sessionId },
    });

    if (cart) {
      const existingItem = await this.prisma.cartItem.findUnique({
        where: {
          cartId_skuId: {
            cartId: cart.id,
            skuId: dto.skuId,
          },
        },
      });

      if (existingItem) {
        await this.prisma.cartItem.delete({
          where: { id: existingItem.id },
        });
      }
    }

    return this.getCart(dto.sessionId);
  }

  async clearCart(sessionId: string): Promise<void> {
    const cart = await this.prisma.cart.findUnique({
      where: { sessionId },
    });

    if (cart) {
      await this.prisma.cartItem.deleteMany({
        where: { cartId: cart.id },
      });
    }
  }
}
