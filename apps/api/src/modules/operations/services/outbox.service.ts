import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

@Injectable()
export class OutboxService implements OnModuleInit {
  private readonly logger = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.processOutbox(), 10000);
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

  async processOutbox() {
    try {
      const now = new Date();
      // Find pending or failed-but-retryable records
      const events = await this.prisma.notificationOutbox.findMany({
        where: {
          OR: [
            { status: 'pending' },
            { 
              status: 'failed', 
              attempts: { lt: 3 },
              OR: [
                { nextAttemptAt: null },
                { nextAttemptAt: { lte: now } }
              ]
            }
          ]
        },
        take: 50,
      });

      for (const event of events) {
        await this.prisma.notificationOutbox.update({
          where: { id: event.id },
          data: { status: 'processing', attempts: event.attempts + 1 }
        });

        try {
          this.logger.log(`Dispatching notification event ${event.id} of type ${event.eventType}`);
          
          // Abstract provider dispatch based on type (Mocking provider here)
          if (event.channelIntent === 'whatsapp') {
            this.logger.log(`[WhatsApp Provider] Sending ${event.templateId} to ${event.aggregateId}`);
          } else if (event.channelIntent === 'email') {
            this.logger.log(`[Email Provider] Sending ${event.templateId} to ${event.aggregateId}`);
          }
          // Simulate some specific events if needed
          if (event.eventType === 'order.placed') {
             this.logger.log(`[Notification] Order placed: ${event.aggregateId}`);
          }

          await this.prisma.notificationOutbox.update({
            where: { id: event.id },
            data: { status: 'sent', sentAt: new Date() }
          });
        } catch (e: any) {
          this.logger.error(`Failed to process event ${event.id}: ${e.message}`);
          
          const maxAttempts = event.maxAttempts;
          const currentAttempts = event.attempts + 1;
          const willRetry = currentAttempts < maxAttempts;
          
          await this.prisma.notificationOutbox.update({
            where: { id: event.id },
            data: { 
              status: 'failed', 
              lastError: { message: e.message, code: e.code },
              nextAttemptAt: willRetry ? new Date(now.getTime() + 60000) : null // 1 min backoff
            }
          });
        }
      }
    } catch (e) {
      this.logger.error('Error fetching outbox events', e);
    }
  }
}
