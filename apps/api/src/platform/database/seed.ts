import { PrismaClient, MediaType, MediaOriginType } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
  console.log('Starting safe seed process...');

  // 1. Brands
  const eva = await prisma.brand.upsert({
    where: { slug: 'eva-cosmetics' },
    update: {},
    create: { name: 'Eva Cosmetics', slug: 'eva-cosmetics', description: 'Eva Skin Clinic products', websiteUrl: 'https://eva-cosmetics.com', countryOfOrigin: 'Egypt', isActive: true },
  });
  const starville = await prisma.brand.upsert({
    where: { slug: 'starville' },
    update: {},
    create: { name: 'StarVille', slug: 'starville', description: 'Dermatological skincare by Parkville', websiteUrl: 'https://parkville.com.eg', countryOfOrigin: 'Egypt', isActive: true },
  });
  const hairAddict = await prisma.brand.upsert({
    where: { slug: 'the-hair-addict' },
    update: {},
    create: { name: 'The Hair Addict', slug: 'the-hair-addict', description: 'Natural hair care for curls and frizz', websiteUrl: 'https://thehairaddict.net', countryOfOrigin: 'Egypt', isActive: true },
  });
  const bless = await prisma.brand.upsert({
    where: { slug: 'bless' },
    update: {},
    create: { name: 'BLESS', slug: 'bless', description: 'Bless hair care products', websiteUrl: 'https://blessbotanicals.com', countryOfOrigin: 'Egypt', isActive: true },
  });

  const cerave = await prisma.brand.upsert({
    where: { slug: 'cerave' },
    update: {},
    create: { name: 'CeraVe', slug: 'cerave', description: 'CeraVe Skincare', websiteUrl: 'https://cerave.com', countryOfOrigin: 'USA', isActive: true },
  });

  // 2. Lines
  const evaVitC = await prisma.productLine.upsert({ where: { slug: 'eva-vitamin-c' }, update: {}, create: { brandId: eva.id, name: 'Vitamin C', slug: 'eva-vitamin-c', isActive: true }});
  const evaHyaluronic = await prisma.productLine.upsert({ where: { slug: 'eva-hyaluronic-acid' }, update: {}, create: { brandId: eva.id, name: 'Hyaluronic Acid', slug: 'eva-hyaluronic-acid', isActive: true }});
  const evaAcne = await prisma.productLine.upsert({ where: { slug: 'eva-acne-prone-skin' }, update: {}, create: { brandId: eva.id, name: 'Acne-Prone Skin', slug: 'eva-acne-prone-skin', isActive: true }});
  const evaCollagen = await prisma.productLine.upsert({ where: { slug: 'eva-collagen' }, update: {}, create: { brandId: eva.id, name: 'Collagen', slug: 'eva-collagen', isActive: true }});

  const svAcne = await prisma.productLine.upsert({ where: { slug: 'starville-acne-prone' }, update: {}, create: { brandId: starville.id, name: 'Acne Prone', slug: 'starville-acne-prone', isActive: true }});
  const svWhitening = await prisma.productLine.upsert({ where: { slug: 'starville-whitening' }, update: {}, create: { brandId: starville.id, name: 'Whitening', slug: 'starville-whitening', isActive: true }});

  const haFrizzOff = await prisma.productLine.upsert({ where: { slug: 'ha-frizz-off' }, update: {}, create: { brandId: hairAddict.id, name: 'Frizz Off', slug: 'ha-frizz-off', isActive: true }});
  const haLoveBond = await prisma.productLine.upsert({ where: { slug: 'ha-lovebond' }, update: {}, create: { brandId: hairAddict.id, name: 'LoveBond', slug: 'ha-lovebond', isActive: true }});

  const blessActivator = await prisma.productLine.upsert({ where: { slug: 'bless-activator' }, update: {}, create: { brandId: bless.id, name: 'Activator', slug: 'bless-activator', isActive: true }});

  const ceraveMoisturizers = await prisma.productLine.upsert({ where: { slug: 'cerave-daily-moisturizers' }, update: {}, create: { brandId: cerave.id, name: 'Daily Moisturizers', slug: 'cerave-daily-moisturizers', isActive: true }});

  // 3. Categories
  const skinCare = await prisma.category.upsert({ where: { slug: 'skin-care' }, update: {}, create: { name: 'Skin Care', slug: 'skin-care', sortOrder: 1, isActive: true }});
  const hairCare = await prisma.category.upsert({ where: { slug: 'hair-care' }, update: {}, create: { name: 'Hair Care', slug: 'hair-care', sortOrder: 2, isActive: true }});

  const cleansers = await prisma.category.upsert({ where: { slug: 'cleansers' }, update: {}, create: { name: 'Cleansers', slug: 'cleansers', parentId: skinCare.id, sortOrder: 1, isActive: true }});
  const moisturizers = await prisma.category.upsert({ where: { slug: 'moisturizers' }, update: {}, create: { name: 'Moisturizers', slug: 'moisturizers', parentId: skinCare.id, sortOrder: 2, isActive: true }});
  const serums = await prisma.category.upsert({ where: { slug: 'serums-treatments' }, update: {}, create: { name: 'Serums & Treatments', slug: 'serums-treatments', parentId: skinCare.id, sortOrder: 3, isActive: true }});
  const sunscreens = await prisma.category.upsert({ where: { slug: 'sunscreens' }, update: {}, create: { name: 'Sunscreens', slug: 'sunscreens', parentId: skinCare.id, sortOrder: 4, isActive: true }});

  const shampoos = await prisma.category.upsert({ where: { slug: 'shampoos' }, update: {}, create: { name: 'Shampoos', slug: 'shampoos', parentId: hairCare.id, sortOrder: 1, isActive: true }});
  const conditioners = await prisma.category.upsert({ where: { slug: 'conditioners' }, update: {}, create: { name: 'Conditioners', slug: 'conditioners', parentId: hairCare.id, sortOrder: 2, isActive: true }});
  const hairTreatments = await prisma.category.upsert({ where: { slug: 'hair-treatments-styling' }, update: {}, create: { name: 'Hair Treatments & Styling', slug: 'hair-treatments-styling', parentId: hairCare.id, sortOrder: 3, isActive: true }});

  // 4. Products Data
  const defaultSupplier = await prisma.supplier.upsert({ where: { slug: 'official-distributor' }, update: {}, create: { name: 'Official Distributor', slug: 'official-distributor', isActive: true }});

  const productsData = [
    {
      brandId: cerave.id, lineId: ceraveMoisturizers.id, catId: moisturizers.id,
      name: 'CeraVe Moisturizing Cream', slug: 'cerave-moisturizing-cream', size: 453, unit: 'gm', code: 'CERAVE-CREAM-453', barcode: '123456789012',
      price: 450.00, url: 'https://cdn.shopify.com/s/files/1/cerave.png',
      desc: 'CeraVe Moisturizing Cream for dry skin.'
    },
    {
      brandId: cerave.id, lineId: ceraveMoisturizers.id, catId: moisturizers.id,
      name: 'CeraVe Hydrating Lotion', slug: 'cerave-hydrating-lotion', size: 236, unit: 'ml', code: 'CERAVE-LOTION-236', barcode: '123456789013',
      price: 350.00, url: 'https://cdn.shopify.com/s/files/1/cerave-lotion.png',
      desc: 'CeraVe Hydrating Lotion for dry to very dry skin.'
    },
    {
      brandId: eva.id, lineId: evaVitC.id, catId: cleansers.id,
      name: 'Eva Skin Clinic Vitamin C Facial Wash And Exfoliator', slug: 'eva-vitc-wash-150', size: 150, unit: 'ml', code: 'EVA-VITC-WASH', barcode: '6223004561234',
      price: 130.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/natural_glow_white_bg_1.png?v=1776525610',
      desc: 'Eva Skin Clinic Vitamin C Facial Wash and Exfoliator. Foaming wash for cleansing and exfoliating.'
    },
    {
      brandId: eva.id, lineId: evaVitC.id, catId: serums.id,
      name: 'Eva Skin Clinic Vitamin C Facial Serum', slug: 'eva-vitc-serum-20', size: 20, unit: 'ml', code: 'EVA-VITC-SRM', barcode: null,
      price: 195.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/wcHFTmu0gN2mjlCA63qBR9wZIhrZQe2xxOGs2dVB.webp?v=1759434403',
      desc: 'Eva Skin Clinic Vitamin C Facial Serum. For a brighter complexion.'
    },
    {
      brandId: eva.id, lineId: evaHyaluronic.id, catId: serums.id,
      name: 'Eva Skin Clinic Hyaluronic Acid Facial Serum', slug: 'eva-ha-serum-30', size: 30, unit: 'ml', code: 'EVA-HA-SRM', barcode: null,
      price: 220.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/91856.jpg?v=1767721058',
      desc: 'Eva Skin Clinic Hyaluronic Acid Facial Serum for hydration.'
    },
    {
      brandId: eva.id, lineId: evaHyaluronic.id, catId: moisturizers.id,
      name: 'Eva Skin Clinic Hyaluronic Acid Day Gel', slug: 'eva-ha-day-gel-45', size: 45, unit: 'ml', code: 'EVA-HA-GEL', barcode: null,
      price: 165.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/eJ0Dx8MnR5TGQByLZLR8kU7Au0KkIlJD60v7jSX9.webp?v=1759692431',
      desc: 'Eva Skin Clinic Hyaluronic Acid Day Gel for daily hydration.'
    },
    {
      brandId: eva.id, lineId: evaAcne.id, catId: cleansers.id,
      name: 'Eva Skin Clinic Acne-Prone Skin "Fresh Restart" Facial Wash', slug: 'eva-acne-wash-150', size: 150, unit: 'ml', code: 'EVA-ACNE-WASH', barcode: null,
      price: 140.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/natural_glow_white_bg_1.png?v=1776525610',
      desc: 'Eva Skin Clinic Acne-Prone Skin Fresh Restart Facial Wash.'
    },
    {
      brandId: eva.id, lineId: evaAcne.id, catId: sunscreens.id,
      name: 'Eva Skin Clinic Acne-Prone Skin Sunscreen SPF 50+', slug: 'eva-acne-sunscreen-40', size: 40, unit: 'ml', code: 'EVA-ACNE-SPF', barcode: null,
      price: 180.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/eJ0Dx8MnR5TGQByLZLR8kU7Au0KkIlJD60v7jSX9.webp?v=1759692431',
      desc: 'Eva Skin Clinic Acne-Prone Skin Sunscreen SPF 50+.'
    },
    {
      brandId: eva.id, lineId: evaCollagen.id, catId: cleansers.id,
      name: 'Eva Skin Clinic Anti-Ageing Collagen Facial Wash', slug: 'eva-collagen-wash-150', size: 150, unit: 'ml', code: 'EVA-COL-WASH', barcode: null,
      price: 135.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/DKahM3hCkfl60u6I2OkFdPCpC8asK4UjMBIkKWOh.webp?v=1759434293',
      desc: 'Eva Skin Clinic Anti-Ageing Collagen Facial Wash.'
    },
    {
      brandId: eva.id, lineId: evaCollagen.id, catId: moisturizers.id,
      name: 'Eva Skin Clinic Anti-Ageing Collagen Fine Lines Filler (+30)', slug: 'eva-collagen-filler-50', size: 50, unit: 'ml', code: 'EVA-COL-FILL', barcode: null,
      price: 210.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/pFcjqe2VVqhd75VTkbV2QwfY6qOtH8vxIyXVT6An.webp?v=1759692407',
      desc: 'Eva Skin Clinic Anti-Ageing Collagen Fine Lines Filler.'
    },
    // StarVille
    {
      brandId: starville.id, lineId: svAcne.id, catId: cleansers.id,
      name: 'StarVille Acne Prone Skin Facial Cleanser', slug: 'sv-acne-cleanser-200', size: 200, unit: 'ml', code: 'SV-ACNE-WASH', barcode: null,
      price: 175.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/eJ0Dx8MnR5TGQByLZLR8kU7Au0KkIlJD60v7jSX9.webp?v=1759692431',
      desc: 'StarVille Acne Prone Skin Facial Cleanser.'
    },
    {
      brandId: starville.id, lineId: svAcne.id, catId: moisturizers.id,
      name: 'StarVille Acne Prone Skin Cream', slug: 'sv-acne-cream-60', size: 60, unit: 'gm', code: 'SV-ACNE-CRM', barcode: null,
      price: 120.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/natural_glow_white_bg_1.png?v=1776525610',
      desc: 'StarVille Acne Prone Skin Cream.'
    },
    {
      brandId: starville.id, lineId: svWhitening.id, catId: cleansers.id,
      name: 'StarVille Whitening Cleanser', slug: 'sv-whitening-cleanser-200', size: 200, unit: 'ml', code: 'SV-WHT-WASH', barcode: null,
      price: 185.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/94349.jpg?v=1791198961',
      desc: 'StarVille Whitening Cleanser.'
    },
    {
      brandId: starville.id, lineId: svWhitening.id, catId: moisturizers.id,
      name: 'StarVille Whitening Cream', slug: 'sv-whitening-cream-60', size: 60, unit: 'gm', code: 'SV-WHT-CRM', barcode: null,
      price: 150.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/94349.jpg?v=1791198961',
      desc: 'StarVille Whitening Cream.'
    },
    // The Hair Addict
    {
      brandId: hairAddict.id, lineId: haFrizzOff.id, catId: shampoos.id,
      name: 'Frizz Off Shampoo', slug: 'ha-frizz-off-shampoo-250', size: 250, unit: 'ml', code: 'HA-FRIZZ-SHMP', barcode: null,
      price: 250.00, url: 'https://cdn.shopify.com/s/files/1/0817/6844/8214/files/MEN-SHAMPOO.jpg?v=1779303199',
      desc: 'Frizz Off Shampoo.'
    },
    {
      brandId: hairAddict.id, lineId: haFrizzOff.id, catId: conditioners.id,
      name: 'Frizz Off Conditioner', slug: 'ha-frizz-off-cond-250', size: 250, unit: 'ml', code: 'HA-FRIZZ-COND', barcode: null,
      price: 250.00, url: 'https://cdn.shopify.com/s/files/1/0817/6844/8214/files/Tubes-Mockups-1_page-0003.jpg?v=1779303177',
      desc: 'Frizz Off Conditioner.'
    },
    {
      brandId: hairAddict.id, lineId: haFrizzOff.id, catId: hairTreatments.id,
      name: 'Frizz Off Leave-In Conditioner', slug: 'ha-frizz-off-leavein-250', size: 250, unit: 'ml', code: 'HA-FRIZZ-LEAVEIN', barcode: null,
      price: 280.00, url: 'https://cdn.shopify.com/s/files/1/0817/6844/8214/files/Tubes-Mockups-1_page-0003.jpg?v=1779303177',
      desc: 'Frizz Off Leave-In Conditioner.'
    },
    {
      brandId: hairAddict.id, lineId: haLoveBond.id, catId: shampoos.id,
      name: 'LoveBond Shampoo', slug: 'ha-lovebond-shampoo-250', size: 250, unit: 'ml', code: 'HA-LB-SHMP', barcode: null,
      price: 290.00, url: 'https://cdn.shopify.com/s/files/1/0817/6844/8214/files/dsdsd.webp?v=1779303211',
      desc: 'LoveBond Shampoo.'
    },
    {
      brandId: hairAddict.id, lineId: haLoveBond.id, catId: conditioners.id,
      name: 'LoveBond Conditioner', slug: 'ha-lovebond-cond-250', size: 250, unit: 'ml', code: 'HA-LB-COND', barcode: null,
      price: 290.00, url: 'https://cdn.shopify.com/s/files/1/0817/6844/8214/files/CONDITIONER-mockup-scaled.jpg?v=1779303211',
      desc: 'LoveBond Conditioner.'
    },
    // BLESS
    {
      brandId: bless.id, lineId: blessActivator.id, catId: shampoos.id,
      name: 'Activator Shampoo', slug: 'bless-activator-shampoo-300', size: 300, unit: 'ml', code: 'BLESS-ACT-SHMP', barcode: null,
      price: 155.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/94347.jpg?v=1791198934',
      desc: 'Activator Shampoo.'
    },
    {
      brandId: bless.id, lineId: blessActivator.id, catId: conditioners.id,
      name: 'Activator Conditioner', slug: 'bless-activator-cond-300', size: 300, unit: 'ml', code: 'BLESS-ACT-COND', barcode: null,
      price: 155.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/94348.jpg?v=1791198910',
      desc: 'Activator Conditioner.'
    },
    {
      brandId: bless.id, lineId: blessActivator.id, catId: hairTreatments.id,
      name: 'Activator Defining Cream', slug: 'bless-activator-cream-250', size: 250, unit: 'ml', code: 'BLESS-ACT-CRM', barcode: null,
      price: 185.00, url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/94349.jpg?v=1791198961',
      desc: 'Activator Defining Cream.'
    }
  ];

  for (const pd of productsData) {
    const prod = await prisma.product.upsert({
      where: { slug: pd.slug },
      update: {
        description: pd.desc
      },
      create: {
        brandId: pd.brandId,
        productLineId: pd.lineId,
        categoryId: pd.catId,
        name: pd.name,
        slug: pd.slug,
        description: pd.desc,
        isPublished: true,
      }
    });

    const sku = await prisma.sku.upsert({
      where: { code: pd.code },
      update: {
        barcode: pd.barcode
      },
      create: {
        productId: prod.id,
        code: pd.code,
        variantName: `${pd.size} ${pd.unit}`,
        size: pd.size,
        sizeUnit: pd.unit,
        barcode: pd.barcode,
        isActive: true,
      }
    });

    // Handle media (avoiding duplicates)
    const existingMedia = await prisma.productMedia.findFirst({
      where: { productId: prod.id, url: pd.url }
    });
    
    if (!existingMedia) {
      await prisma.productMedia.create({
        data: {
          productId: prod.id,
          type: MediaType.image,
          url: pd.url,
          altText: `${pd.name} front view`,
          sortOrder: 0,
          isPrimary: true,
          originType: MediaOriginType.verified,
        }
      });
    }

    await prisma.listing.upsert({
      where: { skuId: sku.id },
      update: {},
      create: { skuId: sku.id, isListed: true, listedAt: new Date() }
    });

    // SellingPrice doesn't have a unique constraint on skuId alone, it's just id
    // We can findFirst and update, or create
    const existingPrice = await prisma.sellingPrice.findFirst({
      where: { skuId: sku.id, isActive: true }
    });
    
    if (!existingPrice) {
      await prisma.sellingPrice.create({
        data: {
          skuId: sku.id,
          amount: pd.price,
          currency: 'EGP',
          compareAtAmount: pd.price * 1.2,
          validFrom: new Date(),
          isActive: true,
        }
      });
    } else {
      await prisma.sellingPrice.update({
        where: { id: existingPrice.id },
        data: { amount: pd.price }
      });
    }

    const existingOffer = await prisma.supplierOffer.findFirst({
      where: { supplierId: defaultSupplier.id, skuId: sku.id }
    });
    
    if (!existingOffer) {
      await prisma.supplierOffer.create({
        data: {
          supplierId: defaultSupplier.id,
          skuId: sku.id,
          costPrice: pd.price * 0.7,
          currency: 'EGP',
          isAvailable: true,
          lastConfirmedAt: new Date()
        }
      });
    } else {
      await prisma.supplierOffer.update({
        where: { id: existingOffer.id },
        data: { costPrice: pd.price * 0.7 }
      });
    }
  }

  console.log('Seed completed successfully!');
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
