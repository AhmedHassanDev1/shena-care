import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { CatalogModule } from '../catalog/public';
import { SourcingService } from './services/sourcing.service';

@Module({
  imports: [DatabaseModule, CatalogModule],
  providers: [SourcingService],
  exports: [SourcingService],
})
export class SourcingModule {}
