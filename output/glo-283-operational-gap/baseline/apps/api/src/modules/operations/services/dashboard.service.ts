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
}
