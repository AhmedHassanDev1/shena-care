import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { CreateSettlementBatchDto, ReconciliationService } from '../../../modules/ordering/public';
import { FulfillmentActor, FulfillmentService } from '../../../modules/fulfillment/public';

/**
 * Cash counting at a hub (GLO-238). Composition owns the cross-module scope check: Fulfillment knows
 * which hubs an operator works at, Ordering owns the collections and the settlement facts.
 */
@Controller('ordering/settlements')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'HUB_OPERATOR')
@RequirePermissions('cod.reconcile')
export class CashSettlementController {
  constructor(private readonly reconciliation: ReconciliationService, private readonly fulfillment: FulfillmentService) {}

  @Post('batch')
  async createSettlementBatch(@CurrentUser() actor: FulfillmentActor, @Body() dto: CreateSettlementBatchDto) {
    const allowed = await this.fulfillment.operatorLocationIds(actor);
    return this.reconciliation.createSettlementBatch({ ...dto, actorId: actor.id }, allowed);
  }

  @Get('batches/:id')
  async getSettlementBatch(@CurrentUser() actor: FulfillmentActor, @Param('id', ParseUUIDPipe) id: string) {
    const batch = await this.reconciliation.getSettlementBatch(id);
    const allowed = await this.fulfillment.operatorLocationIds(actor);
    if (allowed !== 'all' && (!batch.locationId || !allowed.includes(batch.locationId))) {
      throw new NotFoundException('Settlement batch not found'); // no existence leak across hubs
    }
    return batch;
  }
}
