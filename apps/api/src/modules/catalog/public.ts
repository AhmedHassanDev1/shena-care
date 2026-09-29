// ─── public.ts ───────────────────────────────────────────────────────────────
// ده "الباب الرسمي" للـ Catalog Module
//
// القاعدة الذهبية:
//   أي موديول تاني (Composition, Commerce, إلخ) يقدر يستخدم الكتالوج
//   بس عن طريق الـ exports اللي هنا بس — مش عن طريق استيراد مباشر من الملفات الداخلية
//
// الـ Architecture Test في test/architecture/module-boundaries.spec.ts
//   بيتأكد إن محدش بيخترق القاعدة دي

// Services
export { CatalogModule } from './catalog.module';
export { CatalogService } from './services/catalog.service';
export { BrandService } from './services/brand.service';
export { CategoryService } from './services/category.service';

// Types — بنصدر الـ interfaces عشان الـ Composition Layer
// يقدر يستخدمها في الـ types بتاعته من غير ما يحتاج يعرف الـ implementation
export type { PublishedProduct, PublishedSku } from './services/catalog.service';
export type { BrandSummary, BrandDetail } from './services/brand.service';
export type { CategoryNode, CategoryDetail } from './services/category.service';
