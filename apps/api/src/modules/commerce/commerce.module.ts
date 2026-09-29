import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/public';
import { CommerceService } from './services/commerce.service';

@Module({
  imports: [CatalogModule],
  providers: [CommerceService],
  exports: [CommerceService],
})
export class CommerceModule {}

