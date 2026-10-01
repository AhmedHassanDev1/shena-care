import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class DashboardService {
  private readonly prisma = new PrismaClient();

  async getKpis() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [ordersToday, totalOrders, openSupportCases, unconfirmedPOs, pendingIngestions] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: today } } }),
      this.prisma.order.count(),
      this.prisma.supportCase.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      this.prisma.supplierPurchaseOrder.count({ where: { status: 'sent' } }),
      this.prisma.ingestionJob.count({ where: { status: 'pending' } }),
    ]);

    const revenueResult = await this.prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { status: { not: 'cancelled' } }
    });

    const revenueTodayResult = await this.prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { status: { not: 'cancelled' }, createdAt: { gte: today } }
    });

    return {
      revenueToday: Number(revenueTodayResult._sum.totalAmount || 0),
      totalRevenue: Number(revenueResult._sum.totalAmount || 0),
      ordersToday,
      totalOrders,
      averageOrderValue: totalOrders > 0 ? Number(revenueResult._sum.totalAmount || 0) / totalOrders : 0,
      attentionCenter: {
        openSupportCases,
        unconfirmedPOs,
        pendingIngestions,
      }
    };
  }
}
