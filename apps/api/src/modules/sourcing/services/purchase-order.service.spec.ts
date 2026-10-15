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

  describe('Manual Override', () => {
    it('should create a purchase order directly bypassing ranking (manual override)', async () => {
      prismaService.supplier.findUnique.mockResolvedValue({ id: 'sup-manual' });
      prismaService.supplierPurchaseOrder.create.mockResolvedValue({ id: 'po-1' });

      const dto = {
        supplierId: 'sup-manual',
        lines: [{ skuId: 'sku-1', requestedQuantity: 10 }],
      };

      const result = await service.createPurchaseOrder(dto);
      
      expect(result.id).toBe('po-1');
      expect(prismaService.supplierPurchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ supplierId: 'sup-manual' })
        })
      );
    });
  });

  describe('Partial Fallback', () => {
    it('should auto-source shortage if confirmed partially', async () => {
      // Mock getPurchaseOrder
      prismaService.supplierPurchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        supplierId: 'sup-1',
        status: PurchaseOrderStatus.sent,
        lines: [
          { id: 'line-1', skuId: 'sku-1', requestedQuantity: 10, status: PurchaseOrderLineStatus.pending, allocations: [] }
        ]
      });

      // Mock transaction
      prismaService.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          purchaseOrderLine: { update: jest.fn() },
          supplierPurchaseOrder: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockResolvedValue({ status: PurchaseOrderStatus.partial }),
          }
        };
        // Run the callback and return the expected custom result map
        await callback(tx);
        return { updatedOrder: { id: 'po-1', status: 'partial' }, shortages: [{ skuId: 'sku-1', missingQty: 5 }] };
      });

      rankingService.rankOffersForSku.mockResolvedValue({
        decisionLogId: 'log-1',
        rankedOffers: [
          { supplierId: 'sup-2', score: 100 }
        ]
      });

      const confirmDto = {
        lines: [
          { id: 'line-1', status: PurchaseOrderLineStatus.confirmed_partial, confirmedQuantity: 5 }
        ]
      };

      await service.confirmPurchaseOrder('po-1', confirmDto);

      // Verify that autoSourceDemand was called which relies on rankingService
      expect(rankingService.rankOffersForSku).toHaveBeenCalledWith('sku-1', 5);
      
      // Verify that a new PO was created for the fallback supplier
      expect(prismaService.supplierPurchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierId: 'sup-2',
            notes: expect.stringContaining('Auto-sourced fallback')
          })
        })
      );
    });
  });

  describe('Confirmation integrity (GLO-206)', () => {
    const order = {
      id: 'po-1', supplierId: 'sup-1', status: PurchaseOrderStatus.sent,
      lines: [{ id: 'line-1', skuId: 'sku-1', requestedQuantity: 10, status: PurchaseOrderLineStatus.pending, allocations: [] }],
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
