import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CartService } from './cart.service';
import { CheckoutDto } from '../dto/order.dto';
import { OrderStatus } from '@prisma/client';

export interface OrderDetail {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  totalAmount: number;
  currency: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    skuId: string;
    quantity: number;
    price: number;
    currency: string;
  }>;
}

@Injectable()
export class OrderingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
  ) {}

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  async checkout(dto: CheckoutDto): Promise<OrderDetail> {
    const cart = await this.cartService.getCart(dto.sessionId);

    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty.');
    }

    const invalidItems = cart.items.filter((item) => !item.canOrder || item.price === null);
    if (invalidItems.length > 0) {
      throw new BadRequestException('Some items in the cart are no longer available for order.');
    }

    const currency = 'EGP'; // Defaulting to EGP for now

    const order = await this.prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          orderNumber: this.generateOrderNumber(),
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          shippingAddress: dto.shippingAddress,
          totalAmount: cart.totalAmount,
          currency,
          status: OrderStatus.placed,
          items: {
            create: cart.items.map((item) => ({
              skuId: item.skuId,
              quantity: item.quantity,
              price: item.price as number,
              currency,
            })),
          },
        },
        include: {
          items: true,
        },
      });

      // Clear the cart after successful order placement
      await tx.cartItem.deleteMany({
        where: {
          cartId: cart.id,
        },
      });

      return createdOrder;
    });

    return {
      ...order,
      totalAmount: order.totalAmount.toNumber(),
      items: order.items.map((item) => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }

  async getOrder(idOrOrderNumber: string): Promise<OrderDetail | null> {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { id: idOrOrderNumber },
          { orderNumber: idOrOrderNumber },
        ],
      },
      include: { items: true },
    });

    if (!order) return null;

    return {
      ...order,
      totalAmount: order.totalAmount.toNumber(),
      items: order.items.map((item) => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }

  async updateOrderStatus(id: string, status: OrderStatus): Promise<OrderDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!order) throw new NotFoundException(`Order ${id} not found.`);

    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: { items: true },
    });

    return {
      ...updatedOrder,
      totalAmount: updatedOrder.totalAmount.toNumber(),
      items: updatedOrder.items.map((item) => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }
}
