import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PurchaseBatchService } from './purchase-batch.service';

const DEFAULT_TICK_MS = 60_000;

/**
 * Cuts the scheduled purchase batches. Each tick only asks "is the latest cutoff's batch there?", which is idempotent in the database
 * (slot key + advisory lock), so several API instances, a restart in the middle of a cutoff or a missed window all end with exactly one
 * batch per cutoff. A missed cutoff is never replayed one by one: the next tick cuts once for the latest slot and carries all demand.
 * Disabled in tests (they call the service directly) and with PURCHASE_BATCH_SCHEDULER=off.
 */
@Injectable()
export class PurchaseBatchScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PurchaseBatchScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly batches: PurchaseBatchService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.PURCHASE_BATCH_SCHEDULER === 'off') return;
    const every = Number(process.env.PURCHASE_BATCH_TICK_MS);
    this.timer = setInterval(() => void this.tick(), Number.isFinite(every) && every >= 1000 ? every : DEFAULT_TICK_MS);
    this.timer.unref();
    void this.tick(); // restart recovery: do not wait a full interval to notice a missed cutoff
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.batches.runDue();
    } catch (error) {
      this.logger.error(`Purchase batch tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
