import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CatalogPolicyService } from '../../src/modules/catalog/services/catalog-policy.service';
import { CatalogIdentitySnapshot } from '../../src/modules/catalog/services/catalog-snapshot.service';
import { BrandDetector, ScopeGate } from '../../src/modules/intake/lib/matching';
import { CatalogPolicyController } from '../../src/application/composition/controllers/catalog-policy.controller';
import { AuthGuard } from '../../src/modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../src/modules/accounts/guards/roles.guard';

describe('Catalog eligibility policy and dry-run evaluator', () => {
  const brandId = '11111111-1111-4111-8111-111111111111';
  const categoryId = '22222222-2222-4222-8222-222222222222';

  const makeSnapshot = (
    overrides: Partial<CatalogIdentitySnapshot> = {},
  ): CatalogIdentitySnapshot => ({
    takenAt: '2026-11-12T10:00:00.000Z',
    policyVersion: 2,
    policyMode: 'OPEN',
    policyCategories: [],
    brandCategoryRules: [],
    excludedTerms: [],
    disabledExcludedClasses: [],
    allowedLabels: [],
    brands: [
      {
        id: brandId,
        name: 'CeraVe',
        aliases: ['سيرافي'],
        websiteUrl: 'https://cerave.com',
        policyEffect: 'ALLOW',
        activeSkuCount: 4,
      },
    ],
    deniedLabels: ['Garnier', 'غارنييه'],
    categories: [{ id: categoryId, name: 'Cleansers', parentId: null, isLeaf: true, isActive: true }],
    skus: [],
    ...overrides,
  });

  it('requires ADMIN authentication and role on every policy endpoint', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CatalogPolicyController)).toEqual([
      AuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata('roles', CatalogPolicyController)).toEqual(['ADMIN']);
    const guard = new RolesGuard(new Reflector());
    const ctx = (roles: string[]) =>
      ({
        getHandler: () => CatalogPolicyController.prototype.updatePolicy,
        getClass: () => CatalogPolicyController,
        switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
      }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx(['HUB_OPERATOR']))).toThrow();
    expect(guard.canActivate(ctx(['ADMIN']))).toBe(true);
  });

  it('validates canonical IDs and writes a new approved policy version without touching catalog products', async () => {
    const createMock = jest.fn().mockResolvedValue({ id: 'pol-3', version: 3 });
    const prisma = {
      brand: { findMany: jest.fn().mockResolvedValue([{ id: brandId, name: 'CeraVe' }]) },
      category: { findMany: jest.fn().mockResolvedValue([{ id: categoryId, name: 'Cleansers' }]) },
      ingestionEligibilityPolicy: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pol-2', version: 2, document: {} }),
        findMany: jest.fn().mockResolvedValue([]),
        create: createMock,
      },
      product: { update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
      $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          ingestionEligibilityPolicy: {
            findFirst: jest.fn().mockResolvedValue({ version: 2 }),
            create: createMock,
          },
        }),
      ),
    };

    const service = new CatalogPolicyService(prisma as never);
    await service.updatePolicy(
      {
        mode: 'ALLOWLIST_ONLY',
        brands: [{ id: brandId, name: 'cerave', effect: 'ALLOW', aliases: ['سيرافي', 'سيرافي'] }],
        categories: [{ id: categoryId, name: 'cleansers', effect: 'ALLOW' }],
        brandCategoryRules: [],
        excludedTerms: ['عينة مجانية', 'SAMPLE'],
        disabledExcludedClasses: [],
        reason: 'Restrict supplier intake to approved skincare portfolio',
      },
      'admin-1',
    );

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 3,
          baseVersion: 2,
          status: 'APPROVED',
          actorId: 'admin-1',
          document: expect.objectContaining({
            mode: 'ALLOWLIST_ONLY',
            excludedTerms: ['عينة مجانية', 'SAMPLE'],
            brands: [
              expect.objectContaining({
                id: brandId,
                name: 'CeraVe',
                aliases: ['سيرافي'],
              }),
            ],
          }),
        }),
      }),
    );
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  it('rejects policy updates pointing to non-existent canonical brand IDs', async () => {
    const prisma = {
      brand: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CatalogPolicyService(prisma as never);
    await expect(
      service.updatePolicy(
        {
          mode: 'OPEN',
          brands: [{ id: brandId, name: 'Ghost Brand', effect: 'ALLOW' }],
          categories: [],
          brandCategoryRules: [],
          excludedTerms: [],
          reason: 'Should fail validation',
        },
        'admin-1',
      ),
    ).rejects.toThrow('Canonical brand not found');
  });

  it('evaluates ALLOW, SKIP, and REVIEW outcomes deterministically in dry-run simulator', async () => {
    const snapshotOpen = makeSnapshot({ policyMode: 'OPEN', excludedTerms: ['tester'] });
    const snapshotStrict = makeSnapshot({ policyMode: 'ALLOWLIST_ONLY' });

    const controller = new CatalogPolicyController(
      { getPolicyState: jest.fn() } as never,
      {
        identitySnapshot: jest
          .fn()
          .mockResolvedValueOnce(snapshotOpen)
          .mockResolvedValueOnce(snapshotOpen)
          .mockResolvedValueOnce(snapshotOpen)
          .mockResolvedValueOnce(snapshotStrict),
      } as never,
    );

    const allow = await controller.evaluate({ title: 'غسول سيرافي المرطب 236 مل' });
    expect(allow.outcome).toBe('ALLOW');

    const skip = await controller.evaluate({ title: 'CeraVe hydrating cleanser tester pack' });
    expect(skip.outcome).toBe('SKIP');
    expect(skip.reasonCode).toBe('POLICY_EXCLUDED_TERM');

    const review = await controller.evaluate({ title: 'New Botanical Serum 30ml' });
    expect(review.outcome).toBe('REVIEW');
    expect(review.reasonCode).toBe('UNKNOWN_SCOPE');

    const strictSkip = await controller.evaluate({ title: 'New Botanical Serum 30ml' });
    expect(strictSkip.outcome).toBe('SKIP');
    expect(strictSkip.reasonCode).toBe('NOT_IN_ALLOWLIST');
  });

  it('still lets hard identifiers pass ScopeGate even in ALLOWLIST_ONLY mode', () => {
    const snapshot = makeSnapshot({ policyMode: 'ALLOWLIST_ONLY' });
    const detector = new BrandDetector(snapshot.brands);
    const gate = new ScopeGate(snapshot);
    const verdict = gate.decide({
      name: 'Unknown Brand Product',
      catalogBrands: detector.detect('Unknown Brand Product'),
      hardIdentifier: true,
    });
    expect(verdict).toEqual({ decision: 'CONTINUE', reasonCode: 'HARD_IDENTIFIER' });
  });
});
