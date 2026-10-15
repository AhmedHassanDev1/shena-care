import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { page } from '../../../platform/api/paging.dto';
import { OrderingService, ReconciliationService } from '../../../modules/ordering/public';
import { FulfillmentActor, FulfillmentService } from '../../../modules/fulfillment/public';
import { PayablesService, PurchaseOrderService, SourcingService, SupplyPlanService } from '../../../modules/sourcing/public';
import { CatalogService } from '../../../modules/catalog/public';
import { SupportService } from '../../../modules/operations/services/support.service';
import { DomainEventsService } from '../../../platform/events/domain-events.service';
import { AdminOrderQueryDto } from '../dto/workspace.dto';

/**
 * Founder order console (C0 W2). Read-only composition: every section comes from its owning module
 * and every change still goes through that module's command endpoint. Admin only.
 */
@Controller('admin/orders')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('order.read')
export class AdminOrdersController {
  constructor(
    private readonly ordering: OrderingService,
    private readonly reconciliation: ReconciliationService,
    private readonly fulfillment: FulfillmentService,
    private readonly supplyPlan: SupplyPlanService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly payables: PayablesService,
    private readonly sourcing: SourcingService,
    private readonly catalog: CatalogService,
    private readonly support: SupportService,
    private readonly events: DomainEventsService,
  ) {}

  @Get()
  async list(@Query() query: AdminOrderQueryDto) {
    return this.ordering.listOrdersForStaff({ status: query.status, q: query.q, ...page(query) });
  }

  @Get(':idOrOrderNumber')
  async detail(@CurrentUser() actor: FulfillmentActor, @Param('idOrOrderNumber') idOrOrderNumber: string) {
    const order = await this.ordering.getOrder(idOrOrderNumber);
    if (!order) throw new NotFoundException('Order not found');

    const [timeline, plan, poLines, trail, money, cases, events, suppliers] = await Promise.all([
      this.ordering.getStaffTimeline(order.id),
      this.supplyPlan.getPlan(order.id).catch(() => null),
      this.purchaseOrders.listLinesForOrder(order.id),
      this.fulfillment.getOrderFulfillmentTrail(order.id, actor),
      this.reconciliation.getOrderMoney(order.id),
      this.support.getCases(undefined, { orderId: order.id, take: 50 }),
      this.events.list({ aggregateId: order.id, take: 50 }),
      this.sourcing.getSuppliers(),
    ]);
    const poIds = [...new Set(poLines.map(line => line.purchaseOrderId))];
    const payables = poIds.length ? (await this.payables.listPayables({ purchaseOrderIds: poIds, take: 100, skip: 0 })).items : [];
    const labels = await this.catalog.getSkuLabels([...order.items.map(i => i.skuId), ...poLines.map(l => l.skuId)]);
    const supplierName = new Map(suppliers.map(s => [s.id, s.name]));

    return {
      order: { ...order, items: order.items.map(item => ({ ...item, sku: labels.get(item.skuId) ?? null })) },
      timeline,
      supplyPlan: plan,
      purchaseOrderLines: poLines.map(line => ({ ...line, supplierName: supplierName.get(line.supplierId) ?? null, sku: labels.get(line.skuId) ?? null })),
      payables,
      fulfillment: trail,
      money,
      supportCases: cases.map(c => ({ id: c.id, status: c.status, priority: c.priority, category: c.category, title: c.title, createdAt: c.createdAt })),
      events: events.map(e => ({ id: e.id, eventType: e.eventType, consumer: e.consumer, status: e.status, attempts: e.attempts, lastError: e.lastError, createdAt: e.createdAt })),
    };
  }
}
