import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CanonicalResearchService } from '../../src/modules/catalog/public';
import { hashFactValue } from '../../src/modules/catalog/research/product-fact-extractor';
import { createActor } from '../fixtures/actors';

describe('withdraw an already applied navigation-only ingredient claim', () => {
  it('preserves source/value audit and unrelated claims, is idempotent, and rejects a customer actor', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const db = app.get(PrismaService);
      const admin = await createActor(db, 'ADMIN');
      const customer = await createActor(db, 'CUSTOMER');
      const value = [{ name: 'Learn More About Niacinamide', function: 'Read More Here' }];
      const tag = randomUUID();
      const sku = await db.sku.create({ data: { code: `NAV-${tag}`, variantName: '30ml', product: { create: { name: 'Navigation regression', slug: `nav-${tag}`,
        brand: { create: { name: `Nav ${tag}`, slug: `nav-${tag}` } }, claimsEvidence: { fragrance: { value: 'FREE' }, keyIngredients: { items: value, sourceUrl: 'https://theordinary.com/product' } },
      } } } });
      const run = await db.productResearchRun.create({ data: { skuId: sku.id, schemaVersion: 1, requestedBy: admin.id } });
      const fact = await db.productFactProposal.create({ data: { skuId: sku.id, runId: run.id, field: 'composition.keyIngredients', value, valueHash: hashFactValue('composition.keyIngredients', value),
        status: 'APPLIED', evidence: [{ sourceUrl: 'https://theordinary.com/product', excerpt: 'Learn More About Niacinamide / Read More Here' }], confidence: 1, schemaVersion: 1 } });
      const service = app.get(CanonicalResearchService);
      await expect(service.withdrawNavigationIngredientFact(fact.id, customer.id)).rejects.toThrow();
      await expect(service.withdrawNavigationIngredientFact(fact.id, admin.id)).resolves.toBe(true);
      await expect(service.withdrawNavigationIngredientFact(fact.id, admin.id)).resolves.toBe(false);
      const after = await db.productFactProposal.findUniqueOrThrow({ where: { id: fact.id } });
      expect(after.status).toBe('REJECTED');
      expect(after.value).toEqual(value);
      expect(after.evidence).toEqual(fact.evidence);
      expect((await db.product.findUniqueOrThrow({ where: { id: sku.productId } })).claimsEvidence).toEqual({ fragrance: { value: 'FREE' } });
      expect(await db.catalogDecisionRecord.count({ where: { subjectId: fact.id, reasonCode: 'NAVIGATION_NOT_INGREDIENT' } })).toBe(1);
      const corrected = [{ name: 'Niacinamide', function: null }];
      const currentClaims = { fragrance: { value: 'FREE' }, keyIngredients: { items: corrected } };
      await db.product.update({ where: { id: sku.productId }, data: { claimsEvidence: currentClaims } });
      const staleValue = [{ name: 'Read More About Niacinamide', function: null }];
      const stale = await db.productFactProposal.create({ data: { skuId: sku.id, runId: run.id, field: 'composition.keyIngredients', value: staleValue,
        valueHash: hashFactValue('composition.keyIngredients', staleValue), status: 'APPLIED', evidence: fact.evidence!, confidence: 1, schemaVersion: 1 } });
      await expect(service.withdrawNavigationIngredientFact(stale.id, admin.id)).rejects.toThrow('changed');
      expect((await db.product.findUniqueOrThrow({ where: { id: sku.productId } })).claimsEvidence).toEqual(currentClaims);
      expect((await db.productFactProposal.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('APPLIED');
      const genuine = await db.productFactProposal.create({ data: { skuId: sku.id, runId: run.id, field: 'composition.keyIngredients', value: corrected,
        valueHash: hashFactValue('composition.keyIngredients', corrected), status: 'APPLIED', evidence: fact.evidence!, confidence: 1, schemaVersion: 1 } });
      await expect(service.withdrawNavigationIngredientFact(genuine.id, admin.id)).rejects.toThrow('navigation-only');
    } finally { await app.close(); }
  }, 60000);
});
