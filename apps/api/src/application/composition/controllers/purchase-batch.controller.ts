import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { CatalogService } from '../../../modules/catalog/public';
import {
  CutPurchaseBatchDto, PurchaseBatchDetail, PurchaseBatchService, ReceivePurchaseBatchLineDto, ResolvePurchaseBatchLineDto,
  SendPurchaseBatchDto, UpdatePurchaseBatchDto, UpdatePurchaseBatchSettingsDto, isInternalBuyListMode,
} from '../../../modules/sourcing/public';

type RequestUser = { id: string };

/**
 * Scheduled purchase batches of the internal Buy List. Hub operators and Admin work the batches (view, cut early, mark sent, record
 * what physically arrived); only Admin changes the schedule. Sending is a record that staff ordered outside the system — no supplier
 * is contacted. Sourcing owns the rules; this controller only adds the exact catalog identity of each SKU.
 */
@Controller('purchase-batches')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'HUB_OPERATOR')
@RequirePermissions('hub.receive')
export class PurchaseBatchController {
  constructor(private readonly batches: PurchaseBatchService, private readonly catalog: CatalogService) {}

  private async withIdentity(detail: PurchaseBatchDetail) {
    const identities = new Map(await Promise.all([...new Set(detail.lines.map(line => line.skuId))]
      .map(async id => [id, await this.catalog.getSkuIdentity(id)] as const)));
    return {
      ...detail,
      lines: detail.lines.map(line => {
        const identity = identities.get(line.skuId);
        return { ...line, skuCode: identity?.code ?? line.skuCode, variantName: identity?.variantName ?? line.variantName,
          size: identity?.size ?? null, sizeUnit: identity?.sizeUnit ?? null, packCount: identity?.packCount ?? null, barcode: identity?.barcode ?? null };
      }),
    };
  }

  /** Batches (active by default) plus what is waiting for the next cutoff and the schedule. */
  @Get()
  async list(@Query('status') status?: string) {
    const filter = status === 'closed' || status === 'all' ? status : 'active';
    const [items, pending, schedule] = await Promise.all([this.batches.list(filter), this.batches.pending(), this.batches.schedule()]);
    return { mode: isInternalBuyListMode() ? 'INTERNAL_BUY_LIST' : 'INACTIVE', items, pending, schedule };
  }

  @Get('settings')
  settings() {
    return this.batches.schedule();
  }

  @Put('settings')
  @Roles('ADMIN')
  async updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdatePurchaseBatchSettingsDto) {
    await this.batches.updateSettings(dto, user.id);
    return this.batches.schedule();
  }

  /** Cut a batch now from everything no batch holds yet (early cutoff). */
  @Post('cut')
  @HttpCode(HttpStatus.OK)
  async cut(@CurrentUser() user: RequestUser, @Body() dto: CutPurchaseBatchDto) {
    return (await this.batches.cutNow(dto.idempotencyKey, user.id)) ?? { batchId: null, number: null, replayed: false, empty: true };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.withIdentity(await this.batches.detail(id));
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  async send(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendPurchaseBatchDto) {
    const result = await this.batches.send(id, dto, user.id);
    return { replayed: result.replayed, batch: await this.withIdentity(result.batch) };
  }

  @Patch(':id')
  async update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseBatchDto) {
    return this.withIdentity(await this.batches.updateDetails(id, dto, user.id));
  }

  @Post(':id/lines/:lineId/receive')
  @HttpCode(HttpStatus.OK)
  async receive(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: ReceivePurchaseBatchLineDto) {
    const result = await this.batches.receive({ batchId: id, lineId, quantity: dto.quantity, idempotencyKey: dto.idempotencyKey, cost: dto.cost, actorId: user.id });
    return { replayed: result.replayed, allocations: result.allocations, batch: await this.withIdentity(result.batch) };
  }

  @Post(':id/lines/:lineId/unavailable')
  @HttpCode(HttpStatus.OK)
  async unavailable(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: ResolvePurchaseBatchLineDto) {
    return this.withIdentity(await this.batches.resolveUnavailable({ batchId: id, lineId, actorId: user.id, note: dto.note }));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  async close(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.withIdentity(await this.batches.close(id, user.id));
  }
}
