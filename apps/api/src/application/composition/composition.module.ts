import { Module } from '@nestjs/common';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { CommerceModule } from '../../modules/commerce/commerce.module';
import { ProductViewController } from './controllers/product-view.controller';
import { ProductViewService } from './services/product-view.service';

@Module({
  imports: [CatalogModule, CommerceModule],
  controllers: [ProductViewController],
  providers: [ProductViewService],
})
export class CompositionModule {}
