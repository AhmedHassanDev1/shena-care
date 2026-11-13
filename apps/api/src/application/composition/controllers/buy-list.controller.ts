import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { CatalogService } from '../../../modules/catalog/public';
import { AcquireBuyListDto, BuyListScopeDto, BuyListService } from '../../../modules/sourcing/public';

type RequestUser = { id: string };

/**
 * Internal aggregated Buy List (GLO-296). Hub operators and Admin only — drivers, customers and suppliers have no route here.
 * Demand and the acquired/unavailable markers belong to Sourcing; this controller only adds the exact catalog identity of each SKU.
 */
@Controller('buy-list')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'HUB_OPERATOR')
@RequirePermissions('hub.receive')
export class BuyListController {
  constructor(private readonly buyList: BuyListService, private readonly catalog: CatalogService) {}

  @Get()
  async list() {
    const result = await this.buyList.list();
    const identities = await Promise.all(result.items.map(item => this.catalog.getSkuIdentity(item.skuId)));
    return {
      ...result,
      items: result.items.map((item, index) => {
        const identity = identities[index];
        return {
          ...item,
          // The catalog is the identity; the order snapshot only labels the line when the SKU was removed from the catalog.
          skuCode: identity?.code ?? item.skuCode,
          variantName: identity?.variantName ?? item.variantName,
          size: identity?.size ?? null,
          sizeUnit: identity?.sizeUnit ?? null,
          packCount: identity?.packCount ?? null,
          barcode: identity?.barcode ?? null,
          skuActive: identity?.isActive ?? false,
        };
      }),
    };
  }

  @Post('acquire')
  @HttpCode(HttpStatus.OK)
  acquire(@CurrentUser() user: RequestUser, @Body() dto: AcquireBuyListDto) {
    return this.buyList.acquire({ ...dto, actorId: user.id });
  }

  @Post('unavailable')
  @HttpCode(HttpStatus.OK)
  unavailable(@CurrentUser() user: RequestUser, @Body() dto: BuyListScopeDto) {
    return this.buyList.markUnavailable({ ...dto, actorId: user.id });
  }

  @Post('reopen')
  @HttpCode(HttpStatus.OK)
  reopen(@CurrentUser() user: RequestUser, @Body() dto: BuyListScopeDto) {
    return this.buyList.reopen({ skuId: dto.skuId, orderIds: dto.orderIds, actorId: user.id });
  }
}
