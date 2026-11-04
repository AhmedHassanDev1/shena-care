import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngestionEligibilityService } from '../../src/modules/ingestion/services/ingestion-eligibility.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { ProductIdentityService } from '../../src/modules/ingestion/services/product-identity.service';
import { eligibilityLabel } from '../../src/modules/ingestion/services/ingestion-eligibility.policy';

type Decision = { outcome: 'ALLOW' | 'HOLD'; reason: string; policyId: string; version: number; brandId?: string; brandName?: string; categoryId?: string };

/** A label a suite uses to mean "a brand no Admin has approved": it must keep holding. */
const NEVER_REGISTER = /^(unlisted|unknown|fake|invalid|n\/a|none)\b/i;
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Suites written before the Brand + Category allowlist exercise what happens AFTER admission (matching, offers, review,
 * publication). They predate category columns and often brand columns, so under the real policy every row would stop at
 * HOLD and they would prove nothing. This admits their rows against a real approved policy row, so FK and pinning stay
 * real: stated brands are registered as the Admin would, a blank brand cell takes a known brand named in the title, and
 * directly inserted items get a decision for their stated brand. A row with no recognizable brand still HOLDs.
 *
 * Test-only and never a production path. Admission itself is proven by ingestion-eligibility*.e2e-spec and glo285-scale-gate.
 */
export async function admitDownstreamRows(app: INestApplication, options: { brands?: string[]; brandFor?: (title: string) => string | undefined } = {}): Promise<void> {
  const prisma = app.get(PrismaService);
  const eligibility = app.get(IngestionEligibilityService);
  const identity = app.get(ProductIdentityService);
  const ingestion = app.get(IngestionService) as unknown as Record<string, (...args: never[]) => unknown>;
  const suffix = randomUUID().slice(0, 8);
  const parent = await prisma.category.findFirst({ where: { name: 'Downstream Suite Root' } }) ??
    await prisma.category.create({ data: { name: 'Downstream Suite Root', slug: `downstream-root-${suffix}` } });
  const leaf = await prisma.category.findFirst({ where: { name: 'Downstream Suite Leaf' } }) ??
    await prisma.category.create({ data: { name: 'Downstream Suite Leaf', slug: `downstream-leaf-${suffix}`, parentId: parent.id } });
  const policy = await eligibility.current() ?? await (async () => {
    const admin = await prisma.customer.create({ data: { name: 'Downstream Policy Admin', email: `downstream-${randomUUID()}@fixtures.test`, roles: ['ADMIN'] } });
    const preview = await eligibility.preview({ expectedVersion: 0, reason: 'Fixture policy for downstream suites', brands: [], categories: [{ id: leaf.id, effect: 'ALLOW' }], mappings: [] }, admin.id);
    return eligibility.approve(preview.id, admin.id);
  })();
  const version = policy.version!;

  const known = new Map<string, { id: string; name: string }>();
  const categoryByItem = new Map<string, string>();
  const refresh = async () => {
    known.clear();
    for (const brand of await prisma.brand.findMany({ where: { isActive: true }, select: { id: true, name: true } })) known.set(eligibilityLabel(brand.name), brand);
  };
  const register = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || NEVER_REGISTER.test(trimmed) || known.has(eligibilityLabel(trimmed))) return;
    // An alias of a brand the matcher already knows is that brand, not a second one.
    const canonical = identity.canonicalizeBrand(trimmed);
    const sameBrand = [...known.values()].find(brand => identity.canonicalizeBrand(brand.name) === canonical);
    if (sameBrand) { known.set(eligibilityLabel(trimmed), sameBrand); return; }
    const slug = slugOf(trimmed) || `downstream-${randomUUID().slice(0, 12)}`;
    const brand = await prisma.brand.upsert({ where: { name: trimmed }, update: {}, create: { name: trimmed, slug: await prisma.brand.findUnique({ where: { slug } }) ? `${slug}-${suffix}` : slug } });
    known.set(eligibilityLabel(brand.name), brand);
  };
  const namedIn = (title: string) => {
    const text = eligibilityLabel(title);
    return [...known.entries()].filter(([label]) => label.length >= 3 && ` ${text} `.includes(` ${label} `)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  };

  const admit = (brand: string): Decision => {
    const found = known.get(eligibilityLabel(brand));
    if (!found) return { outcome: 'HOLD', reason: 'BRAND_UNKNOWN', policyId: policy.id, version };
    return { outcome: 'ALLOW', reason: 'BRAND_AND_LEAF_APPROVED', policyId: policy.id, version, brandId: found.id, brandName: found.name, categoryId: leaf.id };
  };
  const real = eligibility.compile.bind(eligibility);
  jest.spyOn(eligibility, 'compile').mockImplementation(async (id, db) => ({ ...await real(id, db), evaluate: (_supplierId: string, brand: string) => admit(brand) }));

  const wrap = (method: string, before: (...args: never[]) => Promise<unknown[] | void>) => {
    const original = ingestion[method].bind(ingestion);
    ingestion[method] = (async (...args: never[]) => original(...((await before(...args)) ?? args) as never[])) as never;
  };
  wrap('createJob', (async (dto: { items: Array<{ brand: string; name: string }> }) => {
    await refresh();
    for (const item of dto.items) await register(item.brand ?? '');
    return [{ ...dto, items: dto.items.map(item => item.brand?.trim() ? item : { ...item, brand: namedIn(item.name)?.name ?? '' }) }];
  }) as never);
  wrap('extractItemsFromParsedSpreadsheet', (async (job: unknown, parsed: { rows: Array<{ data: Record<string, unknown> }> }, mapping: { brand?: string; name: string }) => {
    await refresh();
    for (const name of options.brands ?? []) await register(name);
    for (const row of parsed.rows) { const label = options.brandFor?.(String(row.data[mapping.name] ?? '')); if (label) await register(label); }
    const stated = (title: string) => options.brandFor?.(title) ?? namedIn(title)?.name ?? '';
    if (mapping.brand) for (const label of new Set(parsed.rows.map(row => String(row.data[mapping.brand!] ?? '')))) await register(label);
    const brandColumn = mapping.brand ?? '__fixtureBrand';
    const rows = parsed.rows.map(row => String(row.data[brandColumn] ?? '').trim() ? row
      : { ...row, data: { ...row.data, [brandColumn]: stated(String(row.data[mapping.name] ?? '')) } });
    return [job, { ...parsed, rows }, { ...mapping, brand: brandColumn }];
  }) as never);

  // Directly inserted items never passed intake: register their stated brand before the steps that look it up.
  const registerItemBrand = async (itemId: string, dto?: { categoryId?: string }) => {
    await refresh();
    const item = await prisma.ingestionItem.findUnique({ where: { id: itemId }, select: { brand: true } });
    if (item) await register(item.brand);
    if (dto?.categoryId) categoryByItem.set(itemId, dto.categoryId);
  };
  for (const method of ['approveItem', 'publishCandidate', 'getCandidateReviewRecord', 'correctCandidate', 'updateCandidate', 'researchCandidate', 'uploadCandidateMedia', 'getCandidateDetail', 'generateCandidateContent']) {
    if (ingestion[method]) wrap(method, (async (itemId: string, dto?: { categoryId?: string }) => { await registerItemBrand(itemId, dto); }) as never);
  }
  wrap('publishJob', (async (jobId: string) => {
    await refresh();
    for (const item of await prisma.ingestionItem.findMany({ where: { jobId }, select: { brand: true } })) await register(item.brand);
  }) as never);

  const assertAdmitted = ingestion.assertAdmittedItem.bind(ingestion) as unknown as (item: unknown) => unknown;
  ingestion.assertAdmittedItem = ((item: { id?: string; brand: string; enrichment?: { source?: { eligibility?: unknown } } }) => {
    if (item.enrichment?.source?.eligibility) return assertAdmitted(item);
    const found = known.get(eligibilityLabel(item.brand));
    return { outcome: 'ALLOW', reason: 'BRAND_AND_LEAF_APPROVED', policyId: policy.id, version, brandId: found?.id ?? randomUUID(), brandName: item.brand,
      categoryId: (item.id && categoryByItem.get(item.id)) || leaf.id };
  }) as never;
  await refresh();
}
