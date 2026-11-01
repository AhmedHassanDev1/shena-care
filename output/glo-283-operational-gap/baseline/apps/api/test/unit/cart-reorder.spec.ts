import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CartService, MAX_LINE_QUANTITY } from '../../src/modules/ordering/services/cart.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CommerceService } from '../../src/modules/commerce/public';
import { SourcingService } from '../../src/modules/sourcing/public';

describe('CartService.reorderFromOrder', () => {
  let service: CartService;
  let prisma: any;
  let commerceService: any;
  let sourcingService: any;

  const customerId = 'cust-uuid-1';
  const orderId = 'order-uuid-1';
  const orderNumber = 'ORD-1001';
  const sku1 = 'sku-uuid-1';
  const sku2 = 'sku-uuid-2';

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn(),
      },
      cart: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cartItem: {
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'ci-' + Math.random().toString(36).slice(2), ...data })),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    commerceService = {
      getSellingTerms: jest.fn(),
    };

    sourcingService = {
      checkAvailability: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommerceService, useValue: commerceService },
        { provide: SourcingService, useValue: sourcingService },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  it('reorders eligible items from an order using current catalog prices instead of historical prices', async () => {
    // Historical order had sku1 at 150 EGP (historical price) with qty 2
    prisma.order.findFirst.mockResolvedValue({
      id: orderId,
      orderNumber,
      customerId,
      items: [
        {
          id: 'item-1',
          skuId: sku1,
          quantity: 2,
          price: 150, // Old price
          productName: 'Gentle Cleanser',
          variantName: '200ml',
          lineState: 'active',
        },
      ],
    });

    // Existing cart is empty
    const mockCart = {
      id: 'cart-1',
      customerId,
      revision: 1,
      items: [],
    };
    prisma.cart.findUnique.mockResolvedValue(mockCart);
    prisma.cart.upsert.mockResolvedValue(mockCart);

    // Current catalog price is 180 EGP (new price)
    commerceService.getSellingTerms.mockResolvedValue({
      canOrder: true,
      price: { amount: 180, currency: 'EGP' },
    });
    sourcingService.checkAvailability.mockResolvedValue(true);

    prisma.cartItem.create.mockImplementation(({ data }: any) => {
      const created = { id: 'ci-1', ...data };
      mockCart.items.push(created as never);
      return created;
    });

    const result = await service.reorderFromOrder(
      { customerId },
      { customerId, idOrOrderNumber: orderNumber },
    );

    expect(result.summary.totalAdded).toBe(2);
    expect(result.summary.totalSkipped).toBe(0);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      skuId: sku1,
      requestedQuantity: 2,
      addedQuantity: 2,
      price: 180, // Verified current catalog price
      status: 'added',
    });

    expect(prisma.cartItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        skuId: sku1,
        quantity: 2,
        priceAtAdd: 180, // Must be current price
        sourceType: 'REORDER',
      }),
    });
  });

  it('gracefully handles unavailable/discontinued SKUs by skipping them while adding eligible ones', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: orderId,
      orderNumber,
      customerId,
      items: [
        {
          id: 'item-1',
          skuId: sku1,
          quantity: 1,
          price: 100,
          productName: 'Available Moisturizer',
          variantName: '50ml',
          lineState: 'active',
        },
        {
          id: 'item-2',
          skuId: sku2,
          quantity: 2,
          price: 200,
          productName: 'Discontinued Serum',
          variantName: '30ml',
          lineState: 'active',
        },
      ],
    });

    const mockCart = {
      id: 'cart-1',
      customerId,
      revision: 1,
      items: [],
    };
    prisma.cart.findUnique.mockResolvedValue(mockCart);
    prisma.cart.upsert.mockResolvedValue(mockCart);

    // SKU1 is available at 120
    // SKU2 is discontinued (canOrder: false)
    commerceService.getSellingTerms.mockImplementation((sku: string) => {
      if (sku === sku1) return Promise.resolve({ canOrder: true, price: { amount: 120 } });
      return Promise.resolve({ canOrder: false, price: null });
    });
    sourcingService.checkAvailability.mockImplementation((sku: string) => {
      return Promise.resolve(sku === sku1);
    });

    prisma.cartItem.create.mockImplementation(({ data }: any) => {
      const created = { id: 'ci-1', ...data };
      mockCart.items.push(created as never);
      return created;
    });

    const result = await service.reorderFromOrder(
      { customerId },
      { customerId, idOrOrderNumber: orderNumber },
    );

    expect(result.summary.totalAdded).toBe(1);
    expect(result.summary.totalSkipped).toBe(1);
    expect(result.added[0].skuId).toBe(sku1);
    expect(result.skipped[0].skuId).toBe(sku2);
    expect(result.skipped[0].status).toBe('unavailable');
  });

  it('respects quantity limits and clamps when item is already in cart', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: orderId,
      orderNumber,
      customerId,
      items: [
        {
          id: 'item-1',
          skuId: sku1,
          quantity: 5,
          price: 100,
          productName: 'Sunscreen',
          variantName: null,
          lineState: 'active',
        },
      ],
    });

    // Cart already has 18 of sku1 (MAX is 20)
    const existingItem = {
      id: 'existing-ci-1',
      cartId: 'cart-1',
      skuId: sku1,
      quantity: 18,
      priceAtAdd: 100,
    };
    const mockCart = {
      id: 'cart-1',
      customerId,
      revision: 1,
      items: [existingItem],
    };
    prisma.cart.findUnique.mockResolvedValue(mockCart);
    prisma.cart.upsert.mockResolvedValue(mockCart);

    commerceService.getSellingTerms.mockResolvedValue({
      canOrder: true,
      price: { amount: 110 },
    });
    sourcingService.checkAvailability.mockResolvedValue(true);

    const result = await service.reorderFromOrder(
      { customerId },
      { customerId, idOrOrderNumber: orderNumber },
    );

    // Only 2 could be added (18 + 2 = 20)
    expect(result.added[0].addedQuantity).toBe(2);
    expect(result.added[0].status).toBe('partially_added');
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'existing-ci-1' },
      data: { quantity: 20 },
    });
  });

  it('filters by skuIds when specific items are requested', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: orderId,
      orderNumber,
      customerId,
      items: [
        { id: 'item-1', skuId: sku1, quantity: 1, price: 50, productName: 'Item 1', lineState: 'active' },
        { id: 'item-2', skuId: sku2, quantity: 1, price: 60, productName: 'Item 2', lineState: 'active' },
      ],
    });

    const mockCart = { id: 'cart-1', customerId, revision: 1, items: [] };
    prisma.cart.findUnique.mockResolvedValue(mockCart);
    prisma.cart.upsert.mockResolvedValue(mockCart);

    commerceService.getSellingTerms.mockResolvedValue({ canOrder: true, price: { amount: 55 } });
    sourcingService.checkAvailability.mockResolvedValue(true);

    const result = await service.reorderFromOrder(
      { customerId },
      { customerId, idOrOrderNumber: orderNumber },
      { skuIds: [sku1] },
    );

    expect(result.summary.totalRequested).toBe(1);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].skuId).toBe(sku1);
  });

  it('throws NotFoundException when the order does not exist or does not belong to the customer', async () => {
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(
      service.reorderFromOrder(
        { customerId },
        { customerId, idOrOrderNumber: 'non-existent-order' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('supports guest reorder with guest token and creates a new guest cart if none exists', async () => {
    const guestOrderToken = 'guest-order-secret-token';
    prisma.order.findFirst.mockResolvedValue({
      id: orderId,
      orderNumber,
      customerId: null,
      items: [
        { id: 'item-1', skuId: sku1, quantity: 1, price: 100, productName: 'Item 1', lineState: 'active' },
      ],
    });

    const mockGuestCart = { id: 'guest-cart-1', revision: 1, items: [] };
    prisma.cart.create.mockResolvedValue(mockGuestCart);
    prisma.cart.findUnique.mockResolvedValue(mockGuestCart);
    prisma.cart.upsert.mockResolvedValue(mockGuestCart);

    commerceService.getSellingTerms.mockResolvedValue({ canOrder: true, price: { amount: 120 } });
    sourcingService.checkAvailability.mockResolvedValue(true);

    const result = await service.reorderFromOrder(
      null, // anonymous/no cart yet
      { guestToken: guestOrderToken, idOrOrderNumber: orderNumber },
    );

    expect(result.summary.totalAdded).toBe(1);
    expect(result.cart.guestCartToken).toBeDefined();
    expect(result.added[0].price).toBe(120);
  });

  it('throws UnauthorizedException when neither customerId nor guestToken is provided', async () => {
    await expect(
      service.reorderFromOrder(
        null,
        { idOrOrderNumber: orderNumber } as any,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
