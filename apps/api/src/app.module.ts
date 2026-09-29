import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CommerceModule } from './modules/commerce/commerce.module';
import { CompositionModule } from './application/composition/composition.module';
import { DatabaseModule } from './platform/database/database.module';
import { SourcingModule } from './modules/sourcing/sourcing.module';
import { OrderingModule } from './modules/ordering/ordering.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    CatalogModule,
    CommerceModule,
    CompositionModule,
    SourcingModule,
    OrderingModule,
    FulfillmentModule,
    IngestionModule,
  ],
})
export class AppModule {}
