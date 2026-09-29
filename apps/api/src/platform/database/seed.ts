import { PrismaClient, MediaType } from '@prisma/client';

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
  // Create categories (skincare taxonomy)
  // ---------------------------------------------------------------------------
  console.log('Creating categories...');

  // Root categories
  const cleansers = await prisma.category.create({
    data: { name: 'Cleansers', slug: 'cleansers', sortOrder: 1 },
  });
  const moisturizers = await prisma.category.create({
    data: { name: 'Moisturizers', slug: 'moisturizers', sortOrder: 2 },
  });
  const serums = await prisma.category.create({
    data: { name: 'Serums & Treatments', slug: 'serums-treatments', sortOrder: 3 },
  });
  const sunscreens = await prisma.category.create({
    data: { name: 'Sunscreens', slug: 'sunscreens', sortOrder: 4 },
  });
  await prisma.category.createMany({
    data: [
      { name: 'Toners & Essences', slug: 'toners-essences', sortOrder: 5 },
      { name: 'Masks', slug: 'masks', sortOrder: 6 },
      { name: 'Eye Care', slug: 'eye-care', sortOrder: 7 },
    ],
  });

  // Sub-categories — Cleansers
  await prisma.category.createMany({
    data: [
      { name: 'Foaming Cleansers', slug: 'foaming-cleansers', parentId: cleansers.id, sortOrder: 1 },
      { name: 'Oil Cleansers', slug: 'oil-cleansers', parentId: cleansers.id, sortOrder: 2 },
      { name: 'Micellar Water', slug: 'micellar-water', parentId: cleansers.id, sortOrder: 3 },
      { name: 'Cleansing Balms', slug: 'cleansing-balms', parentId: cleansers.id, sortOrder: 4 },
    ],
  });

  // Sub-categories — Moisturizers
  await prisma.category.createMany({
    data: [
      { name: 'Face Creams', slug: 'face-creams', parentId: moisturizers.id, sortOrder: 1 },
      { name: 'Face Lotions', slug: 'face-lotions', parentId: moisturizers.id, sortOrder: 2 },
      { name: 'Body Lotions', slug: 'body-lotions', parentId: moisturizers.id, sortOrder: 3 },
      { name: 'Night Creams', slug: 'night-creams', parentId: moisturizers.id, sortOrder: 4 },
    ],
  });

  // Sub-categories — Serums
  await prisma.category.createMany({
    data: [
      { name: 'Vitamin C Serums', slug: 'vitamin-c-serums', parentId: serums.id, sortOrder: 1 },
      { name: 'Hyaluronic Acid Serums', slug: 'hyaluronic-acid-serums', parentId: serums.id, sortOrder: 2 },
      { name: 'Retinol Treatments', slug: 'retinol-treatments', parentId: serums.id, sortOrder: 3 },
      { name: 'Niacinamide Serums', slug: 'niacinamide-serums', parentId: serums.id, sortOrder: 4 },
    ],
  });

  // Sub-categories — Sunscreens
  await prisma.category.createMany({
    data: [
      { name: 'Face Sunscreens', slug: 'face-sunscreens', parentId: sunscreens.id, sortOrder: 1 },
      { name: 'Body Sunscreens', slug: 'body-sunscreens', parentId: sunscreens.id, sortOrder: 2 },
      { name: 'Tinted Sunscreens', slug: 'tinted-sunscreens', parentId: sunscreens.id, sortOrder: 3 },
    ],
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
- 7 root categories + 14 sub-categories
- 2 products (with categories assigned)
- 3 SKUs
- 2 media items
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
