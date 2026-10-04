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
import { CareModule } from './modules/care/care.module';
import { AiModule } from './platform/ai/ai.module';
import { GuidanceModule } from './modules/guidance/guidance.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { OperationsModule } from './modules/operations/operations.module';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { RequestIdMiddleware } from './platform/logger/request-id.middleware';

import { MessagingModule } from './modules/messaging/messaging.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HealthController } from './platform/api/health.controller';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    AiModule,
    CatalogModule,
    CommerceModule,
    CompositionModule,
    SourcingModule,
    OrderingModule,
    FulfillmentModule,
    IngestionModule,
    CareModule,
    GuidanceModule,
    AccountsModule,
    OperationsModule,
    MessagingModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
