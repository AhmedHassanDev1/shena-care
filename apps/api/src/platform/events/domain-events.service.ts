import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DomainEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * Static subscriptions: which consumers must receive an event. Rows for every consumer are written
 * in the producer's transaction, so an event can never be lost because a listener was not loaded,
 * threw, or the process stopped after commit (GLO-236 D-4).
 */
export const DOMAIN_EVENT_SUBSCRIPTIONS: Record<string, string[]> = {
  'order.placed': ['sourcing.supply-plan'],
};

export interface DomainEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/** An idempotent consumer: called at least once per row; a thrown error schedules a retry. */
export type DomainEventHandler = (event: DomainEvent) => Promise<void>;

export interface DispatchResult {
  delivered: number;
  failed: number;
  dead: number;
}

const LOCK_MS = 60_000;
const backoffMs = (attempt: number) => Math.min(2 ** attempt * 1000, 15 * 60_000);

@Injectable()
export class DomainEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventsService.name);
  private readonly handlers = new Map<string, DomainEventHandler>();
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Polls for pending/retryable rows. Off in tests unless DOMAIN_EVENTS_POLL_MS is set explicitly. */
  onModuleInit() {
    const configured = process.env.DOMAIN_EVENTS_POLL_MS;
    const interval = configured !== undefined ? Number(configured) : process.env.NODE_ENV === 'test' ? 0 : 5000;
    if (interval > 0) {
      this.timer = setInterval(() => {
        if (this.polling) return;
        this.polling = true;
        this.dispatchPending().catch(error => this.logger.error(`Domain event poll failed: ${error.message}`))
          .finally(() => { this.polling = false; });
      }, interval);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  registerHandler(consumer: string, handler: DomainEventHandler) {
    this.handlers.set(consumer, handler);
  }

  /** Records the event for each subscribed consumer inside the caller's transaction (idempotent). */
  async record(tx: Tx, input: DomainEventInput): Promise<void> {
    const consumers = DOMAIN_EVENT_SUBSCRIPTIONS[input.eventType] ?? [];
    if (!consumers.length) throw new Error(`No consumers subscribed to ${input.eventType}`);
    await tx.domainEvent.createMany({
      data: consumers.map(consumer => ({
        eventType: input.eventType, aggregateType: input.aggregateType, aggregateId: input.aggregateId,
        consumer, payload: input.payload as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Delivers due rows. Rows are claimed with SKIP LOCKED and a lease, so concurrent dispatchers
   * never run the same row at once and a crashed dispatcher's lease expires and is retried.
   */
  async dispatchPending(options: { aggregateId?: string; limit?: number } = {}): Promise<DispatchResult> {
    const limit = options.limit ?? 50;
    const aggregateFilter = options.aggregateId
      ? Prisma.sql`AND aggregate_id = ${options.aggregateId}::uuid` : Prisma.empty;
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "operations"."domain_events" SET status = 'processing', attempts = attempts + 1,
        locked_until = NOW() + ${`${LOCK_MS} milliseconds`}::interval, updated_at = NOW()
      WHERE id IN (
        SELECT id FROM "operations"."domain_events"
        WHERE ((status IN ('pending', 'failed') AND next_attempt_at <= NOW())
           OR (status = 'processing' AND locked_until < NOW()))
          ${aggregateFilter}
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;

    const result: DispatchResult = { delivered: 0, failed: 0, dead: 0 };
    for (const { id } of claimed) {
      const event = await this.prisma.domainEvent.findUniqueOrThrow({ where: { id } });
      const handler = this.handlers.get(event.consumer);
      try {
        if (!handler) throw new Error(`No handler registered for consumer ${event.consumer}`);
        await handler(event);
        await this.prisma.domainEvent.update({ where: { id }, data: {
          status: 'delivered', deliveredAt: new Date(), lockedUntil: null, lastError: null,
        } });
        result.delivered++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const dead = event.attempts >= event.maxAttempts;
        await this.prisma.domainEvent.update({ where: { id }, data: {
          status: dead ? 'dead' : 'failed', lockedUntil: null, lastError: message.slice(0, 2000),
          nextAttemptAt: new Date(Date.now() + backoffMs(event.attempts)),
        } });
        this.logger.error(`Domain event ${event.eventType}/${event.consumer} for ${event.aggregateId} failed (attempt ${event.attempts}): ${message}`);
        if (dead) result.dead++; else result.failed++;
      }
    }
    return result;
  }

  /** Best-effort immediate delivery after the producer committed; the durable row covers failures. */
  dispatchSoon(aggregateId: string) {
    setImmediate(() => {
      this.dispatchPending({ aggregateId }).catch(error =>
        this.logger.error(`Immediate dispatch for ${aggregateId} failed: ${error.message}`));
    });
  }

  /** Operator replay of failed or dead rows: makes them due again without resetting their history. */
  async requeue(filter: { id?: string; status?: 'failed' | 'dead' }): Promise<number> {
    const statuses = filter.status ? [filter.status] : ['failed', 'dead'];
    // Dead rows get a fresh attempt budget on explicit operator replay; attempts history is kept.
    return this.prisma.$executeRaw`
      UPDATE "operations"."domain_events"
      SET status = 'pending', next_attempt_at = NOW(), max_attempts = GREATEST(max_attempts, attempts + 8), updated_at = NOW()
      WHERE status::text IN (${Prisma.join(statuses)}) ${filter.id ? Prisma.sql`AND id = ${filter.id}::uuid` : Prisma.empty}`;
  }

  list(filter: { status?: DomainEvent['status']; aggregateId?: string; take?: number; skip?: number }) {
    return this.prisma.domainEvent.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.aggregateId ? { aggregateId: filter.aggregateId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.take ?? 50, 200),
      skip: filter.skip ?? 0,
    });
  }
}
