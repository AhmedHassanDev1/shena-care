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
      $transaction: jest.fn(),
    };

    rankingService = {
      rankOffersForSku: jest.fn(),
    };

    service = new PurchaseOrderService(prismaService, rankingService);
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
          { id: 'line-1', skuId: 'sku-1', requestedQuantity: 10, status: PurchaseOrderLineStatus.pending }
        ]
      });

      // Mock transaction
      prismaService.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          purchaseOrderLine: { update: jest.fn() },
          supplierPurchaseOrder: { update: jest.fn().mockResolvedValue({ status: PurchaseOrderStatus.partial }) }
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
});
