import { Module } from '@nestjs/common';
import { FulfillmentService } from './services/fulfillment.service';
import { RoutePlanningService } from './services/route-planning.service';
import { ROUTING_PROVIDER } from './routing/routing.provider';
import { MapboxDirectionsRoutingProvider } from './routing/mapbox-directions.provider';
import { FulfillmentController } from './fulfillment.controller';
import { OrderingModule } from '../ordering/public';
import { OperationsModule } from '../operations/operations.module';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';

@Module({
  imports: [OrderingModule, OperationsModule, CatalogModule, SourcingModule],
  controllers: [FulfillmentController],
  providers: [
    FulfillmentService,
    RoutePlanningService,
    {
      provide: ROUTING_PROVIDER,
      useFactory: () => {
        const provider = process.env.ROUTING_PROVIDER || 'mapbox';
        if (provider === 'mapbox') {
          return new MapboxDirectionsRoutingProvider();
        }
        throw new Error(`Unsupported routing provider: ${provider}`);
      },
    },
  ],
  exports: [FulfillmentService, RoutePlanningService, ROUTING_PROVIDER],
})
export class FulfillmentModule {}

