import { RankingService } from './ranking.service';
import { PrismaService } from '../../../platform/database/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('RankingService', () => {
  let service: RankingService;
  let prismaService: PrismaService;

  beforeEach(() => {
    prismaService = {
      supplierOffer: {
        findMany: jest.fn(),
      },
      purchaseOrderLine: {
        count: jest.fn(),
      },
    } as any;

    service = new RankingService(prismaService);
  });

  it('should rank a cheaper reliable offer higher than an expensive one', async () => {
    (prismaService.supplierOffer.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'offer-1', supplierId: 'sup-1', skuId: 'sku-1', isAvailable: true,
        costPrice: { toNumber: () => 100 },
        lastObservedAt: new Date(),
        supplier: { isActive: true },
      },
      {
        id: 'offer-2', supplierId: 'sup-2', skuId: 'sku-1', isAvailable: true,
        costPrice: { toNumber: () => 50 },
        lastObservedAt: new Date(),
        supplier: { isActive: true },
      },
    ]);

    (prismaService.purchaseOrderLine.count as jest.Mock).mockResolvedValue(10); // neutral reliability

    const result = await service.rankOffersForSku('sku-1', 1);
    
    expect(result.rankedOffers.length).toBe(2);
    expect(result.rankedOffers[0].supplierId).toBe('sup-2'); // Cheaper
    expect(result.rankedOffers[1].supplierId).toBe('sup-1');
  });

  it('should exclude stale offers even if they are cheap', async () => {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 10);

    (prismaService.supplierOffer.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'offer-1', supplierId: 'sup-1', skuId: 'sku-1', isAvailable: true,
        costPrice: { toNumber: () => 100 },
        lastObservedAt: new Date(),
        supplier: { isActive: true },
      },
      {
        id: 'offer-2', supplierId: 'sup-2', skuId: 'sku-1', isAvailable: true,
        costPrice: { toNumber: () => 10 }, // extremely cheap but stale
        lastObservedAt: staleDate,
        supplier: { isActive: true },
      },
    ]);

    (prismaService.purchaseOrderLine.count as jest.Mock).mockResolvedValue(10); 

    const result = await service.rankOffersForSku('sku-1', 1);
    
    expect(result.rankedOffers.length).toBe(1);
    expect(result.rankedOffers[0].supplierId).toBe('sup-1');
    expect(result.rankedOffers[0].reasonCodes).not.toContain('STALE_OFFER');
  });

  it('should give new suppliers a neutral prior', async () => {
    (prismaService.supplierOffer.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'offer-1', supplierId: 'sup-1', skuId: 'sku-1', isAvailable: true,
        costPrice: { toNumber: () => 100 },
        lastObservedAt: new Date(),
        supplier: { isActive: true },
      },
    ]);

    // Mock count returning 0 indicating no history
    (prismaService.purchaseOrderLine.count as jest.Mock).mockResolvedValue(0);

    const result = await service.rankOffersForSku('sku-1', 1);
    
    expect(result.rankedOffers[0].score).toBeDefined();
    // Neutral prior is 0.5. 0.5 * 100 * 0.3 = 15 points for reliability
    expect(result.rankedOffers[0].reasonCodes.find(c => c.includes('RELIABILITY_SCORE'))).toBe('RELIABILITY_SCORE:0.50');
  });

  it('should penalize suppliers with high unavailability (price baiting proxy)', async () => {
    (prismaService.supplierOffer.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'offer-1', supplierId: 'sup-1', skuId: 'sku-1', isAvailable: true,
        costPrice: { toNumber: () => 100 },
        lastObservedAt: new Date(),
        supplier: { isActive: true },
      },
      {
        id: 'offer-2', supplierId: 'sup-2', skuId: 'sku-1', isAvailable: true,
        costPrice: { toNumber: () => 90 }, // slightly cheaper
        lastObservedAt: new Date(),
        supplier: { isActive: true },
      },
    ]);

    // Sup-1 has 100% full confirmed
    // Sup-2 has 10/100 full, 90/100 unavailable
    (prismaService.purchaseOrderLine.count as jest.Mock).mockImplementation((args) => {
      const sup = args.where.purchaseOrder.supplierId;
      if (sup === 'sup-1') return Promise.resolve(10); // always 10 for all queries
      if (sup === 'sup-2') {
        if (args.where.status === 'confirmed_full') return Promise.resolve(10);
        if (args.where.status === 'unavailable') return Promise.resolve(90);
        return Promise.resolve(100);
      }
      return Promise.resolve(0);
    });

    const result = await service.rankOffersForSku('sku-1', 1);
    
    expect(result.rankedOffers.length).toBe(2);
    // Despite sup-2 being cheaper, sup-1 should win due to high penalty on sup-2
    expect(result.rankedOffers[0].supplierId).toBe('sup-1');
  });

  it('should throw NotFound if no eligible suppliers exist', async () => {
    (prismaService.supplierOffer.findMany as jest.Mock).mockResolvedValue([]);

    await expect(service.rankOffersForSku('sku-1', 1)).rejects.toThrow(NotFoundException);
  });
});
