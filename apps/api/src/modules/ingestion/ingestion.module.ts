import { Module } from '@nestjs/common';
import { IngestionService } from './services/ingestion.service';
import { IngestionController } from './ingestion.controller';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';

@Module({
  imports: [CatalogModule, SourcingModule],
  controllers: [IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
