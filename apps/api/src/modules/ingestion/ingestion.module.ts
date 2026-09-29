import { Module } from '@nestjs/common';
import { IngestionService } from './services/ingestion.service';
import { IngestionController } from './ingestion.controller';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';
import { AiModule } from '../../platform/ai';

@Module({
  imports: [CatalogModule, SourcingModule, AiModule],
  controllers: [IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}

