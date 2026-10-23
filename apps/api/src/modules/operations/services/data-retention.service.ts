import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';

@Injectable()
export class DataRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataRetentionService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Test processes must never run global retention deletes against whatever database they point at.
    if (process.env.NODE_ENV === 'test') return;
    // Run cleanup once a day, and once shortly after startup.
    this.timers = [
      setInterval(() => this.runCleanup(), 24 * 60 * 60 * 1000),
      setTimeout(() => this.runCleanup(), 10000),
    ];
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
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
      const deletedEvents = await this.prisma.notificationOutbox.deleteMany({
        where: {
          status: 'sent',
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
