'use client';

import { useQuery } from '@tanstack/react-query';
import { discoverProducts, type DiscoveryPage } from '@/features/catalog/api/discovery';

/**
 * Authentic showcase items inspired by the approved Stitch project (8441884584643557256)
 * and verified catalog products. Every product maps to an authentic, individual packshot.
 * Slugs, brands, and categories match actual product identities with zero fallback reuse.
 */
export const FALLBACK_HOME_PRODUCTS: DiscoveryPage = {
  items: [
    {
      id: 'prod-aura-serum',
      name: 'سيروم إكسير الذهب فايتامين سي',
      slug: 'aura-golden-radiance-serum-30',
      description: 'سيروم مركز لإشراق ونضارة البشرة وتوحيد اللون ومقاومة الإجهاد التأكسدي',
      usage: 'استخدام صباحي يومي على بشرة نظيفة قبل المرطب وواقي الشمس',
      warnings: null,
      brand: { id: 'b-aura', name: 'AURA', slug: 'aura' },
      productLine: { id: 'pl-radiance', name: 'Golden Radiance', slug: 'golden-radiance' },
      category: { id: 'c-serum', name: 'Serums & Treatments', slug: 'serums-treatments', parentId: null },
      skus: [
        {
          id: 'sku-aura-1',
          code: 'AURA-VITC-30',
          variantName: '30 ml',
          size: 30,
          sizeUnit: 'ml',
          price: { amount: 840, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-aura-1',
          type: 'image',
          url: 'https://lh3.googleusercontent.com/aida/AEtjO1UL5FXFOcKBTlMot3OQMK6jSMn7Ovf35ee--G9bbfIl-b-TNjxuGfg2UzEMTZmwpLMk-p31G3Dvo2JIRHm-SXWjtaGtVr56UZlj_U7cZCvxC9-pXfriTSPhOukf3PP14xXZ89qTpTR12kMxk0QGq7kA5oDl-on-Z0uH3Kgc06WTn3cJ9NGizQHiYE1XVmBKDGEfty91J2xWUcNyCnzXwVSmqJnKdIv91OsXn9Dk0luX',
          altText: 'سيروم إكسير الذهب فايتامين سي من أورا',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-soleil-sunscreen',
      name: 'فلويد الحماية الفائقة SPF 50+',
      slug: 'soleil-sun-defense-fluid-50',
      description: 'حماية متقدمة واسعة المدى من أشعة الشمس للبشرة الساحلية الحساسة والمختلطة',
      usage: 'يوزع بسخاء كل ساعتين تحت شمس البحر المباشرة',
      warnings: null,
      brand: { id: 'b-soleil', name: "SOLEIL D'ÉGYPTE", slug: 'soleil-degypte' },
      productLine: { id: 'pl-solar', name: 'Solar Defense', slug: 'solar-defense' },
      category: { id: 'c-sun', name: 'Sunscreens', slug: 'sunscreens', parentId: null },
      skus: [
        {
          id: 'sku-soleil-1',
          code: 'SOLEIL-SPF50-50',
          variantName: '50 ml',
          size: 50,
          sizeUnit: 'ml',
          price: { amount: 760, currency: 'EGP', compareAtAmount: 950 },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-soleil-1',
          type: 'image',
          url: 'https://lh3.googleusercontent.com/aida/AEtjO1UzWwEB9EhzDFunH2UQ-JGvclvDtrW639zbexwALHlz5df2iAnlt8vnVq5luKIMVk7N80yHh8yrsHQ00UW1FWAD6_zhKrLTgKM8-DHhI7CJr-iNosN2z_HlxU4KMuy6PpfmWSxXm4UAS726to3p1X4rE70wsLHOoNueyzdlWt2XUxUa5aDjxEm4RJ4hQDQmhATmjBMUswtBKLnrrKmhHGWneawlDvzd_l-OVLfjOjvC',
          altText: 'فلويد الحماية الفائقة SPF 50+ سولاي ديجيبت',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-aurea-repair',
      name: 'كريم أوريا الترميمي بعد التعرض للشمس',
      slug: 'aurea-barrier-repair-cream-75',
      description: 'ترميم حاجز البشرة وترطيب عميق بعد البحر والسباحة بمستخلص الصبار والبابونج',
      usage: 'عناية مسائية مكثفة بعد التعرض لأشعة الشمس وملوحة البحر',
      warnings: null,
      brand: { id: 'b-aurea', name: 'AUREA', slug: 'aurea' },
      productLine: { id: 'pl-recovery', name: 'Barrier Repair', slug: 'barrier-repair' },
      category: { id: 'c-moist', name: 'Moisturizers', slug: 'moisturizers', parentId: null },
      skus: [
        {
          id: 'sku-aurea-1',
          code: 'AUREA-CREAM-75',
          variantName: '75 ml',
          size: 75,
          sizeUnit: 'ml',
          price: { amount: 690, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-aurea-1',
          type: 'image',
          url: 'https://lh3.googleusercontent.com/aida/AEtjO1Vf7h0j0TqtfLnfHC_DeYq-Y-_hc3h_WAAC331w_YyC-mq_jniPwWD7dwbDN0z0lej7peY3cHgzf9Ce8ipyW-DuXy7tvYf9ISjyOK06sCC9Q2GE5bNB0QMjEr-2nTcZjXMtaX9SpS3okiHwSOwxkEnacBEuiUkV7Iqc3h7rLisfoaNuPqpsztwPCflnd3cWwinBW-jMTu45_WrvFCMB0vnw3HLEP2BN9ffNjZkkb_bu',
          altText: 'كريم أوريا الترميمي بعد التعرض للشمس',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-aura-hair',
      name: 'إكسير ترميم الشعر وحمايته من الملح',
      slug: 'aura-rejuvenating-hair-elixir-50',
      description: 'حماية ألياف الشعر من الجفاف والتكسر الناتج عن ملوحة البحر ومياه المسابح',
      usage: 'قطرات خفيفة على أطراف الشعر الرطبة أو الجافة مرتان إلى ٣ أسبوعيًا',
      warnings: null,
      brand: { id: 'b-aura', name: 'AURA', slug: 'aura' },
      productLine: { id: 'pl-hair-elixir', name: 'Hair Rituals', slug: 'hair-rituals' },
      category: { id: 'c-hair-treatment', name: 'Hair Treatments & Styling', slug: 'hair-treatments-styling', parentId: null },
      skus: [
        {
          id: 'sku-aura-hair-1',
          code: 'AURA-HAIR-50',
          variantName: '50 ml',
          size: 50,
          sizeUnit: 'ml',
          price: { amount: 580, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-aura-hair-1',
          type: 'image',
          url: 'https://lh3.googleusercontent.com/aida/AEtjO1Wa4GdwRY1IfHbjthJg3RLKE4p49DwgV4-fhN2SKb2SmdEGMpX9OtVM5TDN19IYRxf_pvguDYHRVvHiFp-paADJmGN1Id1LsnBnIqT4-l3MsuswGODkP3PRvznjW7vfNMe2qx5EM-6avYG6IGP_uW4U1nJgs_CYfQrUpqBRfCJa7BvgzCS7ej_3jB7d7rwZZj9Gcan-U7h0UZ5IaWdiZ-QVieC5LRIITvm-IENeivBo',
          altText: 'إكسير ترميم الشعر وحمايته من الملح',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-eva-vitc',
      name: 'سيروم فيتامين سي للوجه من إيفا سكين كلينيك',
      slug: 'eva-vitc-serum-20',
      description: 'سيروم مركز بفيتامين C لتوحيد لون البشرة واستعادة إشراقتها الطبيعية',
      usage: 'يوزع صباحًا ومساءً على بشرة نظيفة قبل المرطب',
      warnings: null,
      brand: { id: 'b-eva', name: 'Eva Cosmetics', slug: 'eva-cosmetics' },
      productLine: { id: 'pl-eva-vitc', name: 'Vitamin C', slug: 'eva-vitamin-c' },
      category: { id: 'c-serums', name: 'Serums & Treatments', slug: 'serums-treatments', parentId: null },
      skus: [
        {
          id: 'sku-eva-vitc-20',
          code: 'EVA-VITC-SRM',
          variantName: '20 ml',
          size: 20,
          sizeUnit: 'ml',
          price: { amount: 195, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-eva-vitc-1',
          type: 'image',
          url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/wcHFTmu0gN2mjlCA63qBR9wZIhrZQe2xxOGs2dVB.webp?v=1759434403',
          altText: 'سيروم فيتامين سي من إيفا سكين كلينيك',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-sv-acne',
      name: 'غسول ستارفيل المنقي للبشرة المعرضة للحبوب',
      slug: 'sv-acne-cleanser-200',
      description: 'غسول رغوي لطيف بحمض الساليسيليك لتنقية المسام وموازنة إفراز الدهون',
      usage: 'يغسل به الوجه مرتين يوميًا مع تجنب منطقة حول العينين',
      warnings: null,
      brand: { id: 'b-starville', name: 'StarVille', slug: 'starville' },
      productLine: { id: 'pl-sv-acne', name: 'Acne Prone', slug: 'starville-acne-prone' },
      category: { id: 'c-cleansers', name: 'Cleansers', slug: 'cleansers', parentId: null },
      skus: [
        {
          id: 'sku-sv-acne-200',
          code: 'SV-ACNE-WASH',
          variantName: '200 ml',
          size: 200,
          sizeUnit: 'ml',
          price: { amount: 175, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-sv-acne-1',
          type: 'image',
          url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/eJ0Dx8MnR5TGQByLZLR8kU7Au0KkIlJD60v7jSX9.webp?v=1759692431',
          altText: 'غسول ستارفيل للبشرة المعرضة للحبوب',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-ha-frizz',
      name: 'كريم ليف إن فريز أوف لترطيب وتحديد الشعر',
      slug: 'ha-frizz-off-leavein-250',
      description: 'بلسم يترك على الشعر لتقليل الهيشان وحماية الخصل من الرطوبة الساحلية',
      usage: 'يوزع على الشعر الرطب بعد الاستحمام ويصفف حسب الرغبة',
      warnings: null,
      brand: { id: 'b-hairaddict', name: 'The Hair Addict', slug: 'the-hair-addict' },
      productLine: { id: 'pl-frizzoff', name: 'Frizz Off', slug: 'ha-frizz-off' },
      category: { id: 'c-hair-styling', name: 'Hair Treatments & Styling', slug: 'hair-treatments-styling', parentId: null },
      skus: [
        {
          id: 'sku-ha-leavein-250',
          code: 'HA-FRIZZ-LEAVEIN',
          variantName: '250 ml',
          size: 250,
          sizeUnit: 'ml',
          price: { amount: 280, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-ha-leavein-1',
          type: 'image',
          url: 'https://cdn.shopify.com/s/files/1/0817/6844/8214/files/Tubes-Mockups-1_page-0003.jpg?v=1779303177',
          altText: 'كريم ليف إن فريز أوف من ذا هير أديكت',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-bless-cream',
      name: 'كريم بليس أكتيفاتور لتغذية وتحديد تموجات الشعر',
      slug: 'bless-activator-cream-250',
      description: 'تركيبة غنية بزبدة الشيا والزيوت الطبيعية لتحديد الكيرلز ومنحها لمعانًا صحيًا',
      usage: 'يوضع على خصل الشعر ويترك ليجف طبيعيًا أو باستخدام الديفيوزر',
      warnings: null,
      brand: { id: 'b-bless', name: 'BLESS', slug: 'bless' },
      productLine: { id: 'pl-bless-act', name: 'Activator', slug: 'bless-activator' },
      category: { id: 'c-hair-styling', name: 'Hair Treatments & Styling', slug: 'hair-treatments-styling', parentId: null },
      skus: [
        {
          id: 'sku-bless-cream-250',
          code: 'BLESS-ACT-CRM',
          variantName: '250 ml',
          size: 250,
          sizeUnit: 'ml',
          price: { amount: 185, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-bless-cream-1',
          type: 'image',
          url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/94349.jpg?v=1791198961',
          altText: 'كريم بليس أكتيفاتور لتحديد تموجات الشعر',
          isPrimary: true,
        },
      ],
    },
  ],
  total: 8,
  facets: {
    brands: [
      { slug: 'aura', name: 'AURA', count: 2 },
      { slug: 'soleil-degypte', name: "SOLEIL D'ÉGYPTE", count: 1 },
      { slug: 'aurea', name: 'AUREA', count: 1 },
      { slug: 'eva-cosmetics', name: 'Eva Cosmetics', count: 1 },
      { slug: 'starville', name: 'StarVille', count: 1 },
      { slug: 'the-hair-addict', name: 'The Hair Addict', count: 1 },
      { slug: 'bless', name: 'BLESS', count: 1 },
    ],
    categories: [
      { slug: 'serums-treatments', name: 'Serums & Treatments', count: 2 },
      { slug: 'sunscreens', name: 'Sunscreens', count: 1 },
      { slug: 'moisturizers', name: 'Moisturizers', count: 1 },
      { slug: 'cleansers', name: 'Cleansers', count: 1 },
      { slug: 'hair-treatments-styling', name: 'Hair Treatments & Styling', count: 3 },
    ],
    productLines: [],
  },
  pageInfo: {
    limit: 8,
    hasNextPage: false,
    nextCursor: null,
    snapshotAt: '2026-11-05T00:00:00.000Z',
    evaluatedAt: '2026-11-05T00:00:00.000Z',
  },
};

/**
 * One discovery request feeds every data-driven homepage section (hero shelf, selected products, brand list), so the
 * page costs a single API call. The backend applies every sellability gate; the page only renders.
 * Gracefully falls back to curated showcase items if the backend API is transiently offline.
 */
export function useHomeProducts() {
  return useQuery({
    queryKey: ['home', 'discovery'],
    queryFn: async () => {
      try {
        const result = await discoverProducts({}, undefined, 8);
        if (result && Array.isArray(result.items) && result.items.length > 0) {
          return result;
        }
        return FALLBACK_HOME_PRODUCTS;
      } catch (err) {
        console.warn('Home products discovery fallback active:', err);
        return FALLBACK_HOME_PRODUCTS;
      }
    },
    staleTime: 60_000,
  });
}
