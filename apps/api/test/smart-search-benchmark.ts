/** Retrieval-only scaling probe; all synthetic rows are scoped and removed in finally. */
import { assertLocalTestDatabase } from '../scripts/local-test-database.cjs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/platform/database/prisma.service';
import { PostgresSearchProvider } from '../src/modules/catalog/search/postgres-search.provider';

assertLocalTestDatabase(process.env);
async function main() {
  const db = new PrismaClient(), run = randomUUID();
  const provider = new PostgresSearchProvider(db as unknown as PrismaService);
  const brand = await db.brand.create({ data: { name: `Scale ${run}`, slug: `scale-${run}` } });
  const productIds: string[] = [];
  try {
    const measurements: unknown[] = [];
    for (const size of [1000, 5000]) {
      const products = Array.from({ length: size - productIds.length }, (_, index) => ({
        id: randomUUID(), name: `Scale Cleanser ${productIds.length + index}`, slug: `scale-${run}-${productIds.length + index}`,
        brandId: brand.id, isPublished: true, productType: 'cleanser',
      }));
      await db.product.createMany({ data: products }); productIds.push(...products.map(product => product.id));
      await db.sku.createMany({ data: products.map(product => ({ productId: product.id, code: `SCALE-${product.id}`, variantName: '50 ml' })) });
      for (const q of ['scale cleanser', 'clenaser']) {
        const times: number[] = [];
        for (let attempt = 0; attempt < 6; attempt++) {
          const start = performance.now();
          const ids = await provider.suggest({ q, brand: brand.slug, snapshotAt: new Date() }, 8);
          if (ids.length !== 8) throw new Error(`Expected 8 bounded suggestions, received ${ids.length}`);
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        measurements.push({ rows: size, q, p50Ms: Math.round(times[3]), p95Ms: Math.round(times[5]) });
      }
    }
    console.log(JSON.stringify({ scope: 'local PostgreSQL retrieval only; excludes public composition and network', measurements }, null, 2));
  } finally {
    await db.sku.deleteMany({ where: { productId: { in: productIds } } });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    await db.brand.delete({ where: { id: brand.id } }); await db.$disconnect();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
