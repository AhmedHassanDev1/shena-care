import { PurchaseOrderService } from './purchase-order.service';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RankingService } from './ranking.service';
import { PurchaseOrderStatus, PurchaseOrderLineStatus } from '@prisma/client';

describe('PurchaseOrderService', () => {
  let service: PurchaseOrderService;
  let prismaService: any;
  let rankingService: any;

  beforeEach(() => {
    prismaService = {
      supplierPurchaseOrder: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      supplier: {
        findUnique: jest.fn(),
      },
      supplierOffer: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };

    rankingService = {
      rankOffersForSku: jest.fn(),
    };

    const supplyPlan: any = { confirmFromPurchaseOrder: jest.fn(), advance: jest.fn() };
    const events: any = { registerHandler: jest.fn(), record: jest.fn(), dispatchSoon: jest.fn() };
    service = new PurchaseOrderService(prismaService, rankingService, supplyPlan, events, { openOperationalException: jest.fn() } as any);
  });

  describe('Legacy procurement gate', () => {
    it('refuses standalone creation without changing historical records', async () => {
      await expect(service.createPurchaseOrder({ supplierId: 'sup-manual', lines: [{ skuId: 'sku-1', requestedQuantity: 10 }] }))
        .rejects.toThrow('allocation lineage');
      expect(prismaService.supplierPurchaseOrder.create).not.toHaveBeenCalled();
    });
    it('refuses confirming an unlinked legacy commitment', async () => {
      prismaService.supplierPurchaseOrder.findUnique.mockResolvedValue({ id: 'po-legacy', supplierId: 'sup-1', status: 'sent',
        lines: [{ id: 'line-1', requestedQuantity: 10, allocations: [] }] });
      await expect(service.confirmPurchaseOrder('po-legacy', { lines: [{ id: 'line-1', status: PurchaseOrderLineStatus.confirmed_full }] }))
        .rejects.toThrow('allocation lineage');
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('Confirmation integrity (GLO-206)', () => {
    const order = {
      id: 'po-1', supplierId: 'sup-1', status: PurchaseOrderStatus.sent,
      lines: [{ id: 'line-1', skuId: 'sku-1', requestedQuantity: 10, status: PurchaseOrderLineStatus.pending, allocations: [{ orderId: 'order-1' }] }],
    };
    beforeEach(() => prismaService.supplierPurchaseOrder.findUnique.mockResolvedValue(order));

    it.each([
      ['a line from another order', [{ id: 'line-1', status: 'confirmed_full' }, { id: 'foreign-line', status: 'unavailable' }]],
      ['a duplicated line', [{ id: 'line-1', status: 'confirmed_full' }, { id: 'line-1', status: 'unavailable' }]],
      ['a full confirmation with a different quantity', [{ id: 'line-1', status: 'confirmed_full', confirmedQuantity: 99 }]],
      ['a partial confirmation above the request', [{ id: 'line-1', status: 'confirmed_partial', confirmedQuantity: 10 }]],
      ['a partial confirmation of nothing', [{ id: 'line-1', status: 'confirmed_partial', confirmedQuantity: 0 }]],
      ['a negative partial quantity', [{ id: 'line-1', status: 'confirmed_partial', confirmedQuantity: -3 }]],
      ['an unavailable line with stock', [{ id: 'line-1', status: 'unavailable', confirmedQuantity: 4 }]],
      ['a pending status', [{ id: 'line-1', status: 'pending' }]],
    ])('rejects %s without writing', async (_label, lines) => {
      await expect(service.confirmPurchaseOrder('po-1', { lines: lines as any })).rejects.toThrow();
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a replay that loses the status claim', async () => {
      const lineUpdate = jest.fn();
      prismaService.$transaction.mockImplementation(async (callback: any) => callback({
        purchaseOrderLine: { update: lineUpdate },
        supplierPurchaseOrder: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), update: jest.fn() },
      }));
      await expect(service.confirmPurchaseOrder('po-1', { lines: [{ id: 'line-1', status: PurchaseOrderLineStatus.confirmed_full }] }))
        .rejects.toThrow('already confirmed');
      expect(lineUpdate).not.toHaveBeenCalled();
    });
  });
});
