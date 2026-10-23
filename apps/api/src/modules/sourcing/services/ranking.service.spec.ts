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
  describe('GLO-280 policy: eligibility first, then lowest comparable cost', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);
    const offer = (id: string, supplierId: string, cost: number, extra: Record<string, unknown> = {}) => ({
      id, supplierId, skuId: 'sku-1', isAvailable: true, currency: 'EGP', costPrice: { toNumber: () => cost },
      lastObservedAt: new Date(), supplier: { isActive: true }, ...extra,
    });
    const rank = async (offers: unknown[], history: Record<string, [number, number, number]> = {}) => {
      (prismaService.supplierOffer.findMany as jest.Mock).mockResolvedValue(offers);
      (prismaService.purchaseOrderLine.count as jest.Mock).mockImplementation((args) => {
        const [total, full, unavailable] = history[args.where.purchaseOrder.supplierId] ?? [0, 0, 0];
        return Promise.resolve(args.where.status === 'confirmed_full' ? full : args.where.status === 'unavailable' ? unavailable : total);
      });
      return service.rankOffersForSku('sku-1', 1);
    };

    it('A 180 / B 165 / C 150 stale → B, A; the stale cheaper offer is excluded with its reason', async () => {
      const result = await rank([offer('a', 'A', 180), offer('b', 'B', 165), offer('c', 'C', 150, { lastObservedAt: daysAgo(10) })]);
      expect(result.rankedOffers.map(o => o.supplierId)).toEqual(['B', 'A']);
      expect(result.excludedOffers).toEqual([{ offerId: 'c', supplierId: 'C', reasonCodes: ['STALE_OFFER'] }]);
    });

    it('a fully reliable established supplier at 180 no longer outranks a new supplier at 100', async () => {
      // Old weighted score: 180 → 3.3 + 30 + 7 = 40.3 beat 100 → 6 + 15 + 7 = 28.
      const result = await rank([offer('old', 'OLD', 180), offer('new', 'NEW', 100)], { OLD: [50, 50, 0] });
      expect(result.rankedOffers.map(o => o.supplierId)).toEqual(['NEW', 'OLD']);
    });

    it('equal cost: the more reliable, then the fresher offer wins', async () => {
      const result = await rank([
        offer('z', 'Z', 100, { lastObservedAt: daysAgo(2) }), offer('y', 'Y', 100), offer('x', 'X', 100, { lastObservedAt: daysAgo(3) }),
      ], { X: [10, 10, 0], Y: [10, 8, 0], Z: [10, 8, 0] });
      expect(result.rankedOffers.map(o => o.supplierId)).toEqual(['X', 'Y', 'Z']);
    });

    it('100 / 102 / 800: the expensive outlier is flagged and ranks last; no median price is invented', async () => {
      const result = await rank([offer('a', 'A', 100), offer('b', 'B', 102), offer('c', 'C', 800)]);
      expect(result.rankedOffers.map(o => o.costPrice)).toEqual([100, 102, 800]);
      expect(result.rankedOffers[2].reasonCodes.some(c => c.startsWith('PRICE_OUTLIER_HIGH'))).toBe(true);
      expect(result.excludedOffers).toEqual([]);
    });

    it('never auto-selects a suspiciously cheap quote (100 / 102 / 30, and 40 vs 100)', async () => {
      const three = await rank([offer('a', 'A', 100), offer('b', 'B', 102), offer('c', 'C', 30)]);
      expect(three.rankedOffers.map(o => o.supplierId)).toEqual(['A', 'B']);
      expect(three.excludedOffers).toEqual([{ offerId: 'c', supplierId: 'C', reasonCodes: ['PRICE_ANOMALY_REVIEW'] }]);
      const two = await rank([offer('a', 'A', 100), offer('c', 'C', 40)]);
      expect(two.rankedOffers.map(o => o.supplierId)).toEqual(['A']);
    });

    it('a single offer has no benchmark and is not flagged', async () => {
      const result = await rank([offer('a', 'A', 5)]);
      expect(result.rankedOffers.map(o => o.supplierId)).toEqual(['A']);
      expect(result.excludedOffers).toEqual([]);
    });

    it('does not compare raw numbers across currencies', async () => {
      const result = await rank([offer('egp', 'A', 300), offer('sar', 'B', 20, { currency: 'SAR' })]);
      expect(result.rankedOffers.map(o => o.supplierId)).toEqual(['A']);
      expect(result.excludedOffers[0]).toMatchObject({ offerId: 'sar', reasonCodes: ['CURRENCY_NOT_COMPARABLE'] });
    });

    it('a cheaper supplier with poor confirmation history ranks behind a reliable one but stays a fallback', async () => {
      const result = await rank([offer('r', 'R', 120), offer('p', 'P', 100)], { R: [10, 10, 0], P: [10, 2, 8] });
      expect(result.rankedOffers.map(o => o.supplierId)).toEqual(['R', 'P']);
      expect(result.rankedOffers[1].reasonCodes).toContain('LOW_CONFIRMATION_RELIABILITY');
    });
  });
});

