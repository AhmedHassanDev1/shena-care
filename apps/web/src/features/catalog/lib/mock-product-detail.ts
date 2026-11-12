import type { ProductDetail, PublicVariant, ProductReview, ProductReviewSummary } from '../api/discovery';

export const MOCK_STARVILLE_VARIANTS: PublicVariant[] = [
  {
    id: 'sku-starville-50ml',
    code: 'SV-NIA-50',
    barcode: '6224001234567',
    variantName: '50 مل',
    size: 50,
    sizeUnit: 'ml',
    price: {
      amount: 450,
      currency: 'EGP',
      compareAtAmount: 520,
    },
    isAvailable: true,
    canOrder: true,
    availability: {
      isAvailable: true,
      isFresh: true,
      confirmedAt: new Date().toISOString(),
      observedAt: new Date().toISOString(),
      validUntil: null,
    },
    media: [
      {
        id: 'media-sv-1',
        skuId: 'sku-starville-50ml',
        type: 'IMAGE',
        url: '/assets/products/sahel-serum-clearpack.png',
        altText: 'سيروم النياسيناميد 10% - العبوة الأساسية',
        sortOrder: 0,
        isPrimary: true,
        originType: 'PRIMARY',
        role: 'PRIMARY',
      },
      {
        id: 'media-sv-2',
        skuId: 'sku-starville-50ml',
        type: 'IMAGE',
        url: '/assets/products/sahel-Hyaluronic-Acid-Facial-Serum.png',
        altText: 'القوام والامتصاص السريع',
        sortOrder: 1,
        isPrimary: false,
        originType: 'TEXTURE',
        role: 'TEXTURE_SENSORY',
      },
      {
        id: 'media-sv-3',
        skuId: 'sku-starville-50ml',
        type: 'IMAGE',
        url: '/assets/products/sahel-Hyaluronic-Acid-Facial-Wash.png',
        altText: 'غسول الوجه المكمل للروتين',
        sortOrder: 2,
        isPrimary: false,
        originType: 'USAGE',
        role: 'CATEGORY_EDITORIAL',
      },
      {
        id: 'media-sv-4',
        skuId: 'sku-starville-50ml',
        type: 'IMAGE',
        url: '/assets/products/sahel-Hyaluronic-Acid-Micellar-Water.png',
        altText: 'ماء ميسيلار للتنظيف العميق',
        sortOrder: 3,
        isPrimary: false,
        originType: 'EDITORIAL',
        role: 'INGREDIENT_STORY',
      },
    ],
    content: {
      language: 'ar',
      name: 'سيروم النياسيناميد 10%',
      description:
        'سيروم غني بتركيز 10% من النياسيناميد النقي (فيتامين B3) والزنك 1%، صُمم خصيصاً للتحكم الفائق في إفراز الزيوت وتقليص مظهر المسام الواسعة مع توحيد لون البشرة والحد من التصبغات والبقع الناتجة عن آثار حب الشباب. تركيبة خفيفة وسريعة الامتصاص تمنح البشرة ملمساً ناعماً غير دهني، وتدعم الحاجز الواقي دون التسبب في انسداد المسام.',
      ingredients:
        'النياسيناميد 10% (Niacinamide), زنك PCA 1% (Zinc PCA), بانثينول (Pro-Vitamin B5), حمض الهيالورونيك (Hyaluronic Acid), مستخلص الألوفيرا (Aloe Vera Extract), ألانتوين (Allantoin)',
      usage:
        '1. اغسل وجهك بغسول مناسب للبشرة الدهنية أو المختلطة وجفف بلطف.\n2. وزع 3 إلى 4 قطرات من السيروم مباشرة على الجبهة والوجنتين والذقن.\n3. دلك بلطف بحركات دائرية خفيفة لأعلى حتى تمتصه البشرة تماماً في ثوانٍ.\n4. استخدمه صباحاً ومساءً بانتظام؛ واحرص على استخدام واقي شمس مناسب نهاراً.',
      warnings:
        'تجنب ملامسة منطقة محيط العينين والشفتين مباشرة؛ وفي حال الملامسة تُشطف فوراً بالماء النظيف.\nلا يفضل استخدامه في نفس الخطوة مع فيتامين C النقي (حمض الأسكوربيك) لتجنب التفاعل الحمضي.\nللاستخدام الخارجي فقط، ويحفظ في مكان بارد وجاف بعيداً عن أشعة الشمس المباشرة ومتناول الأطفال.',
    },
    promotions: {
      orderDiscountAmount: 70,
    },
  },
  {
    id: 'sku-starville-30ml',
    code: 'SV-NIA-30',
    barcode: '6224001234568',
    variantName: '30 مل',
    size: 30,
    sizeUnit: 'ml',
    price: {
      amount: 320,
      currency: 'EGP',
      compareAtAmount: 380,
    },
    isAvailable: true,
    canOrder: true,
    availability: {
      isAvailable: true,
      isFresh: true,
      confirmedAt: new Date().toISOString(),
      observedAt: new Date().toISOString(),
      validUntil: null,
    },
    media: [
      {
        id: 'media-sv-30-1',
        skuId: 'sku-starville-30ml',
        type: 'IMAGE',
        url: '/assets/products/sahel-serum-clearpack.png',
        altText: 'سيروم النياسيناميد 10% - حجم 30 مل',
        sortOrder: 0,
        isPrimary: true,
        originType: 'PRIMARY',
        role: 'PRIMARY',
      },
    ],
    content: {
      language: 'ar',
      name: 'سيروم النياسيناميد 10% (30 مل)',
      description:
        'سيروم غني بتركيز 10% من النياسيناميد النقي (فيتامين B3) والزنك 1% بحجم 30 مل، صُمم خصيصاً للتحكم الفائق في إفراز الزيوت وتقليص مظهر المسام الواسعة.',
      ingredients: 'النياسيناميد 10%, زنك PCA 1%, بانثينول B5',
      usage: 'استخدم 3-4 قطرات صباحاً ومساءً على بشرة نظيفة.',
      warnings: 'للاستخدام الخارجي فقط. تجنب ملامسة العينين.',
    },
    promotions: null,
  },
];

export const MOCK_STARVILLE_PRODUCT: ProductDetail = {
  id: 'd1662586-397e-40f0-86d5-c3d9c64df00e',
  name: 'سيروم النياسيناميد 10%',
  slug: 'starville-niacinamide-10',
  description:
    'سيروم غني بتركيز 10% من النياسيناميد النقي (فيتامين B3) والزنك 1%، صُمم خصيصاً للتحكم الفائق في إفراز الزيوت وتقليص مظهر المسام الواسعة مع توحيد لون البشرة والحد من التصبغات والبقع الناتجة عن آثار حب الشباب. تركيبة خفيفة وسريعة الامتصاص تمنح البشرة ملمساً ناعماً غير دهني، وتدعم الحاجز الواقي دون التسبب في انسداد المسام.',
  usage:
    '1. اغسل وجهك بغسول مناسب للبشرة الدهنية أو المختلطة وجفف بلطف.\n2. وزع 3 إلى 4 قطرات من السيروم مباشرة على الجبهة والوجنتين والذقن.\n3. دلك بلطف بحركات دائرية خفيفة لأعلى حتى تمتصه البشرة تماماً في ثوانٍ.\n4. استخدمه صباحاً ومساءً بانتظام؛ واحرص على استخدام واقي شمس مناسب نهاراً.',
  warnings:
    'تجنب ملامسة منطقة محيط العينين والشفتين مباشرة؛ وفي حال الملامسة تُشطف فوراً بالماء النظيف.\nلا يفضل استخدامه في نفس الخطوة مع فيتامين C النقي (حمض الأسكوربيك) لتجنب التفاعل الحمضي.\nللاستخدام الخارجي فقط، ويحفظ في مكان بارد وجاف بعيداً عن أشعة الشمس المباشرة ومتناول الأطفال.',
  brand: {
    id: 'starville-brand-id',
    name: 'StarVille Dermatologique',
    slug: 'starville',
  },
  productLine: {
    id: 'line-acne-care',
    name: 'سيروم ونضارة',
    slug: 'serums-and-glow',
  },
  category: {
    id: 'cat-serums',
    name: 'سيروم ونضارة',
    slug: 'serums',
    parentId: 'cat-skincare',
  },
  skus: MOCK_STARVILLE_VARIANTS,
  media: MOCK_STARVILLE_VARIANTS[0].media,
  selectedSkuId: MOCK_STARVILLE_VARIANTS[0].id,
  selectedVariant: MOCK_STARVILLE_VARIANTS[0],
  texture: 'SERUM',
  targetArea: 'FACE',
  suitableSkinTypes: ['oily', 'combination', 'normal', 'sensitive'],
  isFragranceFree: true,
  isNonComedogenic: true,
  waterResistanceMinutes: null,
  spf: null,
  routinePlacements: [
    {
      source: 'expert',
      routine: {
        id: 'routine-pores-oil-control',
        title: 'روتين تنظيم الدهون وتضييق المسام',
        careArea: 'العناية بالبشرة',
      },
      step: {
        title: 'سيروم النياسيناميد 10%',
        instructions: 'الخطوة 3: يوضع بعد تنظيف البشرة والتونر وقبل المرطب صباحاً ومساءً.',
        order: 3,
        timing: 'MORNING_AND_EVENING',
        isOptional: false,
      },
    },
  ],
  evaluatedAt: new Date().toISOString(),
};

export interface MockReviewItem extends ProductReview {
  verified: boolean;
  skinConcern: string;
}

export const MOCK_REVIEWS_SUMMARY: ProductReviewSummary = {
  average: 4.8,
  count: 2413,
  recommendPercent: 98,
  verifiedCount: 1980,
  distribution: {
    '5': 2026,
    '4': 265,
    '3': 72,
    '2': 24,
    '1': 26,
  },
};

export const MOCK_REVIEWS_ITEMS: MockReviewItem[] = [
  {
    id: 'rev-1',
    authorName: 'سارة محمود',
    rating: 5,
    title: 'خفيف وسريع الامتصاص، وفرق حقيقي في اللمعان!',
    body: 'تجربة ممتازة بجد! السيروم خفيف جداً على البشرة وسريع الامتصاص، وفرق كبير في اللمعان والمسام من أول أسبوع استخدام. ما سببليش أي حبوب تحت الجلد، والمسام بقت أنظف وأصغر بكتير وملمس بشرتي اتحسن جداً.',
    isVerifiedPurchase: true,
    verified: true,
    skinType: 'oily',
    skinConcern: 'دهنية معرّضة للحبوب',
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    helpfulCount: 24,
  },
  {
    id: 'rev-2',
    authorName: 'أحمد خليل',
    rating: 5,
    title: 'أفضل سيروم اقتصادي بفاعلية طبية عالية',
    body: 'أفضل سيروم نياسيناميد جربته مقارنة ببراندات مستوردة أغلى بكتير. ممتاز في التحكم بدهون منطقة الـ T-Zone، والنتيجة بتبان في تقليل اللمعان من أول كام يوم والمسام بتضيق تدريجياً.',
    isVerifiedPurchase: true,
    verified: true,
    skinType: 'combination',
    skinConcern: 'مختلطة',
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    helpfulCount: 18,
  },
  {
    id: 'rev-3',
    authorName: 'ميرا كمال',
    rating: 5,
    title: 'توحيد لون البشرة وتفتيح آثار الحبوب',
    body: 'كنت بعاني من آثار حبوب قديمة وتصبغات ومسامات واسعة في الخدود، خلال 3 أسابيع الآثار خفت بنسبة 70% ولون البشرة اتوحد بشكل ملحوظ ومن غير أي جفاف أو تحسس. أنصح بيه جداً!',
    isVerifiedPurchase: true,
    verified: true,
    skinType: 'sensitive',
    skinConcern: 'معرّضة للتصبغات والآثار',
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    helpfulCount: 31,
  },
];

export const MOCK_RELATED_PRODUCTS_LIST = [
  {
    id: 'rel-1',
    name: 'غسول الوجه للبشرة الدهنية والمعرضة للحبوب',
    slug: 'starville-facial-wash-oily',
    brand: { name: 'StarVille', slug: 'starville' },
    price: { amount: 190, currency: 'EGP', compareAtAmount: 220 },
    primaryImage: '/assets/products/sahel-Hyaluronic-Acid-Facial-Wash.png',
    rating: 4.7,
    reviewCount: 940,
    size: '200 مل',
    canOrder: true,
  },
  {
    id: 'rel-2',
    name: 'واقي شمس جل خفيف بعامل حماية SPF 50+',
    slug: 'starville-sunscreen-gel-spf50',
    brand: { name: 'StarVille', slug: 'starville' },
    price: { amount: 260, currency: 'EGP', compareAtAmount: 310 },
    primaryImage: '/assets/products/sahel-serum-clearpack.png',
    rating: 4.8,
    reviewCount: 1420,
    size: '60 مل',
    canOrder: true,
  },
  {
    id: 'rel-3',
    name: 'سيروم فيتامين C المركز 10% للنضارة',
    slug: 'starville-vitamin-c-serum',
    brand: { name: 'StarVille', slug: 'starville' },
    price: { amount: 410, currency: 'EGP', compareAtAmount: 480 },
    primaryImage: '/assets/products/sahel-Hyaluronic-Acid-Facial-Serum.png',
    rating: 4.9,
    reviewCount: 810,
    size: '30 مل',
    canOrder: true,
  },
  {
    id: 'rel-4',
    name: 'كريم مرطب لترميم حاجز البشرة بالبانثينول',
    slug: 'starville-barrier-repair-cream',
    brand: { name: 'StarVille', slug: 'starville' },
    price: { amount: 220, currency: 'EGP', compareAtAmount: 250 },
    primaryImage: '/assets/products/sahel-Hyaluronic-Acid-Micellar-Water.png',
    rating: 4.6,
    reviewCount: 650,
    size: '100 مل',
    canOrder: true,
  },
];
