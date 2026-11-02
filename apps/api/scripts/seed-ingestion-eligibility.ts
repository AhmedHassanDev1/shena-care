/** Default is a read-only preview. Apply/activation must be explicitly requested by the operator. */
import 'reflect-metadata';
import { config } from 'dotenv';
import { PrismaService } from '../src/platform/database/prisma.service';
import { IngestionEligibilityService } from '../src/modules/ingestion/services/ingestion-eligibility.service';
import { eligibilityLabel } from '../src/modules/ingestion/services/ingestion-eligibility.policy';

config({ path: 'apps/api/.env', quiet: true } as Parameters<typeof config>[0]);
export const INITIAL_BRANDS = [
  { name: 'Eva', slug: 'eva', names: ['Eva', 'Eva Cosmetics'], aliases: ['Eva', 'إيفا'], source: 'https://eva-cosmetics.com/brands/', line: 'Skin Clinic' },
  { name: 'Starville', slug: 'starville', names: ['Starville'], aliases: ['ستارفيل'], source: 'https://www.parkvillepharma.com/brands' },
  { name: 'Shaan', slug: 'shaan', names: ['Shaan'], aliases: ['شان'], source: 'https://www.parkvillepharma.com/brands' },
  { name: 'Strongville', slug: 'strongville', names: ['Strongville'], aliases: ['سترونجفيل'], source: 'https://www.parkvillepharma.com/brands' },
  { name: 'Bobai', slug: 'bobai', names: ['Bobai'], aliases: ['بوباي'], source: 'https://www.parkvillepharma.com/brands' },
  { name: 'Dermactive', slug: 'dermactive', names: ['Dermactive', 'Derm Active', 'Derm-active'], aliases: ['ديرماكتيف'], source: 'https://derm-active.com/about-us/' },
  { name: 'CeraVe', slug: 'cerave', names: ['CeraVe'], aliases: ['سيرافي'], source: 'https://www.cerave.com/' },
  { name: 'Bioderma', slug: 'bioderma', names: ['Bioderma'], aliases: ['بيوديرما'], source: 'https://www.bioderma.com/' },
  { name: 'La Roche-Posay', slug: 'la-roche-posay', names: ['La Roche-Posay', 'La Roche Posay'], aliases: ['لاروش بوزيه', 'لا روش بوزيه'], source: 'https://www.laroche-posay.com/' },
  { name: 'Vichy', slug: 'vichy', names: ['Vichy'], aliases: ['فيشي'], source: 'https://www.vichy.co.uk/all-products/haircare', line: 'Dercos' },
];
export const INITIAL_CATEGORIES = [
  { intent: 'Facial Cleansers', slug: 'cleansers', name: 'Cleansers', parent: 'skin-care' },
  { intent: 'Moisturizers', slug: 'moisturizers', name: 'Moisturizers', parent: 'skin-care' },
  { intent: 'Sunscreens', slug: 'sunscreens', name: 'Sunscreens', parent: 'skin-care' },
  { intent: 'Face Serums/Treatments', slug: 'serums-treatments', name: 'Serums & Treatments', parent: 'skin-care' },
  { intent: 'Shampoos', slug: 'shampoos', name: 'Shampoos', parent: 'hair-care' },
  { intent: 'Conditioners', slug: 'conditioners', name: 'Conditioners', parent: 'hair-care' },
  { intent: 'Hair Masks', slug: 'hair-masks', name: 'Hair Masks', parent: 'hair-care' },
  { intent: 'Scalp Treatments', slug: 'scalp-treatments', name: 'Scalp Treatments', parent: 'hair-care' },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const activate = process.argv.includes('--activate');
  if (activate && !apply) throw new Error('--activate requires --apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const localTest = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /\/[A-Za-z0-9_]+_test$/.test(url.pathname);
  if (apply && process.env.DIRECT_URL !== process.env.DATABASE_URL) throw new Error('Explicit identical DATABASE_URL and DIRECT_URL required');
  if (apply && !localTest && !process.argv.includes('--owner-approved-remote')) throw new Error('Remote writes require explicit owner approval and --owner-approved-remote');
  const prisma = new PrismaService();
  try {
    const data = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return { brands: await tx.brand.findMany(), categories: await tx.category.findMany() };
    });
    const findBrand = (reference: typeof INITIAL_BRANDS[number]) => {
      const labels = new Set(reference.names.map(eligibilityLabel));
      const matches = data.brands.filter(b => labels.has(eligibilityLabel(b.name)) || b.slug === reference.slug);
      if (matches.length > 1) throw new Error(`Ambiguous canonical identity: ${reference.name}`);
      if (matches[0] && !labels.has(eligibilityLabel(matches[0].name))) throw new Error(`Canonical slug/name conflict: ${reference.name}`);
      return matches[0];
    };
    const preview = {
      brands: INITIAL_BRANDS.map(b => ({ canonicalId: findBrand(b)?.id ?? null, action: findBrand(b) ? 'REUSE' : 'CREATE', ...b })),
      categories: INITIAL_CATEGORIES.map(c => {
        const existing = data.categories.find(x => x.slug === c.slug);
        const parent = data.categories.find(x => x.slug === c.parent);
        if (!parent || !parent.isActive) throw new Error(`Required existing taxonomy parent missing/inactive: ${c.parent}`);
        if (existing && (existing.parentId !== parent.id || data.categories.some(x => x.parentId === existing.id)))
          throw new Error(`Existing category does not match the reviewed exact leaf: ${c.slug}`);
        return { ...c, canonicalId: existing?.id ?? null, parentId: parent.id, action: existing ? 'REUSE' : 'CREATE_EXACT_LEAF' };
      }),
      notes: ['Aliases are proposed for Admin review before activation.', 'Skin Clinic and Dercos are product lines, never canonical brands or standalone brand aliases.',
        'Hair Treatments & Styling is not approved.', 'No SKU allowlist, products, offers or publication writes.'],
    };
    console.log(JSON.stringify(preview, null, 2));
    if (!apply) return;
    const actorId = process.env.ELIGIBILITY_SEED_ACTOR_ID;
    const reason = process.env.ELIGIBILITY_SEED_REASON;
    if (!actorId || !reason || reason.trim().length < 5) throw new Error('ELIGIBILITY_SEED_ACTOR_ID and meaningful ELIGIBILITY_SEED_REASON required');
    const service = new IngestionEligibilityService(prisma);
    await service.assertAdmin(actorId);
    const current = await service.current();
    if (current) { console.log(JSON.stringify({ reusedApprovedPolicy: current.id, version: current.version })); return; }
    const rules = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ingestion-eligibility-initial-seed'))`;
      const brands = [];
      for (const reference of INITIAL_BRANDS) {
        const known = findBrand(reference);
        const brand = known ?? await tx.brand.upsert({ where: { slug: reference.slug }, update: {},
          create: { name: reference.name, slug: reference.slug, websiteUrl: reference.source } });
        brands.push({ id: brand.id, effect: 'ALLOW' as const, aliases: reference.aliases });
      }
      const categories = [];
      for (const reference of preview.categories) {
        const category = await tx.category.upsert({ where: { slug: reference.slug }, update: {},
          create: { name: reference.name, slug: reference.slug, parentId: reference.parentId } });
        categories.push({ id: category.id, effect: 'ALLOW' as const });
      }
      return { brands, categories };
    });
    const existing = await prisma.ingestionEligibilityPolicy.findFirst({ where: { status: 'PREVIEW', baseVersion: 0, actorId, reason }, orderBy: { createdAt: 'desc' } });
    const draft = existing && Date.now() - existing.createdAt.getTime() < 30 * 60_000 ? existing
      : await service.preview({ expectedVersion: 0, reason, ...rules, mappings: [] }, actorId);
    console.log(JSON.stringify({ previewId: draft.id, impact: draft.impact, document: draft.document }));
    if (activate) console.log(JSON.stringify(await service.approve(draft.id, actorId)));
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : 'Seed failed'); process.exitCode = 1; });
