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

