import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationOutbox, Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';

export interface EnqueueNotificationDto {
  eventType: string;
  aggregateId?: string;
  aggregateType?: string;
  customerId?: string;
  payload: any;
  channelIntent?: string;
  templateId?: string;
  templateVersion?: number;
  deduplicationKey: string;
}

/** A real delivery provider for one channel. None is connected yet (no WhatsApp/email/push account). */
export interface NotificationProvider {
  channel: string;
  send(notification: NotificationOutbox): Promise<{ providerMessageId: string }>;
}

export interface OutboxRunResult { sent: number; held: number; failed: number }

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private readonly providers = new Map<string, NotificationProvider>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => this.processOutbox(), 10000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  registerProvider(provider: NotificationProvider) {
    this.providers.set(provider.channel, provider);
  }

  async enqueue(tx: any, dto: EnqueueNotificationDto) {
    // If inside a transaction, use tx. Otherwise use this.prisma
    const db = tx || this.prisma;

    // UPSERT to guarantee idempotency on deduplicationKey
    return db.notificationOutbox.upsert({
      where: { deduplicationKey: dto.deduplicationKey },
      update: {}, // Do nothing if it already exists
      create: {
        ...dto,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      }
    });
  }

  /**
   * Delivers due notifications through a connected provider. Without one, a notification is `held`
   * with the reason recorded — it is never marked `sent` from a log line (GLO-236).
   */
  async processOutbox(): Promise<OutboxRunResult> {
    const result: OutboxRunResult = { sent: 0, held: 0, failed: 0 };
    try {
      const now = new Date();
      const events = await this.prisma.notificationOutbox.findMany({
        where: {
          OR: [
            { status: 'pending' },
            { status: 'failed', attempts: { lt: 3 }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          ],
        },
        take: 50,
      });

      for (const event of events) {
        const provider = event.channelIntent ? this.providers.get(event.channelIntent) : undefined;
        if (!provider) {
          await this.prisma.notificationOutbox.updateMany({
            where: { id: event.id, status: event.status },
            data: { status: 'held', lastError: {
              code: event.channelIntent ? 'PROVIDER_NOT_CONNECTED' : 'NO_DELIVERY_CHANNEL', channel: event.channelIntent ?? null,
            } as Prisma.InputJsonValue },
          });
          result.held++;
          continue;
        }

        // Claim conditionally so concurrent workers never send the same notification twice.
        const claimed = await this.prisma.notificationOutbox.updateMany({
          where: { id: event.id, status: event.status },
          data: { status: 'processing', attempts: { increment: 1 } },
        });
        if (claimed.count !== 1) continue;

        try {
          await provider.send(event);
          await this.prisma.notificationOutbox.update({ where: { id: event.id }, data: { status: 'sent', sentAt: new Date() } });
          result.sent++;
        } catch (error) {
          const e = error as { message?: string; code?: string };
          this.logger.error(`Failed to send notification ${event.id}: ${e.message}`);
          const willRetry = event.attempts + 1 < event.maxAttempts;
          await this.prisma.notificationOutbox.update({
            where: { id: event.id },
            data: {
              status: 'failed',
              lastError: { message: e.message ?? String(error), code: e.code ?? null },
              nextAttemptAt: willRetry ? new Date(now.getTime() + 60000) : null, // 1 min backoff
            },
          });
          result.failed++;
        }
      }
    } catch (e) {
      this.logger.error('Error fetching outbox events', e);
    }
    return result;
  }
}
