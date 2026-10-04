import { Injectable } from '@nestjs/common';
import { PrismaClient, AccountingExportStatus } from '@prisma/client';
import { OutboxService } from './outbox.service';

@Injectable()
export class FinanceService {
  private readonly prisma = new PrismaClient();
  constructor(private readonly outbox: OutboxService) {}

  async requestAccountingExport(startDate: Date, endDate: Date, actorId: string) {
    const job = await this.prisma.accountingExportJob.create({
      data: {
        startDate,
        endDate,
        actorId,
        status: 'pending'
      }
    });

    // In a real app, this would trigger an async worker via queue
    // For MVP, we will mock the background generation by directly completing it here async
    this.processExport(job.id, startDate, endDate).catch(console.error);

    return job;
  }

  async getExportJobs() {
    return this.prisma.accountingExportJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20
    });
  }

  private async processExport(jobId: string, startDate: Date, endDate: Date) {
    try {
      await this.prisma.accountingExportJob.update({
        where: { id: jobId },
        data: { status: 'processing' }
      });

      // Mock gathering data: Orders, Refunds, Supplier Payables
      const orders = await this.prisma.order.count({
        where: { createdAt: { gte: startDate, lte: endDate } }
      });
      const refunds = await this.prisma.refundTransaction.count({
        where: { createdAt: { gte: startDate, lte: endDate } }
      });
      const payables = await this.prisma.supplierPayable.count({
        where: { createdAt: { gte: startDate, lte: endDate } }
      });

      // Mock generating a CSV file
      const mockFileUrl = `https://storage.shenacare.com/exports/accounting_${jobId}.csv`;

      // Wait a moment to mock long process
      await new Promise(resolve => setTimeout(resolve, 2000));

      await this.prisma.accountingExportJob.update({
        where: { id: jobId },
        data: { 
          status: 'completed',
          fileUrl: mockFileUrl
        }
      });

      await this.outbox.enqueue(null, {
        eventType: 'ACCOUNTING_EXPORT_READY',
        aggregateId: jobId,
        aggregateType: 'AccountingExportJob',
        payload: {
          jobId,
          fileUrl: mockFileUrl,
          summary: { orders, refunds, payables }
        },
        deduplicationKey: `finance.export:${jobId}`,
      });

    } catch (e: any) {
      await this.prisma.accountingExportJob.update({
        where: { id: jobId },
        data: { 
          status: 'failed',
          error: e.message
        }
      });
    }
  }
}
