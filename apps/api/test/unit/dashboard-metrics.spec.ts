import {
  calcPeriodChangePercent,
  computeNetRealizedSales,
  evaluateOrderGoodsMargin,
  selectTopUniqueActionItems,
} from '../../src/modules/operations/services/dashboard-metrics';
import { DashboardService } from '../../src/modules/operations/services/dashboard.service';

describe('DashboardMetrics', () => {
  describe('computeNetRealizedSales', () => {
    it('excludes customer shipping fees and subtracts succeeded refunds', () => {
      const result = computeNetRealizedSales(
        [
          { orderId: 'o1', deliveredAt: new Date(), expectedOrTotal: 550, shippingFee: 50 },
          { orderId: 'o2', deliveredAt: new Date(), expectedOrTotal: 320, shippingFee: 20 },
        ],
        [{ amount: 100, at: new Date() }],
      );

      expect(result.goodsRevenue).toBe(800);
      expect(result.shippingFeesExcluded).toBe(70);
      expect(result.refundsSubtracted).toBe(100);
      expect(result.netSales).toBe(700);
    });

    it('returns zeros when there are no delivered orders', () => {
      const result = computeNetRealizedSales([], []);
      expect(result).toEqual({
        netSales: 0,
        goodsRevenue: 0,
        shippingFeesExcluded: 0,
        refundsSubtracted: 0,
      });
    });
  });

  describe('calcPeriodChangePercent', () => {
    it('returns null when previous period is zero to avoid misleading growth percentages', () => {
      expect(calcPeriodChangePercent(1200, 0)).toBeNull();
    });

    it('calculates positive and negative percentage changes accurately', () => {
      expect(calcPeriodChangePercent(150, 100)).toBe(50);
      expect(calcPeriodChangePercent(75, 100)).toBe(-25);
    });
  });

  describe('evaluateOrderGoodsMargin', () => {
    it('returns complete goods margin when all order items have captured invoice cost lots', () => {
      const res = evaluateOrderGoodsMargin(
        [{ id: 'i1', quantity: 2, price: 250, discountAmount: 0, lineTotal: 500 }],
        [
          {
            orderItemId: 'i1',
            receivedQuantity: 2,
            lineReceivedTotal: 4,
            lineCostedTotal: 4,
            lineCapturedValue: 600,
          },
        ],
      );
      expect(res).toEqual({ complete: true, goodsMargin: 200 });
    });

    it('returns incomplete when any item is missing captured cost lots', () => {
      const res = evaluateOrderGoodsMargin(
        [{ id: 'i1', quantity: 2, price: 250, discountAmount: 0, lineTotal: 500 }],
        [
          {
            orderItemId: 'i1',
            receivedQuantity: 2,
            lineReceivedTotal: 4,
            lineCostedTotal: 2,
            lineCapturedValue: 300,
          },
        ],
      );
      expect(res).toEqual({ complete: false, goodsMargin: null });
    });
  });

  describe('selectTopUniqueActionItems', () => {
    it('deduplicates multiple issues for the same order and preserves severity ranking', () => {
      const picked = selectTopUniqueActionItems([
        {
          id: 'c1',
          orderId: 'o1',
          orderNumber: 'ORD-1',
          type: 'cash_variance',
          categoryLabel: 'فرق تحصيل',
          title: 'ORD-1',
          description: 'variance',
          severity: 'warning',
          createdAt: '2026-11-12T10:00:00Z',
          actionLabel: 'مراجعة',
          actionHref: '/admin/cash',
        },
        {
          id: 's1',
          orderId: 'o1',
          orderNumber: 'ORD-1',
          type: 'supply_shortage',
          categoryLabel: 'نقص توريد',
          title: 'ORD-1',
          description: 'shortage',
          severity: 'critical',
          createdAt: '2026-11-12T09:00:00Z',
          actionLabel: 'قرار',
          actionHref: '/admin/exceptions',
        },
        {
          id: 'f1',
          orderId: 'o2',
          orderNumber: 'ORD-2',
          type: 'failed_delivery',
          categoryLabel: 'تعثر توصيل',
          title: 'ORD-2',
          description: 'failed',
          severity: 'critical',
          createdAt: '2026-11-12T08:00:00Z',
          actionLabel: 'معالجة',
          actionHref: '/admin/delivery',
        },
      ]);

      expect(picked).toHaveLength(2);
      expect(picked[0].id).toBe('s1');
      expect(picked[0].relatedIssueCount).toBe(1);
      expect(picked[1].id).toBe('f1');
    });
  });
});

describe('DashboardService RBAC & Empty Dataset', () => {
  const createMockPrisma = () => ({
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    orderStatusEvent: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    availabilityActionRequirement: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    availabilityDecision: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    shipment: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    paymentCollection: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { expectedAmount: null }, _count: { id: 0 } }),
    },
    supportCase: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    supplierPurchaseOrder: {
      count: jest.fn().mockResolvedValue(0),
    },
    refundTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  });

  it('hides financial metrics from HUB_OPERATOR role', async () => {
    const service = new DashboardService(createMockPrisma() as any);
    const overview = await service.getOverview({ roles: ['HUB_OPERATOR'] }, 1);

    expect(overview.days).toBe(1);
    expect(overview.salesChart.granularity).toBe('hourly');
    expect(overview.salesChart.hasFinancialAccess).toBe(false);
    expect(overview.salesChart.series).toHaveLength(24);
    expect(overview.salesChart.series[0].sales).toBeNull();
    expect(overview.kpis.netRealizedSales).toBeNull();
    expect(overview.kpis.contributionProfit).toBeNull();
    expect(overview.financialSummary).toBeNull();
  });

  it('returns zeroed sales and no_data contribution state for ADMIN on empty dataset', async () => {
    const service = new DashboardService(createMockPrisma() as any);
    const overview = await service.getOverview({ roles: ['ADMIN'] }, 7);

    expect(overview.days).toBe(7);
    expect(overview.salesChart.granularity).toBe('daily');
    expect(overview.salesChart.hasFinancialAccess).toBe(true);
    expect(overview.salesChart.series).toHaveLength(7);
    expect(overview.kpis.netRealizedSales?.amount).toBe(0);
    expect(overview.kpis.contributionProfit?.status).toBe('no_data');
    expect(overview.kpis.contributionProfit?.confirmedAmount).toBeNull();
    expect(overview.financialSummary?.unresolvedVariance.amount).toBe(0);
    expect(overview.actionRequired.totalIssues).toBe(0);
    expect(overview.actionRequired.affectedOrdersCount).toBe(0);
  });
});
