import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { PageQueryDto, page } from '../../../platform/api/paging.dto';
import { CASH_VARIANCE_LARGE, OrderingService, ReconciliationService } from '../../../modules/ordering/public';
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
      shortCash, overCash, deliveredUnsettled, failedEvents, deadEvents, openCases,
      totalFailedEvents, totalDeadEvents, supplierResponses, lateOrders, unsettledRounds, roundVariances] = await Promise.all([
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
      this.events.count({ status: 'failed' }),
      this.events.count({ status: 'dead' }),
      this.purchaseOrders.listOverdueResponses(),
      this.ordering.listLateOrders(paging),
      this.reconciliation.listOpenRounds('all', 12), // counted within 12 hours of the driver's first declaration
      this.reconciliation.listRoundVariances('all', paging.take),
    ]);
    const orders = await this.ordering.getOrderSummaries([
      ...supplyActionRequired.items.map(i => i.orderId), ...failedDeliveries.items.map(i => i.orderId),
    ]);
    // Big cash differences first and marked, so a few coins of change never bury a real shortage.
    const bySeverity = <T extends { variance: string | null }>(cash: { total: number; items: T[] }) => ({
      ...cash,
      items: cash.items.map(item => ({ ...item, severity: Math.abs(Number(item.variance ?? 0)) > CASH_VARIANCE_LARGE ? 'large' as const : 'small' as const }))
        .sort((a, b) => Number(b.severity === 'large') - Number(a.severity === 'large')),
    });
    const withNumber = <T extends { orderId: string }>(items: T[]) => items.map(item => ({ ...item, orderNumber: orders.get(item.orderId)?.orderNumber ?? null }));
    const events = (rows: Awaited<ReturnType<DomainEventsService['list']>>) => rows.map(e => ({
      id: e.id, eventType: e.eventType, consumer: e.consumer, aggregateId: e.aggregateId, attempts: e.attempts, lastError: e.lastError, nextAttemptAt: e.nextAttemptAt,
    }));
    return {
      supplyActionRequired: { ...supplyActionRequired, items: withNumber(supplyActionRequired.items) },
      customerDecisionsPending,
      distributionRequired,
      failedDeliveries: { ...failedDeliveries, items: withNumber(failedDeliveries.items) },
      cashVariances: { short: bySeverity(shortCash), over: bySeverity(overCash) },
      supplierResponses,
      lateOrders,
      unsettledRounds: { total: unsettledRounds.length, items: unsettledRounds },
      roundVariances,
      deliveredUnsettled,
      eventFailures: {
        failed: events(failedEvents),
        dead: events(deadEvents),
        totalFailed: totalFailedEvents,
        totalDead: totalDeadEvents,
      },
      openCases,
    };
  }
}
