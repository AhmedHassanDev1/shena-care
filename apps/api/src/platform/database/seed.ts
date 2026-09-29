import { PrismaClient, MediaType, MediaOriginType } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
  console.log('Starting seed process...');

  // Clear existing data (respecting FK order)
  console.log('Clearing existing data...');
  await prisma.sellingPrice.deleteMany({});
  await prisma.listing.deleteMany({});
  await prisma.productMedia.deleteMany({});
  await prisma.sku.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.productLine.deleteMany({});
  await prisma.category.deleteMany({ where: { parentId: { not: null } } });
  await prisma.category.deleteMany({});
  await prisma.brand.deleteMany({});

  // Create brands
  console.log('Creating brands...');
  const cerave = await prisma.brand.create({
    data: {
      name: 'CeraVe',
      slug: 'cerave',
      description: 'Dermatologist-developed skincare with essential ceramides',
      logoUrl: 'https://example.com/brands/cerave-logo.png',
      websiteUrl: 'https://www.cerave.com',
      countryOfOrigin: 'United States',
      isActive: true,
    },
  });

  const lrp = await prisma.brand.create({
    data: {
      name: 'La Roche-Posay',
      slug: 'la-roche-posay',
      description: 'French dermocosmetics brand recommended by dermatologists',
      logoUrl: 'https://example.com/brands/lrp-logo.png',
      websiteUrl: 'https://www.laroche-posay.com',
      countryOfOrigin: 'France',
      isActive: true,
    },
  });

  // Create product lines (Brand lines)
  console.log('Creating product lines...');
  const ceraveMoisturizers = await prisma.productLine.create({
    data: {
      brandId: cerave.id,
      name: 'Daily Moisturizers',
      slug: 'cerave-daily-moisturizers',
      description: 'Essential ceramide-infused daily hydrating care',
      isActive: true,
    },
  });

  const lrpAnthelios = await prisma.productLine.create({
    data: {
      brandId: lrp.id,
      name: 'Anthelios Sun Care',
      slug: 'lrp-anthelios',
      description: 'Advanced UV protection formulated for sensitive skin',
      isActive: true,
    },
  });
  // ---------------------------------------------------------------------------
  // Create categories (Skin Care + Hair Care root taxonomy)
  // ---------------------------------------------------------------------------
  console.log('Creating categories...');

  // Root categories
  const skinCare = await prisma.category.create({
    data: {
      name: 'Skin Care',
      slug: 'skin-care',
      description: 'Facial and body dermatological skincare products',
      sortOrder: 1,
      isActive: true,
    },
  });

  const hairCare = await prisma.category.create({
    data: {
      name: 'Hair Care',
      slug: 'hair-care',
      description: 'Hair care, cleansing, and conditioning treatments',
      sortOrder: 2,
      isActive: true,
    },
  });

  // Leaf categories — Skin Care
  await prisma.category.create({
    data: {
      name: 'Cleansers',
      slug: 'cleansers',
      parentId: skinCare.id,
      sortOrder: 1,
      isActive: true,
    },
  });

  const moisturizers = await prisma.category.create({
    data: {
      name: 'Moisturizers',
      slug: 'moisturizers',
      parentId: skinCare.id,
      sortOrder: 2,
      isActive: true,
    },
  });

  await prisma.category.create({
    data: {
      name: 'Serums & Treatments',
      slug: 'serums-treatments',
      parentId: skinCare.id,
      sortOrder: 3,
      isActive: true,
    },
  });

  const sunscreens = await prisma.category.create({
    data: {
      name: 'Sunscreens',
      slug: 'sunscreens',
      parentId: skinCare.id,
      sortOrder: 4,
      isActive: true,
    },
  });

  // Leaf categories — Hair Care
  await prisma.category.create({
    data: {
      name: 'Shampoos',
      slug: 'shampoos',
      parentId: hairCare.id,
      sortOrder: 1,
      isActive: true,
    },
  });

  await prisma.category.create({
    data: {
      name: 'Conditioners',
      slug: 'conditioners',
      parentId: hairCare.id,
      sortOrder: 2,
      isActive: true,
    },
  });

  await prisma.category.create({
    data: {
      name: 'Hair Treatments',
      slug: 'hair-treatments',
      parentId: hairCare.id,
      sortOrder: 3,
      isActive: true,
    },
  });

  console.log('Categories created ✓');

  // Create products
  console.log('Creating products...');
  const moisturizingCream = await prisma.product.create({
    data: {
      brandId: cerave.id,
      productLineId: ceraveMoisturizers.id,
      categoryId: moisturizers.id,
      name: 'Moisturizing Cream',
      slug: 'cerave-moisturizing-cream',
      description:
        'A rich, non-greasy cream that provides 24-hour hydration. Developed with dermatologists, it contains 3 essential ceramides and hyaluronic acid.',
      usage: 'Apply liberally to face and body as needed. For best results, use after cleansing.',
      warnings:
        'For external use only. Avoid contact with eyes. If irritation develops, discontinue use.',
      isPublished: true,
    },
  });

  const hydratingSunscreen = await prisma.product.create({
    data: {
      brandId: lrp.id,
      productLineId: lrpAnthelios.id,
      categoryId: sunscreens.id,
      name: 'Anthelios Melt-In Milk Sunscreen SPF 60',
      slug: 'lrp-anthelios-sunscreen-spf60',
      description:
        'Fast-absorbing sunscreen with broad spectrum SPF 60 protection. Water-resistant for 80 minutes. Suitable for sensitive skin.',
      usage:
        'Apply generously 15 minutes before sun exposure. Reapply at least every 2 hours and after swimming or sweating.',
      warnings:
        'For external use only. Keep out of eyes. Discontinue use if signs of irritation appear. Keep out of reach of children.',
      isPublished: true,
    },
  });

  // Create SKUs
  console.log('Creating SKUs...');
  const ceraveSmall = await prisma.sku.create({
    data: {
      productId: moisturizingCream.id,
      code: 'CRV-MC-177',
      variantName: '6 oz Jar',
      size: 177,
      sizeUnit: 'ml',
      barcode: '3606000537736',
      isActive: true,
    },
  });

  const ceraveLarge = await prisma.sku.create({
    data: {
      productId: moisturizingCream.id,
      code: 'CRV-MC-539',
      variantName: '19 oz Tub',
      size: 539,
      sizeUnit: 'ml',
      barcode: '3606000537743',
      isActive: true,
    },
  });

  const lrpSunscreen = await prisma.sku.create({
    data: {
      productId: hydratingSunscreen.id,
      code: 'LRP-AH-150',
      variantName: '5 fl oz',
      size: 150,
      sizeUnit: 'ml',
      barcode: '3337875545853',
      isActive: true,
    },
  });

  // Create product media
  console.log('Creating product media...');
  await prisma.productMedia.create({
    data: {
      productId: moisturizingCream.id,
      type: MediaType.image,
      url: 'https://example.com/products/cerave-moisturizing-cream-front.jpg',
      altText: 'CeraVe Moisturizing Cream front view',
      sortOrder: 0,
      isPrimary: true,
      originType: MediaOriginType.verified,
    },
  });

  await prisma.productMedia.create({
    data: {
      productId: hydratingSunscreen.id,
      type: MediaType.image,
      url: 'https://example.com/products/lrp-anthelios-sunscreen-front.jpg',
      altText: 'La Roche-Posay Anthelios Sunscreen front view',
      sortOrder: 0,
      isPrimary: true,
      originType: MediaOriginType.verified,
    },
  });

  // Create listings
  console.log('Creating listings...');
  await prisma.listing.create({
    data: { skuId: ceraveSmall.id, isListed: true, listedAt: new Date() },
  });

  await prisma.listing.create({
    data: { skuId: ceraveLarge.id, isListed: true, listedAt: new Date() },
  });

  await prisma.listing.create({
    data: { skuId: lrpSunscreen.id, isListed: true, listedAt: new Date() },
  });

  // Create selling prices
  console.log('Creating selling prices...');
  await prisma.sellingPrice.create({
    data: {
      skuId: ceraveSmall.id,
      amount: 15.99,
      currency: 'USD',
      compareAtAmount: 19.99,
      validFrom: new Date(),
      isActive: true,
    },
  });

  await prisma.sellingPrice.create({
    data: {
      skuId: ceraveLarge.id,
      amount: 24.99,
      currency: 'USD',
      compareAtAmount: 29.99,
      validFrom: new Date(),
      isActive: true,
    },
  });

  await prisma.sellingPrice.create({
    data: {
      skuId: lrpSunscreen.id,
      amount: 35.99,
      currency: 'USD',
      validFrom: new Date(),
      isActive: true,
    },
  });

  console.log('Seed completed successfully!');
  console.log(`
Created:
- 2 brands (CeraVe, La Roche-Posay)
- 2 product lines
- 2 root categories (Skin Care, Hair Care) + 7 leaf categories
- 2 products (with leaf categories assigned)
- 3 SKUs
- 2 media items (verified origin)
- 3 listings
- 3 prices

You can now:
1. Start the API: cd apps/api && npm run dev
2. Test endpoints:
   - GET http://localhost:3001/products
   - GET http://localhost:3001/products/cerave-moisturizing-cream
   - GET http://localhost:3001/products/lrp-anthelios-sunscreen-spf60
  `);
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
