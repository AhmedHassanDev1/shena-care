import { Module } from '@nestjs/common';
import { FulfillmentService } from './services/fulfillment.service';
import { RoutePlanningService } from './services/route-planning.service';
import { ROUTING_PROVIDER } from './routing/routing.provider';
import { MapboxDirectionsRoutingProvider } from './routing/mapbox-directions.provider';
import { RouteOptimizationService } from './services/route-optimization.service';
import { DispatchPlanningService } from './services/dispatch-planning.service';
import { ROUTE_OPTIMIZATION_PROVIDER } from './routing/route-optimization.provider';
import { MapboxOptimizationProvider } from './routing/mapbox-optimization.provider';
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
    RouteOptimizationService,
    DispatchPlanningService,
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
    {
      provide: ROUTE_OPTIMIZATION_PROVIDER,
      useFactory: () => {
        const provider = process.env.ROUTE_OPTIMIZATION_PROVIDER || 'mapbox';
        if (provider === 'mapbox') {
          return new MapboxOptimizationProvider();
        }
        throw new Error(`Unsupported route optimization provider: ${provider}`);
      },
    },
  ],
  exports: [
    FulfillmentService,
    RoutePlanningService,
    RouteOptimizationService,
    DispatchPlanningService,
    ROUTING_PROVIDER,
    ROUTE_OPTIMIZATION_PROVIDER,
  ],
})
export class FulfillmentModule {}

