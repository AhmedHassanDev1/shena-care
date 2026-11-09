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
export { CatalogItemManagementService } from './services/catalog-item-management.service';
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

// Research & Fact Services
export { BrandResearchService } from './research/brand-research.service';
export type { BrandEnrichment, RangeSourceTier, BrandOnboarding } from './research/brand-research.service';
export { CanonicalResearchService } from './research/canonical-research.service';
export type { AutoVerifyResult } from './research/canonical-research.service';
export { ProductContentService } from './research/product-content.service';
export type { PublishedContent } from './research/product-content.service';
export { RoutinePlacementService } from './research/routine-placement.service';
export { IngredientOntologyService } from './research/ingredient-ontology.service';
export { CatalogDecisionLogService } from './research/catalog-decision-log.service';
export type { DecisionEntry, DecisionSubject, OpenExceptionInput } from './research/catalog-decision-log.service';
export { ResearchSourceFetcher, RESEARCH_TRANSPORT } from './research/research-source-fetcher';
export type { ResearchTransport, TransportResponse } from './research/research-source-fetcher';
export { ProductResearchService } from './research/product-research.service';
export { BrandEnrichmentService } from './research/brand-enrichment.service';

export { CRITICAL_FACT_PREFIXES, RESEARCH_SCHEMA_VERSION, isInstructionLine } from './research/product-fact-extractor';
export {
  DECISION_RULE_VERSION,
  MAX_AUTOMATIC_ATTEMPTS,
  MIN_IDENTITY_EDGE,
  chooseIdentityImage,
  decideEditorial,
  decideFacts,
  decideMatchedRow,
  decideNewProduct,
  decideFromFoundPages,
  sizeFromFoundPages,
  independentLinkSupport,
  nextAttemptDelayMs,
  rowHold,
} from './research/catalog-decision-engine';
export type {
  CatalogDecisionState,
  ExceptionAction,
  FactVerdict,
  HoldReason,
  ImageCandidate,
  Recommendation,
  SourceCheck,
} from './research/catalog-decision-engine';

export { readProductType, productTypeRule, PRODUCT_TYPES, PRODUCT_TYPE_RULE_VERSION } from './research/product-type';
export type { ProductTypeReading, ProductDomain } from './research/product-type';
export { buildRoutineProfile, orderRoutine, ROLE_BY_TYPE, ROUTINE_RULE_VERSION } from './research/routine-profile';
export type { RoutineProfile, RoutineProfileInput, RoutineRole, FieldState, PlacementConstraint, RoutineStepInput, OrderedRoutine } from './research/routine-profile';

// DTOs
export { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';
export { CreateProductLineDto, UpdateProductLineDto } from './dto/product-line.dto';
export { CreateProductDto, UpdateProductDto } from './dto/product.dto';
export { CreateSkuDto, UpdateSkuDto } from './dto/sku.dto';
export { CreateProductMediaDto, UpdateProductMediaDto } from './dto/media.dto';
export { RegisterMediaAssetDto, DeriveMediaAssetDto, ReviewMediaAssetDto, RegisterMediaTemplateDto, SetMediaTemplateStateDto, ReprocessMediaTemplateDto } from './dto/media-asset.dto';
export { ResearchBrandDto, SaveResearchedBrandDto } from './research/dto/brand-research.dto';

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
