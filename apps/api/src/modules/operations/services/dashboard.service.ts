import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';

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

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getKpis(user?: { roles?: string[] }) {
    const cairoMidnightUtc = getCairoMidnightUtc();

    // Prepare 24 hourly buckets for Cairo today
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

    // Server-side financial RBAC: only ADMIN / Owner roles can access financial numbers
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

  async getOverview(user?: { roles?: string[] }, days = 7) {
    const daysCount = days === 30 ? 30 : 7;
    const now = new Date();
    const cairoMidnightUtc = getCairoMidnightUtc(now);
    const windowStartUtc = new Date(cairoMidnightUtc.getTime() - (daysCount - 1) * 24 * 3600 * 1000);

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

    const series: Array<{ date: string; dayName: string; shortDate: string; created: number; delivered: number }> = [];
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(cairoMidnightUtc.getTime() - i * 24 * 3600 * 1000);
      series.push({
        date: dayDateFormatter.format(d),
        dayName: dayNameFormatter.format(d),
        shortDate: shortDateFormatter.format(d),
        created: 0,
        delivered: 0,
      });
    }
    const seriesIndexMap = new Map(series.map((s, idx) => [s.date, idx]));

    const [
      ordersInWindow,
      deliveredEventsInWindow,
      openOrdersCount,
      terminalTodayCount,
      supplyRequirements,
      customerDecisions,
      failedShipments,
      cashVariancesList,
      openSupportCasesList,
      totalSupplyReq,
      totalCustomerDec,
      totalFailedShipments,
      totalCashVariances,
      totalOpenCases,
      awaitingSourcingCount,
      sourcingReceivingCount,
      packingFulfillmentCount,
      outForDeliveryCount,
      exceptionsStalledCount,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: windowStartUtc } },
        select: { createdAt: true },
      }),
      this.prisma.orderStatusEvent.findMany({
        where: { status: 'delivered', createdAt: { gte: windowStartUtc } },
        select: { createdAt: true },
      }),
      this.prisma.order.count({
        where: { status: { in: ['placed', 'confirmed', 'packing', 'shipped'] } },
      }),
      this.prisma.orderStatusEvent.count({
        where: { status: { in: ['delivered', 'returned', 'cancelled'] }, createdAt: { gte: cairoMidnightUtc } },
      }),
      this.prisma.availabilityActionRequirement.findMany({
        where: { requirement: { releasedAt: null } },
        include: { requirement: { include: { supplyRequest: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.availabilityDecision.findMany({
        where: { status: 'pending' },
        include: { order: { select: { id: true, orderNumber: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.shipment.findMany({
        where: { status: 'failed' },
        orderBy: { updatedAt: 'desc' },
        include: { events: { where: { type: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 1 } },
        take: 5,
      }),
      this.prisma.paymentCollection.findMany({
        where: { status: { in: ['short', 'over'] } },
        include: { order: { select: { id: true, orderNumber: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      this.prisma.supportCase.findMany({
        where: { status: { in: ['open', 'in_progress'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.availabilityActionRequirement.count({ where: { requirement: { releasedAt: null } } }),
      this.prisma.availabilityDecision.count({ where: { status: 'pending' } }),
      this.prisma.shipment.count({ where: { status: 'failed' } }),
      this.prisma.paymentCollection.count({ where: { status: { in: ['short', 'over'] } } }),
      this.prisma.supportCase.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      this.prisma.order.count({ where: { status: 'placed' } }),
      this.prisma.supplierPurchaseOrder.count({ where: { status: { in: ['ready', 'received_at_hub'] } } }),
      this.prisma.order.count({ where: { status: { in: ['confirmed', 'packing'] } } }),
      this.prisma.order.count({ where: { status: 'shipped' } }),
      this.prisma.shipment.count({ where: { status: 'failed' } }),
    ]);

    for (const o of ordersInWindow) {
      const k = dayDateFormatter.format(o.createdAt);
      const idx = seriesIndexMap.get(k);
      if (idx !== undefined) series[idx].created += 1;
    }

    for (const d of deliveredEventsInWindow) {
      const k = dayDateFormatter.format(d.createdAt);
      const idx = seriesIndexMap.get(k);
      if (idx !== undefined) series[idx].delivered += 1;
    }

    const ordersTodayCount = series[series.length - 1]?.created ?? 0;
    const ordersYesterdayCount = series.length >= 2 ? series[series.length - 2].created : 0;
    let ordersChangePercent: number | null = null;
    if (ordersYesterdayCount > 0) {
      ordersChangePercent = Math.round(((ordersTodayCount - ordersYesterdayCount) / ordersYesterdayCount) * 1000) / 10;
    } else if (ordersTodayCount > 0) {
      ordersChangePercent = 100;
    }
    const ordersTodaySparkline = series.slice(-7).map((s) => s.created);

    const deliveredTodayCount = series[series.length - 1]?.delivered ?? 0;
    const deliveryAccuracyRate =
      terminalTodayCount > 0
        ? Math.round((deliveredTodayCount / terminalTodayCount) * 1000) / 10
        : deliveredTodayCount > 0
        ? 100
        : null;
    const deliveredSparkline = series.slice(-7).map((s) => s.delivered);

    const totalIntervention =
      totalSupplyReq + totalCustomerDec + totalFailedShipments + totalCashVariances + totalOpenCases;
    const criticalIntervention = totalSupplyReq + totalFailedShipments + (totalCashVariances > 0 ? totalCashVariances : 0);

    const orderIdsToFetch = new Set<string>();
    for (const r of supplyRequirements) {
      if (r.requirement?.supplyRequest?.orderId) orderIdsToFetch.add(r.requirement.supplyRequest.orderId);
    }
    for (const s of failedShipments) {
      if (s.orderId) orderIdsToFetch.add(s.orderId);
    }
    for (const c of openSupportCasesList) {
      if (c.orderId) orderIdsToFetch.add(c.orderId);
    }

    const ordersMap = new Map<string, { id: string; orderNumber: string; customerName: string; area: string | null; governorate: string | null }>();
    if (orderIdsToFetch.size > 0) {
      const fetchedOrders = await this.prisma.order.findMany({
        where: { id: { in: Array.from(orderIdsToFetch) } },
        select: { id: true, orderNumber: true, customerName: true, area: true, governorate: true },
      });
      for (const o of fetchedOrders) ordersMap.set(o.id, o);
    }

    const actionItems: Array<{
      id: string;
      orderId?: string;
      orderNumber?: string;
      type: 'supply_shortage' | 'customer_decision' | 'failed_delivery' | 'cash_variance' | 'support_case';
      categoryLabel: string;
      title: string;
      description: string;
      severity: 'critical' | 'warning' | 'info';
      createdAt: string;
      actionLabel: string;
      actionHref: string;
    }> = [];

    for (const r of supplyRequirements) {
      const o = r.requirement?.supplyRequest?.orderId ? ordersMap.get(r.requirement.supplyRequest.orderId) : undefined;
      actionItems.push({
        id: `supply-${r.id}`,
        orderId: o?.id,
        orderNumber: o?.orderNumber,
        type: 'supply_shortage',
        categoryLabel: 'نقص توريد',
        title: o?.orderNumber ? `طلب ${o.orderNumber}` : 'نقص توريد في المخزون',
        description: `${r.unresolvedQuantity} أصناف مستنفدة من المورد • مطلوب قرار استبدال أو استيفاء`,
        severity: 'critical',
        createdAt: r.createdAt.toISOString(),
        actionLabel: 'اتخاذ القرار',
        actionHref: '/admin/exceptions',
      });
    }

    for (const d of customerDecisions) {
      actionItems.push({
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
      const reason = s.events[0]?.reasonCode ? `سبب: ${s.events[0].reasonCode}` : 'تعذر تسليم الشحنة للعميل';
      actionItems.push({
        id: `shipment-${s.id}`,
        orderId: s.orderId,
        orderNumber: o?.orderNumber,
        type: 'failed_delivery',
        categoryLabel: 'تعثر توصيل',
        title: o?.orderNumber ? `طلب ${o.orderNumber}` : 'تعثر توصيل الشحنة',
        description: `${reason}${o?.area ? ` — ${o.area}` : ''}`,
        severity: 'critical',
        createdAt: s.updatedAt.toISOString(),
        actionLabel: 'إعادة الجدولة',
        actionHref: '/admin/delivery',
      });
    }

    for (const c of cashVariancesList) {
      const varAmount = Number(c.collectedAmount || 0) - Number(c.expectedAmount || 0);
      actionItems.push({
        id: `cash-${c.id}`,
        orderId: c.orderId,
        orderNumber: c.order?.orderNumber,
        type: 'cash_variance',
        categoryLabel: 'فرق نقدي',
        title: c.order?.orderNumber ? `طلب ${c.order.orderNumber}` : 'تسوية نقدية',
        description: `فرق في التحصيل: ${varAmount > 0 ? `+${varAmount}` : varAmount} ${c.currency} ${c.notes ? `(${c.notes})` : ''}`,
        severity: 'warning',
        createdAt: c.updatedAt.toISOString(),
        actionLabel: 'مراجعة الفرق',
        actionHref: '/admin/cash',
      });
    }

    for (const cs of openSupportCasesList) {
      const o = cs.orderId ? ordersMap.get(cs.orderId) : undefined;
      actionItems.push({
        id: `case-${cs.id}`,
        orderId: cs.orderId ?? undefined,
        orderNumber: o?.orderNumber,
        type: 'support_case',
        categoryLabel: 'حالة دعم',
        title: cs.title,
        description: `حالة دعم مفتوحة بأولوية ${cs.priority}${o?.orderNumber ? ` للطلب ${o.orderNumber}` : ''}`,
        severity: cs.priority === 'critical' || cs.priority === 'high' ? 'critical' : 'info',
        createdAt: cs.createdAt.toISOString(),
        actionLabel: 'فتح التذكرة',
        actionHref: '/admin/exceptions',
      });
    }

    const severityWeight = { critical: 3, warning: 2, info: 1 };
    actionItems.sort((a, b) => {
      const diff = severityWeight[b.severity] - severityWeight[a.severity];
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    const topActionItems = actionItems.slice(0, 3);

    const stageTotal =
      awaitingSourcingCount +
      sourcingReceivingCount +
      packingFulfillmentCount +
      outForDeliveryCount +
      exceptionsStalledCount;

    const calcPercent = (cnt: number) => (stageTotal > 0 ? Math.round((cnt / stageTotal) * 1000) / 10 : 0);

    const stageBoard = {
      totalActive: stageTotal,
      stages: [
        {
          id: 'awaiting_sourcing' as const,
          title: 'انتظار التوريد',
          count: awaitingSourcingCount,
          percentage: calcPercent(awaitingSourcingCount),
          subtitle: 'أوامر شراء معلقة',
          footerText: 'أوامر توريد معلقة',
          href: '/admin/sourcing',
        },
        {
          id: 'sourcing_receiving' as const,
          title: 'التوريد والاستلام',
          count: sourcingReceivingCount,
          percentage: calcPercent(sourcingReceivingCount),
          subtitle: 'شحنات قيد الفحص',
          footerText: 'بانتظار الفحص',
          href: '/hub/receive',
        },
        {
          id: 'packing_fulfillment' as const,
          title: 'التجهيز والتغليف',
          count: packingFulfillmentCount,
          percentage: calcPercent(packingFulfillmentCount),
          subtitle: 'مركز الفرز الرئيسي',
          footerText: 'قيد التجهيز',
          href: '/hub/prepare',
        },
        {
          id: 'out_for_delivery' as const,
          title: 'مع المندوب للتوصيل',
          count: outForDeliveryCount,
          percentage: calcPercent(outForDeliveryCount),
          subtitle: 'مع المناديب في الميدان',
          footerText: 'على الطريق',
          href: '/admin/delivery',
        },
        {
          id: 'exceptions_stalled' as const,
          title: 'استثناء معطل',
          count: exceptionsStalledCount,
          percentage: calcPercent(exceptionsStalledCount),
          subtitle: 'يتطلب تدخلاً عاجلاً',
          footerText: 'فوري',
          href: '/admin/exceptions',
        },
      ],
    };

    const hasFinancialAccess = Boolean(user?.roles?.includes('ADMIN'));

    let financialSummary = {
      pendingCod: { amount: 0, shipmentCount: 0, currency: 'EGP' },
      collectedToday: { amount: 0, transactionCount: 0, currency: 'EGP' },
      unresolvedVariance: { amount: 0, caseCount: 0, currency: 'EGP', details: null as string | null },
      totalReceivedToday: { amount: 0, transactionCount: 0, currency: 'EGP' },
    };

    if (hasFinancialAccess) {
      const [pendingCodRes, collectedTodayRes, variancesRes] = await Promise.all([
        this.prisma.paymentCollection.aggregate({
          where: { status: 'expected' },
          _sum: { expectedAmount: true },
          _count: { id: true },
        }),
        this.prisma.paymentCollection.aggregate({
          where: { status: { in: ['collected', 'settled'] }, updatedAt: { gte: cairoMidnightUtc } },
          _sum: { collectedAmount: true },
          _count: { id: true },
        }),
        this.prisma.paymentCollection.findMany({
          where: { status: { in: ['short', 'over'] } },
          select: { expectedAmount: true, collectedAmount: true, notes: true, order: { select: { orderNumber: true } } },
          take: 5,
        }),
      ]);

      const varianceSum = variancesRes.reduce((acc, row) => {
        return acc + (Number(row.collectedAmount || 0) - Number(row.expectedAmount || 0));
      }, 0);

      const varianceNote = variancesRes[0]
        ? variancesRes[0].notes || `عجز/فائض تسليم (طلب ${variancesRes[0].order?.orderNumber})`
        : null;

      financialSummary = {
        pendingCod: {
          amount: Number(pendingCodRes._sum.expectedAmount || 0),
          shipmentCount: pendingCodRes._count.id,
          currency: 'EGP',
        },
        collectedToday: {
          amount: Number(collectedTodayRes._sum.collectedAmount || 0),
          transactionCount: collectedTodayRes._count.id,
          currency: 'EGP',
        },
        unresolvedVariance: {
          amount: varianceSum,
          caseCount: variancesRes.length,
          currency: 'EGP',
          details: varianceNote,
        },
        totalReceivedToday: {
          amount: Number(collectedTodayRes._sum.collectedAmount || 0),
          transactionCount: collectedTodayRes._count.id,
          currency: 'EGP',
        },
      };
    }

    return {
      kpis: {
        ordersToday: {
          count: ordersTodayCount,
          yesterdayCount: ordersYesterdayCount,
          changePercent: ordersChangePercent,
          sparkline: ordersTodaySparkline,
        },
        openOrders: {
          count: openOrdersCount,
          status: 'مستقر',
          sparkline: [openOrdersCount, openOrdersCount, openOrdersCount, openOrdersCount, openOrdersCount, openOrdersCount, openOrdersCount],
        },
        deliveredToday: {
          count: deliveredTodayCount,
          deliveredRate: deliveryAccuracyRate,
          sparkline: deliveredSparkline,
        },
        needsIntervention: {
          count: totalIntervention,
          criticalCount: criticalIntervention,
          sparkline: [0, 0, 0, 0, 0, 0, totalIntervention],
        },
      },
      activityChart: {
        days: daysCount,
        series,
      },
      actionRequired: {
        total: totalIntervention,
        criticalCount: criticalIntervention,
        items: topActionItems,
      },
      stageBoard,
      financialSummary,
      lastUpdated: now.toISOString(),
    };
  }

}
