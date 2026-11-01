/**
 * Operator replay for durable domain events (GLO-236).
 *
 *   npm run events:dispatch            # deliver everything that is due
 *   npm run events:dispatch -- --requeue   # first make failed/dead rows due again, then deliver
 *
 * Uses DATABASE_URL like the API. Consumers are idempotent, so running this while the API is up
 * is safe: rows are claimed with SKIP LOCKED and a lease.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DomainEventsService } from '../src/platform/events/domain-events.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const events = app.get(DomainEventsService);
    if (process.argv.includes('--requeue')) console.log('requeued', await events.requeue({}));
    const total = { delivered: 0, failed: 0, dead: 0 };
    for (;;) {
      const pass = await events.dispatchPending({ limit: 200 });
      total.delivered += pass.delivered; total.failed += pass.failed; total.dead += pass.dead;
      if (pass.delivered + pass.failed + pass.dead === 0) break;
    }
    console.log('dispatch result', total);
  } finally {
    await app.close();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
