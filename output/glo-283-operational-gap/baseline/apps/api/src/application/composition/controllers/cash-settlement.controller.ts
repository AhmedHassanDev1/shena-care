import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { SettlementStatus } from '@prisma/client';
import { PageQueryDto, page } from '../../../platform/api/paging.dto';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { CreateSettlementBatchDto, ReconciliationService, SettleRoundDto } from '../../../modules/ordering/public';
import { FulfillmentActor, FulfillmentService } from '../../../modules/fulfillment/public';

export class CollectionQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID()
  locationId?: string;

  @IsOptional() @IsIn(['expected', 'collected', 'settled', 'short', 'over', 'disputed', 'voided'])
  status?: SettlementStatus;

  @IsOptional() @IsUUID()
  courierId?: string;
}

export class BatchQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID()
  locationId?: string;
}

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

  /** Rounds waiting for a count at the operator's hubs: expected (fixed at dispatch) against what drivers declared. */
  @Get('rounds/open')
  async openRounds(@CurrentUser() actor: FulfillmentActor) {
    return this.reconciliation.listOpenRounds(await this.fulfillment.operatorLocationIds(actor));
  }

  /** Count one driver's whole round as a single total; the difference is shown on the round. */
  @Post('rounds')
  async settleRound(@CurrentUser() actor: FulfillmentActor, @Body() dto: SettleRoundDto) {
    return this.reconciliation.settleRound({ ...dto, actorId: actor.id }, await this.fulfillment.operatorLocationIds(actor));
  }

  /** Cashier queue (GLO-239): expected / declared / counted cash per order, own hubs only. */
  @Get('collections')
  async listCollections(@CurrentUser() actor: FulfillmentActor, @Query() query: CollectionQueryDto) {
    const allowed = await this.fulfillment.operatorLocationIds(actor);
    return this.reconciliation.listCollections({ locationIds: allowed, locationId: query.locationId, status: query.status, courierId: query.courierId, ...page(query) });
  }

  @Get('batches')
  async listBatches(@CurrentUser() actor: FulfillmentActor, @Query() query: BatchQueryDto) {
    const allowed = await this.fulfillment.operatorLocationIds(actor);
    return this.reconciliation.listSettlementBatches({ locationIds: allowed, locationId: query.locationId, ...page(query) });
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
