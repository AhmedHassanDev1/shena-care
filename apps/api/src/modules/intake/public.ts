// Public contract of the Intake module. Other modules and the composition layer import only from here.
export { IntakeModule } from './intake.module';
export { IntakeStoreService, ADMIN_ROW_LEASE_MS } from './services/intake-store.service';
export type { NewIntakeRow, RowSettlement } from './services/intake-store.service';
export { MarketPriceStoreService } from './services/market-price-store.service';
export type { ObservationInput } from './services/market-price-store.service';

export {
  normalizeCell, withoutMeasures, parseAmount, parsePercent, parseQuantity, parseBarcode, readMeasures, stripMeasures, measureKey, sameMeasure, variantMarkers, identityFingerprint, sha256,
} from './lib/intake-text';
export type { Measure, MeasureReading, CanonicalUnit } from './lib/intake-text';
export { parseSpreadsheet, detectColumns, cellOf } from './lib/spreadsheet';
export type { ParsedSheet, ColumnMap, IntakeField } from './lib/spreadsheet';
export { BrandDetector, ScopeGate, CandidateIndex, EXCLUDED_CLASSES, excludedClassesIn, MATCH_RULE_VERSION } from './lib/matching';
export type { BrandHit, ScopeVerdict, RowIdentity, MatchVerdict, CandidateEvidence } from './lib/matching';
export { extractPageOffers, checkObservation, marketReference, readMarketPriceEvidence, MARKET_RULE_VERSION } from './lib/market-price';
export type { PageOffer, ObservationCheck, MarketReference, ReferenceInput, MarketPriceType, MarketSourceType } from './lib/market-price';
export { readSupplierRows, readAdminRows, supplierColumnProblems, namesToSheet } from './lib/row-reader';
export type { ColumnProblem } from './lib/row-reader';
