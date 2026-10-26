// Run-scoped baseline for the supplier file-ingestion UI test. Runs ONLY against the local *_test database.
// Creates: one supplier + supplier login, one unrelated supplier with an offer, one admin login, three canonical SKUs.
// It never creates ingestion jobs/items or supplier offers for the uploading supplier — those must come from the UI.
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function ean13(body12: string): string {
  const sum = body12.split('').reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return body12 + String((10 - (sum % 10)) % 10);
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const db = url.pathname.slice(1);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !db.endsWith('_test')) {
    throw new Error(`Refusing to seed: ${url.hostname}/${db} is not a local *_test database`);
  }
  const outDir = process.argv[2];
  if (!outDir) throw new Error('usage: seed.ts <output dir>');
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 12); // yymmddhhmm
  const runId = `UIE2E-${stamp}`;
  const tail = stamp.slice(-6);
  const password = crypto.randomBytes(9).toString('base64url') + 'aA1!';
  const passwordHash = await bcrypt.hash(password, 10);

  const mkCustomer = async (email: string, name: string, roles: any[], supplierId?: string) => {
    const customer = await prisma.customer.create({ data: { name, email, roles, supplierId, isActive: true } });
    await prisma.identity.create({ data: { provider: 'EMAIL', providerId: email, customerId: customer.id, passwordHash } });
    return customer;
  };

  const supplierA = await prisma.supplier.create({ data: { name: `${runId} Supplier A`, slug: `${runId.toLowerCase()}-a` } });
  const supplierB = await prisma.supplier.create({ data: { name: `${runId} Supplier B (unrelated)`, slug: `${runId.toLowerCase()}-b` } });
  const supplierUser = await mkCustomer(`supplier.${runId.toLowerCase()}@ui-e2e.test`, `${runId} supplier user`, ['SUPPLIER'], supplierA.id);
  const adminUser = await mkCustomer(`admin.${runId.toLowerCase()}@ui-e2e.test`, `${runId} admin user`, ['ADMIN']);

  const brand = async (name: string) => prisma.brand.upsert({
    where: { slug: name.toLowerCase().replace(/\s+/g, '-') },
    update: {}, create: { name, slug: name.toLowerCase().replace(/\s+/g, '-') },
  });
  const cerave = await brand('CeraVe');
  const bioderma = await brand('Bioderma');

  const mkSku = async (brandId: string, productName: string, size: number, unit: string, seq: string) => {
    const product = await prisma.product.create({
      data: { brandId, name: productName, slug: `${runId.toLowerCase()}-${seq}` },
    });
    const barcode = ean13(`629${tail}${seq.padStart(3, '0')}`);
    const sku = await prisma.sku.create({
      data: { productId: product.id, code: `${runId}-SKU-${seq}`, variantName: 'Default', size, sizeUnit: unit, barcode },
    });
    return { product, sku, barcode };
  };
  const s1 = await mkSku(cerave.id, 'CeraVe Hydrating Cleanser', 236, 'ml', '001');
  const s2 = await mkSku(cerave.id, 'CeraVe Moisturising Cream', 454, 'g', '002');
  const s3 = await mkSku(bioderma.id, 'Bioderma Sensibio H2O Micellar Water', 250, 'ml', '003');

  // Unrelated pre-existing supplier-B offer on SKU1: must be byte-identical after every supplier-A upload.
  const unrelatedOffer = await prisma.supplierOffer.create({
    data: { supplierId: supplierB.id, skuId: s1.sku.id, costPrice: 301.25, currency: 'EGP', isAvailable: true },
  });

  const manifest = {
    runId,
    dbTarget: `${url.hostname}:${url.port}/${db}`,
    supplierA: supplierA.id, supplierB: supplierB.id,
    supplierUser: { id: supplierUser.id, email: supplierUser.email },
    adminUser: { id: adminUser.id, email: adminUser.email },
    skus: {
      s1: { skuId: s1.sku.id, productId: s1.product.id, code: s1.sku.code, barcode: s1.barcode },
      s2: { skuId: s2.sku.id, productId: s2.product.id, code: s2.sku.code, barcode: s2.barcode },
      s3: { skuId: s3.sku.id, productId: s3.product.id, code: s3.sku.code, barcode: s3.barcode },
    },
    unrelatedOfferId: unrelatedOffer.id,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outDir, 'password.txt'), password);
  console.log(JSON.stringify({ ...manifest, passwordFile: path.join(outDir, 'password.txt') }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
