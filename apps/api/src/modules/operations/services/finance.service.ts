import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async requestAccountingExport(startDate: Date, endDate: Date, actorId: string) {
    const job = await this.prisma.accountingExportJob.create({
      data: {
        startDate,
        endDate,
        actorId,
        status: 'pending'
      }
    });

    await this.processExport(job.id);
    return this.prisma.accountingExportJob.findUniqueOrThrow({ where: { id: job.id } });
  }

  async getExportJobs() {
    return this.prisma.accountingExportJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20
    });
  }

  /**
   * No accounting export destination (file storage/ERP) is connected yet, so the job fails with an
   * explicit reason instead of reporting a fabricated file URL as completed (GLO-236).
   */
  private async processExport(jobId: string) {
    await this.prisma.accountingExportJob.update({
      where: { id: jobId },
      data: { status: 'failed', error: 'ACCOUNTING_EXPORT_DESTINATION_NOT_CONFIGURED' },
    });
  }
}
