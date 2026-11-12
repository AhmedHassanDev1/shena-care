import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { IntakeSource } from '@prisma/client';
import { IntakeStoreService } from '../../../../modules/intake/public';
import { AdminIntakeService } from './admin-intake.service';
import { SupplierIntakeService } from './supplier-intake.service';

const POLL_MS = 30_000;

/**
 * Runs intake work in the background of the API process: Admin rows one at a time (they read the web, so they are kept gentle on rate limits and cost is measured
 * per row), retries when their time comes, and resumes supplier jobs interrupted by a restart. Off in tests unless INTAKE_WORKER=on; INTAKE_WORKER=off disables it.
 */
@Injectable()
export class IntakeRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IntakeRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<number> | null = null;

  constructor(private readonly store: IntakeStoreService, private readonly admin: AdminIntakeService, private readonly supplier: SupplierIntakeService) {}

  private enabled() {
    const flag = process.env.INTAKE_WORKER;
    return flag !== 'off' && (process.env.NODE_ENV !== 'test' || flag === 'on');
  }

  async onApplicationBootstrap() {
    if (!this.enabled()) return;
    for (const job of await this.store.jobsWithPendingRows(IntakeSource.SUPPLIER)) this.supplier.start(job.id);
    this.timer = setInterval(() => this.kick(), POLL_MS);
    this.timer.unref?.();
    this.kick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Starts draining due Admin rows unless a drain is already running. */
  kick() {
    if (!this.enabled() || this.draining) return;
    this.draining = this.drain().finally(() => { this.draining = null; });
    this.draining.catch(error => this.logger.error(`Admin intake drain failed: ${error instanceof Error ? error.stack : error}`));
  }

  /** Processes due Admin rows until none is left (optionally one job only). Returns how many rows were worked. Used directly by tests and operator scripts. */
  async drain(jobId?: string, limit = 1000): Promise<number> {
    let worked = 0;
    while (worked < limit) {
      const [row] = await this.store.leaseAdminRows(1, jobId);
      if (!row) break;
      await this.admin.processRow(row);
      worked++;
    }
    return worked;
  }
}
