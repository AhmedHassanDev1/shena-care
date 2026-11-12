import { Module } from '@nestjs/common';
import { IntakeStoreService } from './services/intake-store.service';
import { MarketPriceStoreService } from './services/market-price-store.service';

/**
 * Catalog Intake (ingestion.intake_*): job and row records, learned identity wording and market price evidence, plus the pure readers and matchers in lib/.
 * Orchestration across Catalog and Sourcing lives in the composition layer; this module never writes another context's tables.
 */
@Module({
  providers: [IntakeStoreService, MarketPriceStoreService],
  exports: [IntakeStoreService, MarketPriceStoreService],
})
export class IntakeModule {}
