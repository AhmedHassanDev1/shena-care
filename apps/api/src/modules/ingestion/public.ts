export * from './ingestion.module';
export * from './services/ingestion.service';
export * from './dto/ingestion.dto';
export { ProductContentService } from './services/product-content.service';
export type { PublishedContent } from './services/product-content.service';
export * from './contracts/canonical-supplier-record.contract';
export * from './adapters/source-adapter.interface';
export * from './adapters/in-memory-source.adapter';
export * from './adapters/file-source.adapter';
export * from './adapters/api-webhook-source.adapter';
export * from './services/spreadsheet-parser.service';
export * from './services/format-fingerprint.service';
export * from './services/export-profile.service';
export * from './contracts/row-normalization.contract';
export * from './services/row-normalization.service';
export * from './contracts/brand-enrichment.contract';
export * from './services/brand-enrichment.service';

export { CanonicalResearchService } from './services/canonical-research.service';
export { CRITICAL_FACT_PREFIXES, RESEARCH_SCHEMA_VERSION } from './services/product-fact-extractor';
export { ResearchSourceFetcher, RESEARCH_TRANSPORT } from './services/research-source-fetcher';
export type { ResearchTransport, TransportResponse } from './services/research-source-fetcher';
export { AdminCatalogImportService, ADMIN_IMPORT_MAX_ROWS } from './services/admin-catalog-import.service';
export type { AdminImportReceipt, ColumnMap as AdminImportColumnMap, ResolveRowInput as AdminImportResolveInput } from './services/admin-catalog-import.service';
export { CatalogDecisionLogService } from './services/catalog-decision-log.service';
export type { DecisionEntry, DecisionSubject, OpenExceptionInput } from './services/catalog-decision-log.service';
export {
  DECISION_RULE_VERSION, MAX_AUTOMATIC_ATTEMPTS, MIN_IDENTITY_EDGE, chooseIdentityImage, decideEditorial, decideFacts, decideMatchedRow, decideNewProduct, independentLinkSupport,
  nextAttemptDelayMs, rowHold,
} from './services/catalog-decision-engine';
export type { CatalogDecisionState, ExceptionAction, FactVerdict, HoldReason, ImageCandidate, Recommendation, SourceCheck } from './services/catalog-decision-engine';
export type { AutoVerifyResult } from './services/canonical-research.service';
export type { RowAdmission, RowCorrection } from './services/admin-catalog-import.service';
