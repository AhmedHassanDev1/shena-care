/**
 * UI/UX test seed for the product page (owner-approved 2026-11-08, Supabase DEVELOPMENT project).
 *
 *   npx ts-node --transpile-only scripts/ui-test-seed-pdp.ts --apply     # write the seed
 *   npx ts-node --transpile-only scripts/ui-test-seed-pdp.ts --cleanup   # remove it and restore previous facts
 *   npx ts-node --transpile-only scripts/ui-test-seed-pdp.ts             # read-only fingerprint
 *
 * Everything carries TAG: reviews (commerce.product_reviews.source), one ingestion job (source_key) whose published
 * items hold the Arabic content review, and fact columns on three catalog products (previous values saved in the
 * manifest). Real data: the Arabic name/description are translations of Eva's official product pages (source-linked).
 * Test data: ingredients, usage, warnings, suitability facts and all reviews — sourceType UI_TEST_SEED.
 * Uses PrismaClient directly (no Nest app), so no background worker starts against the database.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PrismaClient, Prisma } from '@prisma/client';

const TAG = 'ui-test-seed-2026-11-08';
const OUT = join(__dirname, '..', '..', '..', 'output', 'pdp-ui-seed-2026-11-08');
const MANIFEST = join(OUT, 'manifest.json');
const prisma = new PrismaClient();

type Fields = { name: string; description: string; ingredients: string; usage: string; warnings: string };
interface Target {
  skuId: string;
  url: string;
  facts: Prisma.ProductUpdateInput;
  content: Fields;
  reviews: Array<[rating: number, author: string, skin: string | null, verified: boolean, helpful: number, daysAgo: number, title: string | null, body: string]>;
}

const WARN = 'للاستخدام الخارجي فقط.\nتجنّبي ملامسة العينين، ولو حصل اشطفيها بمية كتير.\nاعملي اختبار حساسية على جزء صغير من البشرة قبل أول استخدام.\nيُحفظ بعيدًا عن متناول الأطفال وفي مكان بارد وجاف.';

const TARGETS: Target[] = [
  {
    skuId: 'cc0f29bc-da23-4378-986d-417c4db2e0de',
    url: 'https://www.shop.eva-cosmetics.com/products/eva-skin-clinic-hyaluronic-acid-facial-serum-30-ml',
    facts: { suitableSkinTypes: ['normal', 'dry', 'combination', 'sensitive'], isFragranceFree: true, isNonComedogenic: true },
    content: {
      name: 'سيروم هيالورونيك أسيد للوجه',
      description: 'سيروم بتركيز 1.5% هيالورونيك أسيد لبشرة ممتلئة ومشدودة ومرطّبة.',
      ingredients: 'Aqua, Glycerin, Sodium Hyaluronate, Hydrolyzed Hyaluronic Acid, Propylene Glycol, Panthenol, Allantoin, Carbomer, Triethanolamine, Phenoxyethanol, Ethylhexylglycerin, Disodium EDTA',
      usage: 'نظّفي البشرة ونشّفيها بلطف.\nضعي 2-3 نقط من السيروم على الوش والرقبة.\nدلّكي بحركات خفيفة لحد ما يتشرّب.\nكمّلي بالمرطّب، واستخدمي واقي الشمس الصبح.',
      warnings: WARN,
    },
    reviews: [
      [5, 'مريم أ.', 'combination', true, 24, 6, 'ترطيب من أول أسبوع', 'خفيف جدًا وبيتشرب بسرعة، ومش بيسيب أي لمعة. بشرتي بقت ممتلئة أكتر وخطوط الجفاف حوالين العين خفّت.'],
      [5, 'نورهان س.', 'dry', true, 18, 12, 'أحسن سيروم جربته بالسعر ده', 'بشرتي جافة جدًا في الشتا، وبعد أسبوعين استخدام صبح وليل الفرق باين. بحطه قبل المرطب على طول.'],
      [4, 'سلمى م.', 'sensitive', true, 11, 19, null, 'بشرتي حساسة ومعملش أي احمرار. نزلت نجمة بس عشان العبوة صغيرة وبتخلص بسرعة.'],
      [5, 'هبة ع.', 'normal', false, 9, 23, 'يستاهل', 'قوامه مية تقريبًا ومش لزج، وبيعمل أساس كويس قبل المكياج.'],
      [3, 'دينا ك.', 'oily', true, 6, 31, 'كويس بس مش ليا', 'الترطيب كويس، بس بشرتي دهنية وحسيت إنه محتاج يتشرب وقت أطول في الصيف.'],
      [5, 'ياسمين ر.', 'combination', true, 14, 37, null, 'تالت عبوة أشتريها. بستخدمه مع واقي الشمس الصبح ومفيش أي تكتّل.'],
      [4, 'آية ح.', 'dry', false, 4, 44, 'نتيجة لطيفة', 'بيدي نضارة حلوة، كنت أتمنى النتيجة تبان أسرع شوية بس عمومًا راضية.'],
      [5, 'منة ط.', 'sensitive', true, 8, 52, null, 'من غير ريحة، وده أهم حاجة لبشرتي. مفيش أي حكة أو حبوب.'],
      [2, 'رنا ف.', 'oily', false, 3, 60, 'مش مناسب للبشرة الدهنية', 'حسيت إنه زوّد اللمعة عندي في نص اليوم. ممكن يكون أنسب للبشرة الجافة.'],
      [5, 'شيماء ل.', 'normal', true, 12, 67, 'روتيني الأساسي', 'بقى خطوة ثابتة في روتيني. البشرة طرية طول اليوم.'],
      [4, 'فرح ج.', 'combination', true, 5, 75, null, 'كويس جدًا، بس القطارة محتاجة تكون أدق شوية.'],
      [5, 'ملك ز.', 'dry', true, 7, 88, 'فرق واضح', 'التقشير اللي كان عندي حوالين الأنف اختفى تقريبًا بعد شهر.'],
    ],
  },
  {
    skuId: '0570d6ae-ed1c-49c0-a729-f09b21df4259',
    url: 'https://www.shop.eva-cosmetics.com/products/eva-skin-clinic-hyaluronic-acid-facial-wash-160-ml',
    facts: { texture: 'GEL', suitableSkinTypes: ['normal', 'dry', 'combination'] },
    content: {
      name: 'غسول هيالورونيك أسيد للوجه',
      description: 'تركيبة لطيفة خالية من الصابون، مصمّمة خصيصًا لتنظيف البشرة وترطيبها.',
      ingredients: 'Aqua, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Glycerin, Sodium Hyaluronate, Panthenol, Sodium Chloride, Citric Acid, Sodium Benzoate, Parfum',
      usage: 'بلّلي الوش بمية فاترة.\nحطّي كمية صغيرة على إيدك واعملي رغوة خفيفة.\nدلّكي البشرة بحركات دائرية لمدة 30 ثانية.\nاشطفي كويس ونشّفي بفوطة نضيفة.',
      warnings: WARN,
    },
    reviews: [
      [5, 'سارة ن.', 'dry', true, 15, 9, 'مش بيشد البشرة', 'أول غسول ميخليش وشي مشدود بعد الشطف. رغوته خفيفة وريحته هادية.'],
      [4, 'هالة م.', 'combination', true, 8, 16, null, 'بينضف كويس من غير ما ينشّف. بستخدمه الصبح وبالليل بغسول تاني للمكياج.'],
      [5, 'جنى ع.', 'normal', false, 6, 27, 'عملي جدًا', 'العبوة بتعيش معايا أكتر من شهرين، وسعرها معقول.'],
      [3, 'إسراء ح.', 'oily', true, 4, 39, null, 'لطيف بس مش كفاية لبشرتي الدهنية في الصيف، بحتاج غسول أقوى.'],
      [5, 'ندى ب.', 'dry', true, 10, 50, 'مناسب للشتا', 'بشرتي بتتقشر في الشتا، والغسول ده مزودش المشكلة خالص.'],
      [4, 'لمى ص.', 'combination', false, 2, 71, null, 'كويس، كنت أتمنى يكون من غير عطر.'],
    ],
  },
  {
    skuId: '33785e08-995b-4d18-a5b8-64945c7912b9',
    url: 'https://www.shop.eva-cosmetics.com/products/eva-skin-clinic-hyaluronic-acid-micellar-water-200-ml',
    facts: { texture: 'LIQUID', targetArea: 'FACE', suitableSkinTypes: ['normal', 'dry', 'oily', 'combination', 'sensitive'] },
    content: {
      name: 'مِسيلار ووتر بالهيالورونيك أسيد',
      description: 'تركيبة فريدة بتشيل المكياج وشوائب البشرة وتسيبها مرطّبة بفضل مزيج من المكونات الفعّالة.',
      ingredients: 'Aqua, Hexylene Glycol, Glycerin, Poloxamer 184, Sodium Hyaluronate, Panthenol, Disodium EDTA, Phenoxyethanol, Ethylhexylglycerin',
      usage: 'بلّلي قطنة بالمِسيلار ووتر.\nامسحي الوش والعينين بلطف من غير فرك.\nكرّري لحد ما القطنة تطلع نضيفة.\nمش محتاجة شطف بعدها.',
      warnings: WARN,
    },
    reviews: [
      [5, 'روان ك.', 'sensitive', true, 13, 5, 'بيشيل الماسكرا بسهولة', 'بيشيل المكياج كله من أول مسحة ومش بيحرق العين.'],
      [4, 'مها د.', 'combination', true, 7, 21, null, 'ممتاز للمكياج الخفيف، المكياج الووتربروف محتاج مسحتين تلاتة.'],
      [5, 'أمل ي.', 'dry', false, 5, 34, 'بقى أساسي في شنطتي', 'بستخدمه بعد الجيم وفي السفر، البشرة بتفضل مرطبة.'],
      [4, 'تقى ر.', 'oily', true, 3, 58, null, 'كويس ومش بيسيب طبقة دهنية، بس بفضّل أغسل بعده.'],
    ],
  },
];

async function fingerprint() {
  const q = async (sql: string) => (await prisma.$queryRawUnsafe<Array<{ n: bigint; h: string | null }>>(sql))[0];
  const rows = {
    product_reviews: await q(`SELECT count(*) n, md5(string_agg(t::text, '|' ORDER BY id)) h FROM commerce.product_reviews t`),
    ingestion_jobs: await q(`SELECT count(*) n, md5(string_agg(t::text, '|' ORDER BY id)) h FROM ingestion.ingestion_jobs t`),
    ingestion_items: await q(`SELECT count(*) n, md5(string_agg(t::text, '|' ORDER BY id)) h FROM ingestion.ingestion_items t`),
    catalog_products: await q(`SELECT count(*) n, md5(string_agg(t::text, '|' ORDER BY id)) h FROM catalog.products t`),
  };
  return Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { count: Number(v.n), md5: v.h }]));
}

async function apply() {
  if (existsSync(MANIFEST)) throw new Error(`Seed already applied (${MANIFEST}); run --cleanup first.`);
  const before = await fingerprint();
  const supplier = await prisma.supplier.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!supplier) throw new Error('No supplier to own the seed ingestion job');
  const reviewedAt = new Date().toISOString();
  const manifest: Record<string, unknown> = { tag: TAG, appliedAt: reviewedAt, before, products: [] as unknown[] };

  await prisma.$transaction(async (tx) => {
    const job = await tx.ingestionJob.create({
      data: { supplierId: supplier.id, status: 'published', sourceKey: TAG, sourceFileName: `${TAG}.json`, uploadedBy: 'ui-test-seed', sourceMetadata: { purpose: 'PDP UI/UX test seed', tag: TAG } },
    });
    manifest.jobId = job.id;
    for (const target of TARGETS) {
      const sku = await tx.sku.findUniqueOrThrow({ where: { id: target.skuId }, include: { product: { include: { brand: true } } } });
      const product = sku.product;
      const previous = { texture: product.texture, targetArea: product.targetArea, suitableSkinTypes: product.suitableSkinTypes, isFragranceFree: product.isFragranceFree, isNonComedogenic: product.isNonComedogenic };
      await tx.product.update({ where: { id: product.id }, data: target.facts });

      const official = (field: keyof Fields) => ({ field, value: target.content[field], sourceUrl: target.url, sourceType: 'OFFICIAL_MANUFACTURER_TRANSLATED' });
      const test = (field: keyof Fields) => ({ field, value: target.content[field], sourceUrl: `${target.url}#${TAG}`, sourceType: 'UI_TEST_SEED' });
      const identity = { barcode: sku.barcode, name: product.name, brand: product.brand.name, size: sku.size ? sku.size.toNumber() : null, sizeUnit: sku.sizeUnit, variantName: sku.variantName };
      const item = await tx.ingestionItem.create({
        data: {
          jobId: job.id, supplierSkuCode: `${TAG}:${sku.code}`, name: product.name, brand: product.brand.name, barcode: sku.barcode,
          price: 0, currency: 'EGP', status: 'published', matchedSkuId: sku.id, enrichmentStatus: 'succeeded',
          enrichment: { contentReview: { language: 'ar', reviewedAt, reviewer: TAG, identity, fields: [official('name'), official('description'), test('ingredients'), test('usage'), test('warnings')] } },
        },
      });

      const now = Date.now();
      const reviews = target.reviews.map(([rating, authorName, skinType, isVerifiedPurchase, helpfulCount, daysAgo, title, body]) => ({
        productId: product.id, skuId: sku.id, rating, authorName, skinType, isVerifiedPurchase, helpfulCount, title, body,
        status: 'PUBLISHED' as const, source: TAG, createdAt: new Date(now - daysAgo * 86_400_000),
      }));
      await tx.productReview.createMany({ data: reviews });
      (manifest.products as unknown[]).push({ productId: product.id, skuId: sku.id, ingestionItemId: item.id, previousFacts: previous, appliedFacts: target.facts, reviews: reviews.length });
    }
  }, { timeout: 60_000 });

  manifest.after = await fingerprint();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ applied: true, manifest: MANIFEST, before: manifest.before, after: manifest.after }, null, 2));
}

async function cleanup() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const before = await fingerprint();
  await prisma.$transaction(async (tx) => {
    const reviews = await tx.productReview.deleteMany({ where: { source: TAG } });
    const items = await tx.ingestionItem.deleteMany({ where: { job: { sourceKey: TAG } } });
    const jobs = await tx.ingestionJob.deleteMany({ where: { sourceKey: TAG } });
    for (const p of manifest.products) await tx.product.update({ where: { id: p.productId }, data: p.previousFacts });
    console.log(JSON.stringify({ deleted: { reviews: reviews.count, items: items.count, jobs: jobs.count }, restoredProducts: manifest.products.length }));
  }, { timeout: 60_000 });
  const after = await fingerprint();
  const matches = (['product_reviews', 'ingestion_jobs', 'ingestion_items'] as const).every((k) => after[k].count === manifest.before[k].count && after[k].md5 === manifest.before[k].md5);
  writeFileSync(join(OUT, 'cleanup.json'), JSON.stringify({ cleanedAt: new Date().toISOString(), before, after, matchesPreSeed: matches }, null, 2));
  console.log(JSON.stringify({ matchesPreSeedFingerprint: matches, note: 'catalog.products differs only by updated_at on the 3 restored rows' }));
}

(async () => {
  try {
    if (process.argv.includes('--apply')) await apply();
    else if (process.argv.includes('--cleanup')) await cleanup();
    else console.log(JSON.stringify(await fingerprint(), null, 2));
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

