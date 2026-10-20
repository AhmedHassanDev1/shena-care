import { PrismaClient, IngestionImportMode, IngestionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

export const SEED_DATA = {
  supplierAId: '11111111-1111-4111-8111-111111111111',
  supplierBId: '22222222-2222-4222-8222-222222222222',
  adminId: '99999999-9999-4999-8999-999999999999',
  hubOpId: '88888888-8888-4888-8888-888888888888',
  poAId: 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  poBId: 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  brandCeraVeId: 'c0c0c0c0-1111-4000-8000-000000000001',
  brandLrpId: 'c0c0c0c0-2222-4000-8000-000000000002',
  prodCeraVeId: 'd0d0d0d0-1111-4000-8000-000000000001',
  prodLrpId: 'd0d0d0d0-2222-4000-8000-000000000002',
  sku1Id: 'e0e0e0e0-1111-4000-8000-000000000001',
  sku2Id: 'e0e0e0e0-2222-4000-8000-000000000002',
  sku3Id: 'e0e0e0e0-3333-4000-8000-000000000003',
  tokenSupplierA: '11111111-aaaa-4111-8111-111111111111',
  tokenSupplierB: '22222222-bbbb-4222-8222-222222222222',
  tokenAdmin: '99999999-cccc-4999-8999-999999999999',
  tokenHub: '88888888-dddd-4888-8888-888888888888',
};

async function main() {
  console.log('Seeding Browser E2E fixtures into database...');
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Suppliers
  await prisma.supplier.upsert({
    where: { id: SEED_DATA.supplierAId },
    update: { name: 'شركة النيل لمستحضرات التجميل', slug: 'al-nile-cosmetics' },
    create: {
      id: SEED_DATA.supplierAId,
      name: 'شركة النيل لمستحضرات التجميل',
      slug: 'al-nile-cosmetics',
    },
  });

  await prisma.supplier.upsert({
    where: { id: SEED_DATA.supplierBId },
    update: { name: 'مؤسسة الأهرام للتوريدات الطبية', slug: 'al-ahram-supplies' },
    create: {
      id: SEED_DATA.supplierBId,
      name: 'مؤسسة الأهرام للتوريدات الطبية',
      slug: 'al-ahram-supplies',
    },
  });

  // 2. Accounts & Sessions
  // Supplier A User
  const userA = await prisma.customer.upsert({
    where: { email: 'supplier-a@shinacare.com' },
    update: { name: 'مسؤول مشتريات شركة النيل', roles: ['SUPPLIER'], supplierId: SEED_DATA.supplierAId, isActive: true },
    create: {
      name: 'مسؤول مشتريات شركة النيل',
      email: 'supplier-a@shinacare.com',
      roles: ['SUPPLIER'],
      supplierId: SEED_DATA.supplierAId,
      isActive: true,
    },
  });
  await prisma.identity.upsert({
    where: { provider_providerId: { provider: 'EMAIL', providerId: 'supplier-a@shinacare.com' } },
    update: { passwordHash },
    create: { provider: 'EMAIL', providerId: 'supplier-a@shinacare.com', customerId: userA.id, passwordHash },
  });
  await prisma.session.upsert({
    where: { token: SEED_DATA.tokenSupplierA },
    update: { customerId: userA.id, expiresAt: new Date(Date.now() + 86400000 * 7), isValid: true },
    create: { token: SEED_DATA.tokenSupplierA, customerId: userA.id, expiresAt: new Date(Date.now() + 86400000 * 7), isValid: true },
  });

  // Supplier B User
  const userB = await prisma.customer.upsert({
    where: { email: 'supplier-b@shinacare.com' },
    update: { name: 'مسؤول توريدات الأهرام', roles: ['SUPPLIER'], supplierId: SEED_DATA.supplierBId, isActive: true },
    create: {
      name: 'مسؤول توريدات الأهرام',
      email: 'supplier-b@shinacare.com',
      roles: ['SUPPLIER'],
      supplierId: SEED_DATA.supplierBId,
      isActive: true,
    },
  });
  await prisma.identity.upsert({
    where: { provider_providerId: { provider: 'EMAIL', providerId: 'supplier-b@shinacare.com' } },
    update: { passwordHash },
    create: { provider: 'EMAIL', providerId: 'supplier-b@shinacare.com', customerId: userB.id, passwordHash },
  });
  await prisma.session.upsert({
    where: { token: SEED_DATA.tokenSupplierB },
    update: { customerId: userB.id, expiresAt: new Date(Date.now() + 86400000 * 7), isValid: true },
    create: { token: SEED_DATA.tokenSupplierB, customerId: userB.id, expiresAt: new Date(Date.now() + 86400000 * 7), isValid: true },
  });

  // Admin User
  const userAdmin = await prisma.customer.upsert({
    where: { email: 'admin@shinacare.com' },
    update: { name: 'مدير العمليات شيناكير', roles: ['ADMIN'], isActive: true },
    create: {
      id: SEED_DATA.adminId,
      name: 'مدير العمليات شيناكير',
      email: 'admin@shinacare.com',
      roles: ['ADMIN'],
      isActive: true,
    },
  });
  await prisma.identity.upsert({
    where: { provider_providerId: { provider: 'EMAIL', providerId: 'admin@shinacare.com' } },
    update: { passwordHash },
    create: { provider: 'EMAIL', providerId: 'admin@shinacare.com', customerId: userAdmin.id, passwordHash },
  });
  await prisma.session.upsert({
    where: { token: SEED_DATA.tokenAdmin },
    update: { customerId: userAdmin.id, expiresAt: new Date(Date.now() + 86400000 * 7), isValid: true },
    create: { token: SEED_DATA.tokenAdmin, customerId: userAdmin.id, expiresAt: new Date(Date.now() + 86400000 * 7), isValid: true },
  });

  // Hub Operator User
  const userHub = await prisma.customer.upsert({
    where: { email: 'hub@shinacare.com' },
    update: { name: 'مشغل مركز المعادي', roles: ['HUB_OPERATOR'], isActive: true },
    create: {
      id: SEED_DATA.hubOpId,
      name: 'مشغل مركز المعادي',
      email: 'hub@shinacare.com',
      roles: ['HUB_OPERATOR'],
      isActive: true,
    },
  });
  await prisma.identity.upsert({
    where: { provider_providerId: { provider: 'EMAIL', providerId: 'hub@shinacare.com' } },
    update: { passwordHash },
    create: { provider: 'EMAIL', providerId: 'hub@shinacare.com', customerId: userHub.id, passwordHash },
  });
  await prisma.session.upsert({
    where: { token: SEED_DATA.tokenHub },
    update: { customerId: userHub.id, expiresAt: new Date(Date.now() + 86400000 * 7), isValid: true },
    create: { token: SEED_DATA.tokenHub, customerId: userHub.id, expiresAt: new Date(Date.now() + 86400000 * 7), isValid: true },
  });

  // 3. Brands, Products, SKUs
  let brandCeraVe = await prisma.brand.findFirst({ where: { name: 'CeraVe' } });
  if (!brandCeraVe) {
    brandCeraVe = await prisma.brand.create({
      data: { id: SEED_DATA.brandCeraVeId, name: 'CeraVe', slug: 'cerave' },
    });
  }

  let brandLrp = await prisma.brand.findFirst({ where: { name: 'La Roche-Posay' } });
  if (!brandLrp) {
    brandLrp = await prisma.brand.create({
      data: { id: SEED_DATA.brandLrpId, name: 'La Roche-Posay', slug: 'la-roche-posay' },
    });
  }

  let prodCeraVe = await prisma.product.findFirst({ where: { brandId: brandCeraVe.id } });
  if (!prodCeraVe) {
    prodCeraVe = await prisma.product.create({
      data: {
        id: SEED_DATA.prodCeraVeId,
        brandId: brandCeraVe.id,
        name: 'CeraVe Moisturizing Cream',
        slug: 'cerave-moisturizing-cream',
        isPublished: true,
      },
    });
  }

  let prodLrp = await prisma.product.findFirst({ where: { brandId: brandLrp.id } });
  if (!prodLrp) {
    prodLrp = await prisma.product.create({
      data: {
        id: SEED_DATA.prodLrpId,
        brandId: brandLrp.id,
        name: 'La Roche-Posay Effaclar Purifying Foaming Gel',
        slug: 'lrp-effaclar-gel',
        isPublished: true,
      },
    });
  }

  // Ensure 3 canonical SKUs exist
  let sku1 = await prisma.sku.findFirst({ where: { barcode: '3337875597371' } });
  if (!sku1) {
    sku1 = await prisma.sku.create({
      data: {
        id: SEED_DATA.sku1Id,
        productId: prodCeraVe.id,
        code: 'CRV-MOIST-50ML',
        variantName: '50ml Tube',
        size: 50,
        sizeUnit: 'ml',
        barcode: '3337875597371',
        isActive: true,
      },
    });
  }

  let sku2 = await prisma.sku.findFirst({ where: { barcode: '3337875597388' } });
  if (!sku2) {
    sku2 = await prisma.sku.create({
      data: {
        id: SEED_DATA.sku2Id,
        productId: prodCeraVe.id,
        code: 'CRV-MOIST-177ML',
        variantName: '177ml Jar',
        size: 177,
        sizeUnit: 'ml',
        barcode: '3337875597388',
        isActive: true,
      },
    });
  }

  let sku3 = await prisma.sku.findFirst({ where: { barcode: '3337872411083' } });
  if (!sku3) {
    sku3 = await prisma.sku.create({
      data: {
        id: SEED_DATA.sku3Id,
        productId: prodLrp.id,
        code: 'LRP-EFFACLAR-200ML',
        variantName: '200ml Bottle',
        size: 200,
        sizeUnit: 'ml',
        barcode: '3337872411083',
        isActive: true,
      },
    });
  }

  // 4. Pre-existing Supplier A Offer
  await prisma.supplierOffer.upsert({
    where: { supplierId_skuId: { supplierId: SEED_DATA.supplierAId, skuId: sku1.id } },
    update: { costPrice: 220.0, isAvailable: true, currency: 'EGP' },
    create: {
      supplierId: SEED_DATA.supplierAId,
      skuId: sku1.id,
      costPrice: 220.0,
      isAvailable: true,
      currency: 'EGP',
    },
  });

  // 5. Purchase Order for Supplier A (Fresh, unconfirmed with 3 lines)
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: SEED_DATA.poAId } });
  await prisma.supplierPurchaseOrder.deleteMany({ where: { id: SEED_DATA.poAId } });

  await prisma.supplierPurchaseOrder.create({
    data: {
      id: SEED_DATA.poAId,
      supplierId: SEED_DATA.supplierAId,
      status: 'created',
      lines: {
        create: [
          {
            id: 'aa111111-1111-4aaa-8aaa-111111111111',
            skuId: sku1.id,
            requestedQuantity: 10,
            unitCost: 220.0,
            currency: 'EGP',
            status: 'pending',
          },
          {
            id: 'aa222222-2222-4aaa-8aaa-222222222222',
            skuId: sku2.id,
            requestedQuantity: 5,
            unitCost: 450.0,
            currency: 'EGP',
            status: 'pending',
          },
          {
            id: 'aa333333-3333-4aaa-8aaa-333333333333',
            skuId: sku3.id,
            requestedQuantity: 8,
            unitCost: 380.0,
            currency: 'EGP',
            status: 'pending',
          },
        ],
      },
    },
  });

  // 6. Purchase Order for Supplier B (To verify isolation)
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: SEED_DATA.poBId } });
  await prisma.supplierPurchaseOrder.deleteMany({ where: { id: SEED_DATA.poBId } });

  await prisma.supplierPurchaseOrder.create({
    data: {
      id: SEED_DATA.poBId,
      supplierId: SEED_DATA.supplierBId,
      status: 'created',
      lines: {
        create: [
          {
            id: 'bb111111-1111-4bbb-8bbb-111111111111',
            skuId: sku1.id,
            requestedQuantity: 25,
            unitCost: 215.0,
            currency: 'EGP',
            status: 'pending',
          },
        ],
      },
    },
  });

  // 7. Write real CSV test fixture for UI upload
  const fixturesDir = path.resolve(__dirname, '../test/fixtures');
  if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });

  const csvContent = [
    'كود_المورد,اسم_المنتج,الباركود,سعر_التكلفة,الحالة',
    'CRV-MOIST-50,CeraVe Moisturizing Cream 50ml,3337875597371,235.00,متوفر',
    'CRV-MOIST-177,CeraVe Moisturizing Cream 177ml,3337875597388,450.00,متوفر',
    'NEW-CANDIDATE-BARRIER,ShinaCare Barrier Recovery Serum 30ml,6221199887766,195.00,متوفر',
  ].join('\n');

  const csvPath = path.join(fixturesDir, 'supplier_catalog_test_fixture.csv');
  fs.writeFileSync(csvPath, csvContent, 'utf8');

  console.log(`Browser E2E fixtures seeded successfully!`);
  console.log(`Test CSV written to: ${csvPath}`);
}

main()
  .catch((e) => {
    console.error('Error seeding browser fixtures:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
