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
export { SEARCH_PROVIDER } from './search/search-provider';
export type { SearchProvider, SearchFilters } from './search/search-provider';
export { normalizeSearchText } from './search/search-text';
export { CatalogService } from './services/catalog.service';
export { BrandService } from './services/brand.service';
export { CategoryService } from './services/category.service';
export { ProductIdentityService, BARCODE_ALIAS_SOURCES } from './services/product-identity.service';
export { MediaTemplateService } from './services/media-template.service';
export { CatalogIntakeService } from './services/catalog-intake.service';
export type { ManualIntakeInput, IdentityVerificationInput } from './services/catalog-intake.service';
export { VERIFIED_IDENTITY_STATES } from './services/catalog-intake.service';
export { DEFAULT_TEMPLATE_KEY } from './services/media-template.service';
export { IngredientService } from './services/ingredient.service';
export { ProductMediaService } from './services/product-media.service';
export type { MediaReadiness, MediaRoleState } from './services/product-media.service';
export type { BarcodeResolution } from './services/product-identity.service';

// DTOs
export { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';
export { CreateProductLineDto, UpdateProductLineDto } from './dto/product-line.dto';
export { CreateProductDto, UpdateProductDto } from './dto/product.dto';
export { CreateSkuDto, UpdateSkuDto } from './dto/sku.dto';
export { CreateProductMediaDto, UpdateProductMediaDto } from './dto/media.dto';
export { RegisterMediaAssetDto, DeriveMediaAssetDto, ReviewMediaAssetDto, RegisterMediaTemplateDto, SetMediaTemplateStateDto, ReprocessMediaTemplateDto } from './dto/media-asset.dto';

// Types — بنصدر الـ interfaces عشان الـ Composition Layer
// يقدر يستخدمها في الـ types بتاعته من غير ما يحتاج يعرف الـ implementation
export type { PublishedProduct, PublishedSku, PublishedMedia, SkuValidationStatus } from './services/catalog.service';
export type { SkuLabel, ReviewedUsageRuleInput, StatedConcentrationInput } from './services/catalog.service';
export type { SkuIdentityCandidate, SkuIdentityCandidateRequest } from './services/catalog.service';
export type { RoutineProductFacts, RoutineActiveFact } from './services/catalog.service';
export type { BrandSummary, BrandDetail, ProductLineSummary } from './services/brand.service';
export type { CategoryNode, CategoryDetail } from './services/category.service';
export {
  ProductTexture,
  UvFilterType,
  UsageTargetArea,
  SafetyWarningKind,
  ConcentrationStatus,
  UsageRoutinePeriod,
  UsageRinseMode,
  UsageFrequencyUnit,
} from '@prisma/client';
