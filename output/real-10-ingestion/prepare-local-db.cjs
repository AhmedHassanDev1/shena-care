// Test setup only. Reads the approved policy and reference taxonomy from the configured
// source, then writes only to the independently checked localhost _test database.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const fromApi = createRequire(path.resolve(__dirname, '../../apps/api/package.json'));
const { PrismaClient } = fromApi('@prisma/client');
const bcrypt = fromApi('bcrypt');
const dotenv = fromApi('dotenv');

const targetUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
if (!targetUrl || !directUrl || targetUrl !== directUrl) throw new Error('Both local datasource URLs must be pinned to the same test database');
const target = new URL(targetUrl);
if (target.hostname !== '127.0.0.1' || target.port !== '55432' || !target.pathname.slice(1).endsWith('_test')) {
  throw new Error('Refusing to write outside the dedicated localhost _test database');
}
const sourceEnv = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../apps/api/.env')));
const sourceUrl = sourceEnv.DATABASE_URL;
if (!sourceUrl || sourceUrl === targetUrl) throw new Error('Source policy URL is missing or overlaps the test target');

const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const local = new PrismaClient({ datasources: { db: { url: targetUrl } } });

async function main() {
  const policy = await source.ingestionEligibilityPolicy.findFirst({ where: { status: 'APPROVED' }, orderBy: { version: 'desc' },
    select: { version: true, baseVersion: true, status: true, document: true, impact: true } });
  if (policy?.version !== 14) throw new Error(`Expected current Policy v14; got ${policy?.version ?? 'none'}`);
  const brandIds = policy.document.brands.map(brand => brand.id);
  const categoryIds = policy.document.categories.map(category => category.id);
  const [brands, categories] = await Promise.all([
    source.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true, slug: true, description: true, websiteUrl: true, countryOfOrigin: true, isActive: true } }),
    source.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, parentId: true, name: true, slug: true, description: true, sortOrder: true, isActive: true } }),
  ]);
  if (brands.length !== brandIds.length || categories.length !== categoryIds.length) throw new Error('Policy references a missing canonical brand or category');
  const snapshot = { version: policy.version, brands, categories, policy: { baseVersion: policy.baseVersion, document: policy.document, impact: policy.impact } };
  fs.writeFileSync(path.join(__dirname, 'policy-v14-local-snapshot.json'), JSON.stringify(snapshot, null, 2));

  for (const brand of brands) await local.brand.upsert({ where: { id: brand.id }, create: brand, update: {} });
  for (const category of categories.filter(category => !category.parentId)) await local.category.upsert({ where: { id: category.id }, create: category, update: {} });
  for (const category of categories.filter(category => category.parentId)) await local.category.upsert({ where: { id: category.id }, create: category, update: {} });

  const passwordHash = await bcrypt.hash('LocalReal10Only!', 10);
  const admin = await local.customer.upsert({ where: { email: 'real10-admin@local.test' },
    create: { name: 'Real 10 Local Admin', email: 'real10-admin@local.test', roles: ['ADMIN'] }, update: {} });
  await local.identity.upsert({ where: { provider_providerId: { provider: 'EMAIL', providerId: admin.email } },
    create: { customerId: admin.id, provider: 'EMAIL', providerId: admin.email, passwordHash }, update: {} });
  const supplier = await local.supplier.upsert({ where: { slug: 'real10-development-test-supplier' },
    create: { name: 'Real 10 Development Test Supplier (No Stock or Prices)', slug: 'real10-development-test-supplier' }, update: {} });
  const supplierUser = await local.customer.upsert({ where: { email: 'real10-supplier@local.test' },
    create: { name: 'Real 10 Local Supplier', email: 'real10-supplier@local.test', roles: ['SUPPLIER'], supplierId: supplier.id }, update: {} });
  await local.identity.upsert({ where: { provider_providerId: { provider: 'EMAIL', providerId: supplierUser.email } },
    create: { customerId: supplierUser.id, provider: 'EMAIL', providerId: supplierUser.email, passwordHash }, update: {} });
  await local.ingestionEligibilityPolicy.upsert({ where: { version: 14 },
    create: { version: 14, baseVersion: policy.baseVersion, status: 'APPROVED', document: policy.document, impact: policy.impact,
      actorId: admin.id, reason: 'Isolated local mirror of approved Policy v14', approvedAt: new Date() }, update: {} });
  console.log(JSON.stringify({ targetHost: target.hostname, targetDatabase: target.pathname.slice(1), policyVersion: 14,
    brands: brands.length, categories: categories.length, adminId: admin.id, supplierId: supplier.id,
    products: await local.product.count(), supplierOffers: await local.supplierOffer.count() }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await source.$disconnect(); await local.$disconnect(); });
