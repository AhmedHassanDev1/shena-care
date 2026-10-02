import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class OutboxService implements OnModuleInit {
  private readonly logger = new Logger(OutboxService.name);
  private readonly prisma = new PrismaClient();

  onModuleInit() {
    // Basic polling mock outbox processor
    setInterval(() => this.processOutbox(), 10000);
  }

  async enqueue(type: string, payload: any) {
    return this.prisma.outboxEvent.create({
      data: {
        type,
        payload,
      }
    });
  }

  async processOutbox() {
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: { status: 'pending' },
        take: 50,
      });

      for (const event of events) {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'processing', attempts: event.attempts + 1 }
        });

        try {
          // Abstract provider dispatch based on type
          this.logger.log(`Processing outbox event ${event.id} of type ${event.type}`);
          
          if (event.type === 'ORDER_SUBMITTED') {
            const payload = event.payload as any;
            this.logger.log(`[Mock Email/SMS] Order submitted for order ID: ${payload?.orderId || 'unknown'}`);
          } else if (event.type === 'SUPPORT_CASE_CREATED') {
            const payload = event.payload as any;
            this.logger.log(`[Mock Admin Alert] New support case created with ID: ${payload?.caseId || 'unknown'}`);
          }

          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'completed' }
          });
        } catch (e: any) {
          this.logger.error(`Failed to process event ${event.id}: ${e.message}`);
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'failed', error: e.message }
          });
        }
      }
    } catch (e) {
      this.logger.error('Error fetching outbox events', e);
    }
  }
}
