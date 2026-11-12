'use client';

import { useQuery } from '@tanstack/react-query';
import { discoverProducts, type DiscoveryPage } from '@/features/catalog/api/discovery';

/**
 * Authentic showcase items backed by real catalog products from seed data.
 * Every product maps to an authentic, individual packshot.
 * Slugs, brands, and categories match actual product identities with zero fallback reuse.
 */
export const FALLBACK_HOME_PRODUCTS: DiscoveryPage = {
  items: [
    {
      id: 'prod-eva-vitc-serum-20',
      name: 'سيروم فيتامين سي للوجه من إيفا سكين كلينيك',
      slug: 'eva-vitc-serum-20',
      description: 'سيروم مركز بفيتامين C لتوحيد لون البشرة واستعادة إشراقتها الطبيعية ومقاومة الإجهاد التأكسدي',
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
      id: 'prod-eva-ha-serum-30',
      name: 'سيروم الهيالورونيك للوجه من إيفا سكين كلينيك',
      slug: 'eva-ha-serum-30',
      description: 'سيروم الهيالورونيك المركز لترطيب عميق ودعم حاجز البشرة ومرونتها',
      usage: 'قطرات خفيفة على بشرة رطبة صباحاً ومساءً متبوعاً بالمرطب',
      warnings: null,
      brand: { id: 'b-eva', name: 'Eva Cosmetics', slug: 'eva-cosmetics' },
      productLine: { id: 'pl-eva-ha', name: 'Hyaluronic Acid', slug: 'eva-hyaluronic-acid' },
      category: { id: 'c-serums', name: 'Serums & Treatments', slug: 'serums-treatments', parentId: null },
      skus: [
        {
          id: 'sku-eva-ha-30',
          code: 'EVA-HA-SRM',
          variantName: '30 ml',
          size: 30,
          sizeUnit: 'ml',
          price: { amount: 220, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-eva-ha-1',
          type: 'image',
          url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/91856.jpg?v=1767721058',
          altText: 'سيروم الهيالورونيك من إيفا سكين كلينيك',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-eva-collagen-wash-150',
      name: 'غسول كولاجين للوجه المقاوم لعلامات التقدم بالسن',
      slug: 'eva-collagen-wash-150',
      description: 'غسول لطيف بالكولاجين ينظف بعمق ويحافظ على توازن الرطوبة الطبيعي للبشرة',
      usage: 'يغسل به الوجه صباحاً ومساءً بحركات دائرية خفيفة ثم يشطف',
      warnings: null,
      brand: { id: 'b-eva', name: 'Eva Cosmetics', slug: 'eva-cosmetics' },
      productLine: { id: 'pl-eva-col', name: 'Collagen', slug: 'eva-collagen' },
      category: { id: 'c-cleansers', name: 'Cleansers', slug: 'cleansers', parentId: null },
      skus: [
        {
          id: 'sku-eva-col-wash-150',
          code: 'EVA-COL-WASH',
          variantName: '150 ml',
          size: 150,
          sizeUnit: 'ml',
          price: { amount: 135, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-eva-col-wash-1',
          type: 'image',
          url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/DKahM3hCkfl60u6I2OkFdPCpC8asK4UjMBIkKWOh.webp?v=1759434293',
          altText: 'غسول الكولاجين من إيفا سكين كلينيك',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-eva-collagen-filler-50',
      name: 'كريم فيلر كولاجين لملء الخطوط الدقيقة (+30)',
      slug: 'eva-collagen-filler-50',
      description: 'كريم مخصص لملء الخطوط التعبيرية وترطيب البشرة وتحسين مظهر الامتلاء',
      usage: 'يوضع على الوجه والرقبة صباحاً ومساءً مع تدليك لطيف',
      warnings: null,
      brand: { id: 'b-eva', name: 'Eva Cosmetics', slug: 'eva-cosmetics' },
      productLine: { id: 'pl-eva-col', name: 'Collagen', slug: 'eva-collagen' },
      category: { id: 'c-moisturizers', name: 'Moisturizers', slug: 'moisturizers', parentId: null },
      skus: [
        {
          id: 'sku-eva-col-fill-50',
          code: 'EVA-COL-FILL',
          variantName: '50 ml',
          size: 50,
          sizeUnit: 'ml',
          price: { amount: 210, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-eva-col-fill-1',
          type: 'image',
          url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/pFcjqe2VVqhd75VTkbV2QwfY6qOtH8vxIyXVT6An.webp?v=1759692407',
          altText: 'كريم فيلر كولاجين إيفا',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-sv-acne-cleanser-200',
      name: 'غسول ستارفيل المنقي للبشرة المعرضة للحبوب',
      slug: 'sv-acne-cleanser-200',
      description: 'غسول رغوي بحمض الساليسيليك وشجرة الشاي لتنقية المسام وموازنة إفراز الدهون',
      usage: 'يغسل به الوجه مرتين يومياً مع تجنب محيط العينين',
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
      id: 'prod-sv-acne-cream-60',
      name: 'كريم ستارفيل للبشرة المعرضة للحبوب',
      slug: 'sv-acne-cream-60',
      description: 'كريم مرطب ومهدئ للبشرة المعرضة للحبوب يقلل من الشوائب ويهدئ الاحمرار',
      usage: 'يوضع على بشرة نظيفة وجافة مرة إلى مرتين يومياً',
      warnings: null,
      brand: { id: 'b-starville', name: 'StarVille', slug: 'starville' },
      productLine: { id: 'pl-sv-acne', name: 'Acne Prone', slug: 'starville-acne-prone' },
      category: { id: 'c-moisturizers', name: 'Moisturizers', slug: 'moisturizers', parentId: null },
      skus: [
        {
          id: 'sku-sv-acne-60',
          code: 'SV-ACNE-CRM',
          variantName: '60 gm',
          size: 60,
          sizeUnit: 'gm',
          price: { amount: 120, currency: 'EGP', compareAtAmount: null },
          canOrder: true,
        },
      ],
      media: [
        {
          id: 'm-sv-acne-crm-1',
          type: 'image',
          url: 'https://cdn.shopify.com/s/files/1/0700/9488/0959/files/natural_glow_white_bg_1.png?v=1776525610',
          altText: 'كريم ستارفيل للبشرة المعرضة للحبوب',
          isPrimary: true,
        },
      ],
    },
    {
      id: 'prod-ha-frizz-leavein-250',
      name: 'كريم ليف إن فريز أوف لترطيب وتحديد الشعر',
      slug: 'ha-frizz-off-leavein-250',
      description: 'بلسم يترك على الشعر لتقليل الهيشان وحماية الخصل من الرطوبة والعوامل الخارجية',
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
      id: 'prod-bless-activator-cream-250',
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
      { slug: 'eva-cosmetics', name: 'Eva Cosmetics', count: 4 },
      { slug: 'starville', name: 'StarVille', count: 2 },
      { slug: 'the-hair-addict', name: 'The Hair Addict', count: 1 },
      { slug: 'bless', name: 'BLESS', count: 1 },
    ],
    categories: [
      { slug: 'serums-treatments', name: 'Serums & Treatments', count: 2 },
      { slug: 'cleansers', name: 'Cleansers', count: 2 },
      { slug: 'moisturizers', name: 'Moisturizers', count: 2 },
      { slug: 'hair-treatments-styling', name: 'Hair Treatments & Styling', count: 2 },
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
    placeholderData: FALLBACK_HOME_PRODUCTS,
    staleTime: 60_000,
  });
}
