import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class DataRetentionService implements OnModuleInit {
  private readonly logger = new Logger(DataRetentionService.name);
  private readonly prisma = new PrismaClient();

  onModuleInit() {
    // Run cleanup once a day
    setInterval(() => this.runCleanup(), 24 * 60 * 60 * 1000);
    // Also run immediately on startup after a delay
    setTimeout(() => this.runCleanup(), 10000);
  }

  async runCleanup() {
    this.logger.log('Running data retention cleanup...');
    try {
      // 1. Delete expired sessions
      const deletedSessions = await this.prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } }
      });
      if (deletedSessions.count > 0) {
        this.logger.log(`Cleaned up ${deletedSessions.count} expired sessions.`);
      }

      // 2. Delete completed outbox events older than 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const deletedEvents = await this.prisma.outboxEvent.deleteMany({
        where: {
          status: 'completed',
          createdAt: { lt: sevenDaysAgo }
        }
      });
      if (deletedEvents.count > 0) {
        this.logger.log(`Cleaned up ${deletedEvents.count} old outbox events.`);
      }

      // Note: Logs and metrics should be managed externally via cloud provider lifecycle policies.
      // Uploads and AI data retention policies will be applied here in future increments once volume justifies it.
    } catch (e) {
      this.logger.error('Failed to run data retention cleanup', e);
    }
  }
}
