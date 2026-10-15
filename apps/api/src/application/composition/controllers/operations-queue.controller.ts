import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { PageQueryDto, page } from '../../../platform/api/paging.dto';
import { OrderingService, ReconciliationService } from '../../../modules/ordering/public';
import { FulfillmentService } from '../../../modules/fulfillment/public';
import { PurchaseOrderService, SupplyPlanService } from '../../../modules/sourcing/public';
import { SupportService } from '../../../modules/operations/services/support.service';
import { DomainEventsService } from '../../../platform/events/domain-events.service';

/**
 * Admin attention queue (GLO-239): one read of everything that waits on a human, each section
 * from its owning module, counts plus the oldest items. No state is owned or copied here.
 */
@Controller('operations/queues')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('dashboard.read')
export class OperationsQueueController {
  constructor(
    private readonly ordering: OrderingService,
    private readonly reconciliation: ReconciliationService,
    private readonly fulfillment: FulfillmentService,
    private readonly supplyPlan: SupplyPlanService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly support: SupportService,
    private readonly events: DomainEventsService,
  ) {}

  @Get('attention')
  async attention(@Query() query: PageQueryDto) {
    const paging = page(query, 10);
    const [supplyActionRequired, customerDecisionsPending, distributionRequired, failedDeliveries,
      shortCash, overCash, deliveredUnsettled, failedEvents, deadEvents, openCases] = await Promise.all([
      this.supplyPlan.listOpenActionRequirements(paging),
      this.ordering.listPendingDecisions(paging),
      this.purchaseOrders.listDistributionRequired(paging),
      this.fulfillment.listFailedDeliveries(paging),
      this.reconciliation.listCollections({ locationIds: 'all', status: 'short', ...paging }),
      this.reconciliation.listCollections({ locationIds: 'all', status: 'over', ...paging }),
      this.reconciliation.listCollections({ locationIds: 'all', status: 'collected', ...paging }),
      this.events.list({ status: 'failed', take: paging.take }),
      this.events.list({ status: 'dead', take: paging.take }),
      this.support.openCaseSummary(paging.take),
    ]);
    const orders = await this.ordering.getOrderSummaries([
      ...supplyActionRequired.items.map(i => i.orderId), ...failedDeliveries.items.map(i => i.orderId),
    ]);
    const withNumber = <T extends { orderId: string }>(items: T[]) => items.map(item => ({ ...item, orderNumber: orders.get(item.orderId)?.orderNumber ?? null }));
    const events = (rows: Awaited<ReturnType<DomainEventsService['list']>>) => rows.map(e => ({
      id: e.id, eventType: e.eventType, consumer: e.consumer, aggregateId: e.aggregateId, attempts: e.attempts, lastError: e.lastError, nextAttemptAt: e.nextAttemptAt,
    }));
    return {
      supplyActionRequired: { ...supplyActionRequired, items: withNumber(supplyActionRequired.items) },
      customerDecisionsPending,
      distributionRequired,
      failedDeliveries: { ...failedDeliveries, items: withNumber(failedDeliveries.items) },
      cashVariances: { short: shortCash, over: overCash },
      deliveredUnsettled,
      eventFailures: { failed: events(failedEvents), dead: events(deadEvents) },
      openCases,
    };
  }
}
