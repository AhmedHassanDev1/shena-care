const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const configuredUrl = new URL(process.env.DATABASE_URL);
if (!configuredUrl.pathname.endsWith('_test')) throw new Error('Migration checks require a dedicated test DB');
const suffix = Date.now().toString();
const names = [`shenacare_closure_fresh_${suffix}_test`, `shenacare_closure_upgrade_${suffix}_test`];
function urlFor(name) { const url = new URL(configuredUrl); url.pathname = '/' + name; return url.toString(); }
function clientFor(name) { return new PrismaClient({ datasources: { db: { url: urlFor(name) } } }); }
function deploy(name, schema) {
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
    { env: { ...process.env, DATABASE_URL: urlFor(name) }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Disposable migration deployment failed');
}
async function main() {
  const admin = new PrismaClient();
  try {
    for (const name of names) {
      if (!/^[a-z0-9_]+_test$/.test(name)) throw new Error('Invalid disposable DB name');
      // Database identifiers cannot be SQL parameters; generated names are strictly bounded.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    }
  } finally { await admin.$disconnect(); }
  deploy(names[0], 'prisma/schema.prisma');
  const directory = path.resolve(`scratch/migration-upgrade-${suffix}/prisma`);
  fs.mkdirSync(path.join(directory, 'migrations'), { recursive: true });
  const baseline = execFileSync('git', ['show', 'cd09c4b:apps/api/prisma/schema.prisma'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(directory, 'schema.prisma'), baseline);
  for (const entry of fs.readdirSync('prisma/migrations')) {
    if (entry === '20261010000002_supplier_account_membership') continue;
    fs.cpSync(path.join('prisma/migrations', entry), path.join(directory, 'migrations', entry), { recursive: true });
  }
  deploy(names[1], path.join(directory, 'schema.prisma'));
  const upgrade = clientFor(names[1]);
  const customerId = 'e1000000-0000-4000-8000-000000000001';
  const supplierId = 'e1000000-0000-4000-8000-000000000002';
  try {
    // Seed legacy records using SQL because the final client knows a column not yet present.
    await upgrade.$executeRaw`INSERT INTO sourcing.suppliers (id,name,slug,is_active,created_at,updated_at)
      VALUES (${supplierId}::uuid,'Migration supplier fixture','migration-supplier-fixture',true,now(),now())`;
    await upgrade.$executeRaw`INSERT INTO accounts.customers (id,name,email,roles,created_at,updated_at)
      VALUES (${customerId}::uuid,'Existing supplier account fixture','migration-fixture@shenacare.test',ARRAY['SUPPLIER']::accounts."Role"[],now(),now())`;
    const brand = await upgrade.brand.create({ data: { name: 'Migration brand fixture', slug: 'migration-brand-fixture' } });
    const product = await upgrade.product.create({ data: { name: 'Legacy catalog fixture', slug: 'legacy-catalog-fixture', brandId: brand.id, isPublished: true } });
    const sku = await upgrade.sku.create({ data: { productId: product.id, code: 'MIGRATION-FIXTURE', variantName: '50 ml', size: 50, sizeUnit: 'ml' } });
    await upgrade.productMedia.create({ data: { productId: product.id, type: 'image', originType: 'verified', url: 'https://invalid.example/legacy.png' } });
    await upgrade.supplierOffer.create({ data: { supplierId, skuId: sku.id, costPrice: 30, currency: 'SAR', isAvailable: true } });
    await upgrade.sellingPrice.create({ data: { skuId: sku.id, amount: 100, currency: 'SAR', validFrom: new Date('2026-01-01') } });
    await upgrade.listing.create({ data: { skuId: sku.id, isListed: true } });
    async function catalogSnapshot() { return Promise.all([
      upgrade.product.findUnique({ where: { id: product.id }, include: { skus: true, media: true } }),
      upgrade.supplierOffer.findMany({ where: { skuId: sku.id } }), upgrade.sellingPrice.findMany({ where: { skuId: sku.id } }),
      upgrade.listing.findUnique({ where: { skuId: sku.id } }),
    ]); }
    const catalogBefore = await catalogSnapshot();
    const before = await upgrade.$queryRaw`SELECT to_jsonb(c) AS record FROM accounts.customers c WHERE id=${customerId}::uuid`;
    deploy(names[1], 'prisma/schema.prisma');
    const after = await upgrade.$queryRaw`SELECT to_jsonb(c) - 'supplier_id' AS record FROM accounts.customers c WHERE id=${customerId}::uuid`;
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Legacy customer data changed');
    if (JSON.stringify(catalogBefore) !== JSON.stringify(await catalogSnapshot())) throw new Error('Legacy catalog/commercial data changed');
    deploy(names[1], 'prisma/schema.prisma'); // Applying the final history twice must be harmless.
    const existing = await upgrade.customer.findUniqueOrThrow({ where: { id: customerId } });
    if (existing.supplierId !== null) throw new Error('Legacy account was automatically granted tenant access');
    await upgrade.customer.update({ where: { id: customerId }, data: { supplierId } });
    if ((await upgrade.customer.findUniqueOrThrow({ where: { id: customerId } })).supplierId !== supplierId) throw new Error('Membership did not persist');
    let rejected = false;
    try { await upgrade.customer.update({ where: { id: customerId }, data: { supplierId: 'e1000000-0000-4000-8000-000000000099' } }); }
    catch (error) { rejected = error.code === 'P2003'; }
    if (!rejected) throw new Error('Missing supplier foreign key accepted');
    await upgrade.supplier.delete({ where: { id: supplierId } });
    if ((await upgrade.customer.findUniqueOrThrow({ where: { id: customerId } })).supplierId !== null) throw new Error('Supplier deletion did not revoke membership');
    const migrations = await upgrade.$queryRaw`SELECT count(*)::int AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL`;
    if (migrations[0].count !== 28) throw new Error('Incomplete upgrade history');
    console.log(JSON.stringify({ freshDatabase: names[0], upgradeDatabase: names[1], migrations: 28,
      legacyCustomerPreserved: true, legacyCatalogAndCommercialDataPreserved: true, repeatedDeploymentSafe: true, defaultMembershipDenied: true, membershipForeignKey: true, deleteRevokesMembership: true }));
  } finally { await upgrade.$disconnect(); }
}
main().catch(() => { console.error('Disposable migration verification failed'); process.exitCode = 1; });
