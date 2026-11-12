import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  ActionCandidate,
  calcPeriodChangePercent,
  computeNetRealizedSales,
  DeliveredOrderFinancialInput,
  evaluateOrderGoodsMargin,
  OverviewDays,
  RefundInput,
  roundMoney,
  roundPercent,
  selectTopUniqueActionItems,
} from './dashboard-metrics';

function getCairoMidnightUtc(now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );

  const hour = parseInt(parts.hour, 10) % 24;
  const minute = parseInt(parts.minute, 10);
  const second = parseInt(parts.second, 10);
  const msOffset = (hour * 3600 + minute * 60 + second) * 1000 + now.getMilliseconds();

  return new Date(now.getTime() - msOffset);
}

const cairoHourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  hour: 'numeric',
  hour12: false,
});

const dayDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dayNameFormatter = new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  weekday: 'long',
});

const shortDateFormatter = new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  day: 'numeric',
  month: 'short',
});

const ALL_ORDER_STATUSES = [
  'placed',
  'confirmed',
  'packing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
] as const;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getKpis(user?: { roles?: string[] }) {
    const cairoMidnightUtc = getCairoMidnightUtc();

    const hourlyInflow = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${h.toString().padStart(2, '0')}:00`,
      count: 0,
    }));

    const [ordersTodayList, statusCounts, openSupportCases, unconfirmedPOs, pendingIngestions] =
      await Promise.all([
        this.prisma.order.findMany({
          where: { createdAt: { gte: cairoMidnightUtc } },
          select: { createdAt: true },
        }),
        this.prisma.order.groupBy({
          by: ['status'],
          _count: { id: true },
        }),
        this.prisma.supportCase.count({ where: { status: { in: ['open', 'in_progress'] } } }),
        this.prisma.supplierPurchaseOrder.count({ where: { status: 'sent' } }),
        this.prisma.ingestionJob.count({ where: { status: 'pending' } }),
      ]);

    for (const order of ordersTodayList) {
      const h = parseInt(cairoHourFormatter.format(order.createdAt), 10) % 24;
      if (hourlyInflow[h]) {
        hourlyInflow[h].count += 1;
      }
    }

    const ordersToday = ordersTodayList.length;

    const statusMap = new Map<string, number>();
    let totalOrders = 0;
    for (const sc of statusCounts) {
      statusMap.set(sc.status, sc._count.id);
      totalOrders += sc._count.id;
    }

    const placed = statusMap.get('placed') || 0;
    const confirmed = statusMap.get('confirmed') || 0;
    const packing = statusMap.get('packing') || 0;
    const shipped = statusMap.get('shipped') || 0;
    const delivered = statusMap.get('delivered') || 0;
    const cancelled = statusMap.get('cancelled') || 0;
    const returned = statusMap.get('returned') || 0;

    const activeFulfillment = confirmed + packing + shipped;
    const activeOrders = placed + confirmed + packing + shipped;
    const terminal = cancelled + returned;

    const hasFinancialAccess = Boolean(user?.roles?.includes('ADMIN'));

    let revenueToday: number | null = null;
    let totalRevenue: number | null = null;
    let averageOrderValue: number | null = null;

    if (hasFinancialAccess) {
      const [revenueResult, revenueTodayResult] = await Promise.all([
        this.prisma.order.aggregate({
          _sum: { totalAmount: true },
          where: { status: { not: 'cancelled' } },
        }),
        this.prisma.order.aggregate({
          _sum: { totalAmount: true },
          where: { status: { not: 'cancelled' }, createdAt: { gte: cairoMidnightUtc } },
        }),
      ]);

      totalRevenue = Number(revenueResult._sum.totalAmount || 0);
      revenueToday = Number(revenueTodayResult._sum.totalAmount || 0);
      averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    }

    return {
      revenueToday,
      totalRevenue,
      averageOrderValue,
      ordersToday,
      totalOrders,
      activeFulfillment,
      activeOrders,
      pipeline: {
        placed,
        confirmed,
        packing,
        shipped,
        delivered,
        terminal,
        total: totalOrders,
      },
      hourlyInflow,
      attentionCenter: {
        openSupportCases,
        unconfirmedPOs,
        pendingIngestions,
      },
    };
  }

  async getOverview(user?: { roles?: string[] }, days: OverviewDays | number = 7) {
    const daysCount: OverviewDays = days === 1 ? 1 : days === 30 ? 30 : 7;
    const now = new Date();
    const cairoMidnightUtc = getCairoMidnightUtc(now);
    const dayMs = 24 * 3600 * 1000;
    const windowStartUtc =
      daysCount === 1
        ? cairoMidnightUtc
        : new Date(cairoMidnightUtc.getTime() - (daysCount - 1) * dayMs);
    const prevWindowStartUtc = new Date(windowStartUtc.getTime() - daysCount * dayMs);

    const hasFinancialAccess = Boolean(user?.roles?.includes('ADMIN'));
    const granularity = daysCount === 1 ? ('hourly' as const) : ('daily' as const);

    const buckets: Array<{
      key: string;
      label: string;
      shortLabel: string;
      orders: number;
      delivered: number;
      sales: number | null;
      previousSales: number | null;
    }> = [];
    const currentIndexMap = new Map<string, number>();
    const prevIndexMap = new Map<string, number>();

    if (granularity === 'hourly') {
      for (let h = 0; h < 24; h++) {
        const label = `${h.toString().padStart(2, '0')}:00`;
        buckets.push({
          key: String(h),
          label,
          shortLabel: label,
          orders: 0,
          delivered: 0,
          sales: hasFinancialAccess ? 0 : null,
          previousSales: hasFinancialAccess ? 0 : null,
        });
        currentIndexMap.set(String(h), h);
        prevIndexMap.set(String(h), h);
      }
    } else {
      for (let i = 0; i < daysCount; i++) {
        const currDate = new Date(windowStartUtc.getTime() + i * dayMs);
        const prevDate = new Date(prevWindowStartUtc.getTime() + i * dayMs);
        const currKey = dayDateFormatter.format(currDate);
        const prevKey = dayDateFormatter.format(prevDate);
        buckets.push({
          key: currKey,
          label: dayNameFormatter.format(currDate),
          shortLabel: shortDateFormatter.format(currDate),
          orders: 0,
          delivered: 0,
          sales: hasFinancialAccess ? 0 : null,
          previousSales: hasFinancialAccess ? 0 : null,
        });
        currentIndexMap.set(currKey, i);
        prevIndexMap.set(prevKey, i);
      }
    }

    const [
      ordersSincePrevWindow,
      deliveredEventsSincePrevWindow,
      terminalEventsInWindow,
      statusGroupCounts,
      supplyRequirements,
      customerDecisions,
      failedShipments,
      cashVariancesList,
      openSupportCasesList,
      allSupplyReqOrderIds,
      allPendingDecisionOrderIds,
      allFailedShipmentOrderIds,
      allCashVarianceRows,
      allOpenSupportCaseRows,
      awaitingSourcingCount,
      sourcingReceivingCount,
      packingFulfillmentCount,
      outForDeliveryCount,
      exceptionsStalledCount,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: prevWindowStartUtc } },
        select: { createdAt: true },
      }),
      this.prisma.orderStatusEvent.findMany({
        where: { status: 'delivered', createdAt: { gte: prevWindowStartUtc } },
        select: { orderId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.orderStatusEvent.findMany({
        where: {
          status: { in: ['delivered', 'returned', 'cancelled'] },
          createdAt: { gte: windowStartUtc },
        },
        select: { orderId: true, status: true },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.availabilityActionRequirement.findMany({
        where: { requirement: { releasedAt: null } },
        include: { requirement: { include: { supplyRequest: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.availabilityDecision.findMany({
        where: { status: 'pending' },
        include: { order: { select: { id: true, orderNumber: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.shipment.findMany({
        where: { status: 'failed' },
        orderBy: { updatedAt: 'desc' },
        include: { events: { where: { type: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 1 } },
        take: 10,
      }),
      this.prisma.paymentCollection.findMany({
        where: { status: { in: ['short', 'over'] } },
        include: { order: { select: { id: true, orderNumber: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      this.prisma.supportCase.findMany({
        where: { status: { in: ['open', 'in_progress'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.availabilityActionRequirement.findMany({
        where: { requirement: { releasedAt: null } },
        select: { requirement: { select: { supplyRequest: { select: { orderId: true } } } } },
      }),
      this.prisma.availabilityDecision.findMany({
        where: { status: 'pending' },
        select: { orderId: true },
      }),
      this.prisma.shipment.findMany({
        where: { status: 'failed' },
        select: { orderId: true },
      }),
      this.prisma.paymentCollection.findMany({
        where: { status: { in: ['short', 'over'] } },
        select: {
          orderId: true,
          expectedAmount: true,
          collectedAmount: true,
          notes: true,
          order: { select: { orderNumber: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.supportCase.findMany({
        where: { status: { in: ['open', 'in_progress'] } },
        select: { orderId: true, priority: true },
      }),
      this.prisma.order.count({ where: { status: 'placed' } }),
      this.prisma.supplierPurchaseOrder.count({
        where: { status: { in: ['ready', 'received_at_hub'] } },
      }),
      this.prisma.order.count({ where: { status: { in: ['confirmed', 'packing'] } } }),
      this.prisma.order.count({ where: { status: 'shipped' } }),
      this.prisma.shipment.count({ where: { status: 'failed' } }),
    ]);

    const bucketKeyForDate = (date: Date) =>
      granularity === 'hourly'
        ? String(parseInt(cairoHourFormatter.format(date), 10) % 24)
        : dayDateFormatter.format(date);

    // 1. Order inflows (current vs previous window)
    let newOrdersCount = 0;
    let prevNewOrdersCount = 0;
    for (const o of ordersSincePrevWindow) {
      if (o.createdAt >= windowStartUtc) {
        newOrdersCount += 1;
        const idx = currentIndexMap.get(bucketKeyForDate(o.createdAt));
        if (idx !== undefined) buckets[idx].orders += 1;
      } else {
        prevNewOrdersCount += 1;
      }
    }

    // 2. Delivered events deduplicated per order (latest event wins)
    const deliveredByOrder = new Map<string, Date>();
    for (const ev of deliveredEventsSincePrevWindow) {
      if (!deliveredByOrder.has(ev.orderId)) {
        deliveredByOrder.set(ev.orderId, ev.createdAt);
      }
    }

    const currentDeliveredOrderIds: string[] = [];
    const prevDeliveredOrderIds: string[] = [];
    for (const [orderId, deliveredAt] of deliveredByOrder.entries()) {
      if (deliveredAt >= windowStartUtc) {
        currentDeliveredOrderIds.push(orderId);
        const idx = currentIndexMap.get(bucketKeyForDate(deliveredAt));
        if (idx !== undefined) buckets[idx].delivered += 1;
      } else {
        prevDeliveredOrderIds.push(orderId);
      }
    }

    const terminalOrdersInWindow = new Set(terminalEventsInWindow.map((e) => e.orderId));
    const completedOrdersCount = currentDeliveredOrderIds.length;
    const prevCompletedOrdersCount = prevDeliveredOrderIds.length;
    const completionRate = roundPercent(completedOrdersCount, terminalOrdersInWindow.size);

    // 3. Financial metrics & Sales chart (strictly ADMIN only)
    let netRealizedSales: {
      amount: number;
      previousAmount: number;
      changePercent: number | null;
      shippingFeesExcluded: number;
      refundsSubtracted: number;
      deliveredOrdersCount: number;
      sparkline: number[];
    } | null = null;

    let contributionProfit: {
      status: 'incomplete' | 'no_data';
      confirmedAmount: null;
      goodsMarginOnly: number | null;
      coveredOrdersCount: number;
      totalDeliveredOrdersCount: number;
      missingComponents: Array<'supplier_invoices' | 'packaging_costs' | 'delivery_expenses'>;
    } | null = null;

    let financialSummary: {
      pendingCod: { amount: number; shipmentCount: number; currency: string };
      unresolvedVariance: {
        amount: number;
        caseCount: number;
        currency: string;
        details: string | null;
      };
    } | null = null;

    let hasPreviousComparison = false;

    if (hasFinancialAccess) {
      const allDeliveredOrderIds = [...currentDeliveredOrderIds, ...prevDeliveredOrderIds];
      const [deliveredOrdersData, deliveredCollectionsData, refundsSincePrevWindow, pendingCodRes] =
        await Promise.all([
          allDeliveredOrderIds.length
            ? this.prisma.order.findMany({
                where: { id: { in: allDeliveredOrderIds } },
                select: { id: true, totalAmount: true, shippingFee: true },
              })
            : Promise.resolve([]),
          allDeliveredOrderIds.length
            ? this.prisma.paymentCollection.findMany({
                where: { orderId: { in: allDeliveredOrderIds } },
                select: { orderId: true, expectedAmount: true },
              })
            : Promise.resolve([]),
          this.prisma.refundTransaction.findMany({
            where: { status: 'succeeded', updatedAt: { gte: prevWindowStartUtc } },
            select: { amount: true, updatedAt: true },
          }),
          this.prisma.paymentCollection.aggregate({
            where: { status: 'expected' },
            _sum: { expectedAmount: true },
            _count: { id: true },
          }),
        ]);

      const orderFinancialMap = new Map(deliveredOrdersData.map((o) => [o.id, o]));
      const collectionMap = new Map(deliveredCollectionsData.map((c) => [c.orderId, c.expectedAmount]));

      const currentDeliveredFinancials: DeliveredOrderFinancialInput[] = [];
      const prevDeliveredFinancials: DeliveredOrderFinancialInput[] = [];

      for (const [orderId, deliveredAt] of deliveredByOrder.entries()) {
        const orderRow = orderFinancialMap.get(orderId);
        if (!orderRow) continue;
        const expectedOrTotal = Number(collectionMap.get(orderId) ?? orderRow.totalAmount);
        const shippingFee = Number(orderRow.shippingFee || 0);
        const item: DeliveredOrderFinancialInput = {
          orderId,
          deliveredAt,
          expectedOrTotal,
          shippingFee,
        };
        const goodsValue = expectedOrTotal - Math.max(0, shippingFee);

        if (deliveredAt >= windowStartUtc) {
          currentDeliveredFinancials.push(item);
          const idx = currentIndexMap.get(bucketKeyForDate(deliveredAt));
          if (idx !== undefined && buckets[idx].sales !== null) {
            buckets[idx].sales = roundMoney((buckets[idx].sales ?? 0) + goodsValue);
          }
        } else {
          prevDeliveredFinancials.push(item);
          const idx = prevIndexMap.get(bucketKeyForDate(deliveredAt));
          if (idx !== undefined && buckets[idx].previousSales !== null) {
            buckets[idx].previousSales = roundMoney((buckets[idx].previousSales ?? 0) + goodsValue);
          }
        }
      }

      const currentRefunds: RefundInput[] = [];
      const prevRefunds: RefundInput[] = [];
      for (const r of refundsSincePrevWindow) {
        const amt = Number(r.amount || 0);
        if (r.updatedAt >= windowStartUtc) {
          currentRefunds.push({ amount: amt, at: r.updatedAt });
          const idx = currentIndexMap.get(bucketKeyForDate(r.updatedAt));
          if (idx !== undefined && buckets[idx].sales !== null) {
            buckets[idx].sales = roundMoney((buckets[idx].sales ?? 0) - amt);
          }
        } else {
          prevRefunds.push({ amount: amt, at: r.updatedAt });
          const idx = prevIndexMap.get(bucketKeyForDate(r.updatedAt));
          if (idx !== undefined && buckets[idx].previousSales !== null) {
            buckets[idx].previousSales = roundMoney((buckets[idx].previousSales ?? 0) - amt);
          }
        }
      }

      const currSalesRes = computeNetRealizedSales(currentDeliveredFinancials, currentRefunds);
      const prevSalesRes = computeNetRealizedSales(prevDeliveredFinancials, prevRefunds);
      hasPreviousComparison = prevSalesRes.netSales > 0;

      netRealizedSales = {
        amount: currSalesRes.netSales,
        previousAmount: prevSalesRes.netSales,
        changePercent: calcPeriodChangePercent(currSalesRes.netSales, prevSalesRes.netSales),
        shippingFeesExcluded: currSalesRes.shippingFeesExcluded,
        refundsSubtracted: currSalesRes.refundsSubtracted,
        deliveredOrdersCount: currentDeliveredFinancials.length,
        sparkline: buckets.map((b) => b.sales ?? 0),
      };

      // Evaluate actual supplier invoice coverage for delivered orders in current window
      if (currentDeliveredOrderIds.length === 0) {
        contributionProfit = {
          status: 'no_data',
          confirmedAmount: null,
          goodsMarginOnly: null,
          coveredOrdersCount: 0,
          totalDeliveredOrdersCount: 0,
          missingComponents: ['packaging_costs', 'delivery_expenses'],
        };
      } else {
        const [deliveredOrderItems, deliveredAllocations] = await Promise.all([
          this.prisma.orderItem.findMany({
            where: { orderId: { in: currentDeliveredOrderIds }, lineState: 'active' },
            select: {
              id: true,
              orderId: true,
              quantity: true,
              price: true,
              discountAmount: true,
              lineTotal: true,
            },
          }),
          this.prisma.purchaseOrderLineAllocation.findMany({
            where: { orderId: { in: currentDeliveredOrderIds } },
            select: {
              orderId: true,
              orderItemId: true,
              receivedQuantity: true,
              line: {
                select: {
                  allocations: { select: { receivedQuantity: true } },
                  costLots: { select: { quantity: true, unitCost: true } },
                },
              },
            },
          }),
        ]);

        let coveredOrdersCount = 0;
        let goodsMarginSum = 0;
        let allOrdersCovered = true;

        for (const oid of currentDeliveredOrderIds) {
          const itemsForOrder = deliveredOrderItems
            .filter((it) => it.orderId === oid)
            .map((it) => ({
              id: it.id,
              quantity: it.quantity,
              price: Number(it.price),
              discountAmount: Number(it.discountAmount ?? 0),
              lineTotal: it.lineTotal !== null ? Number(it.lineTotal) : null,
            }));

          const allocsForOrder = deliveredAllocations
            .filter((al) => al.orderId === oid)
            .map((al) => ({
              orderItemId: al.orderItemId,
              receivedQuantity: al.receivedQuantity,
              lineReceivedTotal: al.line.allocations.reduce((s, a) => s + a.receivedQuantity, 0),
              lineCostedTotal: al.line.costLots.reduce((s, l) => s + l.quantity, 0),
              lineCapturedValue: al.line.costLots.reduce(
                (s, l) => s + Number(l.unitCost) * l.quantity,
                0,
              ),
            }));

          const res = evaluateOrderGoodsMargin(itemsForOrder, allocsForOrder);
          if (res.complete && res.goodsMargin !== null) {
            coveredOrdersCount += 1;
            goodsMarginSum += res.goodsMargin;
          } else {
            allOrdersCovered = false;
          }
        }

        const missingComponents: Array<'supplier_invoices' | 'packaging_costs' | 'delivery_expenses'> = [];
        if (!allOrdersCovered) missingComponents.push('supplier_invoices');
        // Packaging material costs and actual courier expenses do not exist in schema yet
        missingComponents.push('packaging_costs', 'delivery_expenses');

        contributionProfit = {
          status: 'incomplete',
          confirmedAmount: null,
          goodsMarginOnly: allOrdersCovered ? roundMoney(goodsMarginSum) : null,
          coveredOrdersCount,
          totalDeliveredOrdersCount: currentDeliveredOrderIds.length,
          missingComponents,
        };
      }

      const varianceSum = allCashVarianceRows.reduce(
        (acc, row) => acc + (Number(row.collectedAmount || 0) - Number(row.expectedAmount || 0)),
        0,
      );
      const topVariance = allCashVarianceRows[0];
      const varianceNote = topVariance
        ? topVariance.notes || `عجز/فائض تحصيل (طلب ${topVariance.order?.orderNumber})`
        : null;

      financialSummary = {
        pendingCod: {
          amount: roundMoney(Number(pendingCodRes._sum.expectedAmount || 0)),
          shipmentCount: pendingCodRes._count.id,
          currency: 'EGP',
        },
        unresolvedVariance: {
          amount: roundMoney(varianceSum),
          caseCount: allCashVarianceRows.length,
          currency: 'EGP',
          details: varianceNote,
        },
      };
    }

    // 4. Order distribution by exact status
    const statusMap = new Map<string, number>();
    let totalAllOrders = 0;
    for (const sc of statusGroupCounts) {
      statusMap.set(sc.status, sc._count.id);
      totalAllOrders += sc._count.id;
    }

    const orderDistribution = {
      total: totalAllOrders,
      items: ALL_ORDER_STATUSES.map((status) => {
        const count = statusMap.get(status) ?? 0;
        return {
          status,
          count,
          percentage: roundPercent(count, totalAllOrders) ?? 0,
          href: `/admin/orders?status=${status}`,
        };
      }),
    };

    const openOrdersCount =
      (statusMap.get('placed') ?? 0) +
      (statusMap.get('confirmed') ?? 0) +
      (statusMap.get('packing') ?? 0) +
      (statusMap.get('shipped') ?? 0);

    // 5. Action required — exact total issues vs unique affected orders
    const uniqueOrderIds = new Set<string>();
    for (const r of allSupplyReqOrderIds) {
      const oid = r.requirement?.supplyRequest?.orderId;
      if (oid) uniqueOrderIds.add(oid);
    }
    for (const d of allPendingDecisionOrderIds) {
      if (d.orderId) uniqueOrderIds.add(d.orderId);
    }
    for (const s of allFailedShipmentOrderIds) {
      if (s.orderId) uniqueOrderIds.add(s.orderId);
    }
    for (const c of allCashVarianceRows) {
      if (c.orderId) uniqueOrderIds.add(c.orderId);
    }
    let standaloneCasesCount = 0;
    let criticalSupportCasesCount = 0;
    for (const cs of allOpenSupportCaseRows) {
      if (cs.orderId) {
        uniqueOrderIds.add(cs.orderId);
      } else {
        standaloneCasesCount += 1;
      }
      if (cs.priority === 'critical' || cs.priority === 'high') {
        criticalSupportCasesCount += 1;
      }
    }

    const totalIssues =
      allSupplyReqOrderIds.length +
      allPendingDecisionOrderIds.length +
      allFailedShipmentOrderIds.length +
      allCashVarianceRows.length +
      allOpenSupportCaseRows.length;

    const criticalCount =
      allSupplyReqOrderIds.length +
      allFailedShipmentOrderIds.length +
      allCashVarianceRows.length +
      criticalSupportCasesCount;

    const orderIdsToFetch = new Set<string>();
    for (const r of supplyRequirements) {
      if (r.requirement?.supplyRequest?.orderId) {
        orderIdsToFetch.add(r.requirement.supplyRequest.orderId);
      }
    }
    for (const s of failedShipments) {
      if (s.orderId) orderIdsToFetch.add(s.orderId);
    }
    for (const c of openSupportCasesList) {
      if (c.orderId) orderIdsToFetch.add(c.orderId);
    }

    const ordersMap = new Map<
      string,
      { id: string; orderNumber: string; customerName: string; area: string | null; governorate: string | null }
    >();
    if (orderIdsToFetch.size > 0) {
      const fetchedOrders = await this.prisma.order.findMany({
        where: { id: { in: Array.from(orderIdsToFetch) } },
        select: { id: true, orderNumber: true, customerName: true, area: true, governorate: true },
      });
      for (const o of fetchedOrders) ordersMap.set(o.id, o);
    }

    const candidates: ActionCandidate[] = [];

    for (const r of supplyRequirements) {
      const o = r.requirement?.supplyRequest?.orderId
        ? ordersMap.get(r.requirement.supplyRequest.orderId)
        : undefined;
      candidates.push({
        id: `supply-${r.id}`,
        orderId: o?.id,
        orderNumber: o?.orderNumber,
        type: 'supply_shortage',
        categoryLabel: 'نقص توريد',
        title: o?.orderNumber ? `طلب ${o.orderNumber}` : 'نقص توريد في المخزون',
        description: `${r.unresolvedQuantity} أصناف غير متوفرة من المورد • مطلوب قرار استبدال أو استيفاء`,
        severity: 'critical',
        createdAt: r.createdAt.toISOString(),
        actionLabel: 'اتخاذ القرار',
        actionHref: '/admin/exceptions',
      });
    }

    for (const d of customerDecisions) {
      candidates.push({
        id: `cust-${d.id}`,
        orderId: d.orderId,
        orderNumber: d.order?.orderNumber,
        type: 'customer_decision',
        categoryLabel: 'موافقة عميل',
        title: d.order?.orderNumber ? `طلب ${d.order.orderNumber}` : 'قرار عميل معلق',
        description: 'تأكيد بديل مقترح أو تعديل عناصر الطلب بانتظار العميل',
        severity: 'warning',
        createdAt: d.createdAt.toISOString(),
        actionLabel: 'مراجعة البديل',
        actionHref: '/admin/exceptions',
      });
    }

    for (const s of failedShipments) {
      const o = s.orderId ? ordersMap.get(s.orderId) : undefined;
      const reason = s.events[0]?.reasonCode
        ? `سبب: ${s.events[0].reasonCode}`
        : 'تعذر تسليم الشحنة للعميل';
      candidates.push({
        id: `shipment-${s.id}`,
        orderId: s.orderId,
        orderNumber: o?.orderNumber,
        type: 'failed_delivery',
        categoryLabel: 'تعثر توصيل',
        title: o?.orderNumber ? `طلب ${o.orderNumber}` : 'تعثر توصيل الشحنة',
        description: `${reason}${o?.area ? ` — ${o.area}` : ''}`,
        severity: 'critical',
        createdAt: s.updatedAt.toISOString(),
        actionLabel: 'معالجة التوصيل',
        actionHref: '/admin/delivery',
      });
    }

    for (const c of cashVariancesList) {
      const varAmount = Number(c.collectedAmount || 0) - Number(c.expectedAmount || 0);
      candidates.push({
        id: `cash-${c.id}`,
        orderId: c.orderId,
        orderNumber: c.order?.orderNumber,
        type: 'cash_variance',
        categoryLabel: 'فرق تحصيل',
        title: c.order?.orderNumber ? `طلب ${c.order.orderNumber}` : 'تسوية نقدية',
        description: `فرق تحصيل: ${varAmount > 0 ? `+${varAmount}` : varAmount} ${c.currency}${c.notes ? ` (${c.notes})` : ''}`,
        severity: 'warning',
        createdAt: c.updatedAt.toISOString(),
        actionLabel: 'مراجعة الفرق',
        actionHref: '/admin/cash',
      });
    }

    for (const cs of openSupportCasesList) {
      const o = cs.orderId ? ordersMap.get(cs.orderId) : undefined;
      candidates.push({
        id: `case-${cs.id}`,
        orderId: cs.orderId ?? undefined,
        orderNumber: o?.orderNumber,
        type: 'support_case',
        categoryLabel: 'حالة دعم',
        title: cs.title,
        description: `حالة دعم مفتوحة (${cs.priority})${o?.orderNumber ? ` للطلب ${o.orderNumber}` : ''}`,
        severity: cs.priority === 'critical' || cs.priority === 'high' ? 'critical' : 'info',
        createdAt: cs.createdAt.toISOString(),
        actionLabel: 'فتح التذكرة',
        actionHref: '/admin/exceptions',
      });
    }

    const topActionItems = selectTopUniqueActionItems(candidates, 3);

    // 6. Operational workflow stages (strictly inside /admin/* routes)
    const stageTotal =
      awaitingSourcingCount +
      sourcingReceivingCount +
      packingFulfillmentCount +
      outForDeliveryCount +
      exceptionsStalledCount;

    const calcPercent = (cnt: number) => roundPercent(cnt, stageTotal) ?? 0;

    const stageBoard = {
      totalActive: stageTotal,
      stages: [
        {
          id: 'awaiting_sourcing' as const,
          title: 'انتظار التوريد',
          count: awaitingSourcingCount,
          percentage: calcPercent(awaitingSourcingCount),
          subtitle: 'طلبات بانتظار التوفير',
          footerText: 'عرض الطلبات',
          href: '/admin/orders?status=placed',
        },
        {
          id: 'sourcing_receiving' as const,
          title: 'التوريد والاستلام',
          count: sourcingReceivingCount,
          percentage: calcPercent(sourcingReceivingCount),
          subtitle: 'أوامر شراء قيد الاستلام',
          footerText: 'متابعة التوريد',
          href: '/admin/sourcing',
        },
        {
          id: 'packing_fulfillment' as const,
          title: 'التجهيز بالمخزن',
          count: packingFulfillmentCount,
          percentage: calcPercent(packingFulfillmentCount),
          subtitle: 'قيد الفحص والتغليف',
          footerText: 'متابعة المخزن',
          href: '/admin/hub',
        },
        {
          id: 'out_for_delivery' as const,
          title: 'قيد التوصيل',
          count: outForDeliveryCount,
          percentage: calcPercent(outForDeliveryCount),
          subtitle: 'مع المناديب في الميدان',
          footerText: 'متابعة المشاوير',
          href: '/admin/delivery',
        },
        {
          id: 'exceptions_stalled' as const,
          title: 'استثناءات متوقفة',
          count: exceptionsStalledCount,
          percentage: calcPercent(exceptionsStalledCount),
          subtitle: 'شحنات متعثرة أو متوقفة',
          footerText: 'مركز الاستثناءات',
          href: '/admin/exceptions',
        },
      ],
    };

    return {
      days: daysCount,
      kpis: {
        netRealizedSales,
        contributionProfit,
        newOrders: {
          count: newOrdersCount,
          previousCount: prevNewOrdersCount,
          changePercent: calcPeriodChangePercent(newOrdersCount, prevNewOrdersCount),
          sparkline: buckets.map((b) => b.orders),
        },
        completedOrders: {
          count: completedOrdersCount,
          previousCount: prevCompletedOrdersCount,
          changePercent: calcPeriodChangePercent(completedOrdersCount, prevCompletedOrdersCount),
          completionRate,
          sparkline: buckets.map((b) => b.delivered),
        },
        openOrders: {
          count: openOrdersCount,
        },
      },
      salesChart: {
        days: daysCount,
        granularity,
        hasFinancialAccess,
        hasPreviousComparison,
        series: buckets,
      },
      orderDistribution,
      actionRequired: {
        totalIssues,
        affectedOrdersCount: uniqueOrderIds.size,
        standaloneCasesCount,
        criticalCount,
        items: topActionItems,
      },
      stageBoard,
      financialSummary,
      lastUpdated: now.toISOString(),
    };
  }
}
