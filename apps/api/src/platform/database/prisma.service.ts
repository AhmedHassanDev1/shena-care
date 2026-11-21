import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // In a persistent NestJS server, prefer DIRECT_URL (port 5432) when available.
    // Transaction pooler (port 6543 with pgbouncer=true) forces DEALLOCATE ALL on every query,
    // causing 4 round trips per query. Direct connection allows Prisma's internal connection pool
    // and prepared statements, cutting latency by 4x-5x over cross-region networks.
    const url = process.env.PRISMA_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
    super({
      datasources: url ? { db: { url } } : undefined,
      log:
        process.env.PRISMA_LOG_QUERIES === 'true'
          ? ['query', 'error', 'warn']
          : ['error', 'warn'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
