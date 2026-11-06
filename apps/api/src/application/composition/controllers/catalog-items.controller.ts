import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CatalogItemManagementService } from '../../../modules/catalog/public';
import { CommerceService } from '../../../modules/commerce/public';

export class ItemQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['active', 'archived']) state?: 'active' | 'archived';
}

export class VisibilityDto { @IsBoolean() isVisible: boolean; }
export class AvailabilityDto { @IsBoolean() isActive: boolean; }

@Controller('catalog/items')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class CatalogItemsController {
  constructor(
    private readonly items: CatalogItemManagementService,
    private readonly commerce: CommerceService,
  ) {}

  @Get()
  async list(@Query() query: ItemQueryDto) {
    const result = await this.items.list(query.page, query.limit, query.q?.trim(), query.state);
    const listingStates = await this.commerce.getListingStates(result.items.flatMap((product) => product.skus.map((sku) => sku.id)));
    return {
      ...result,
      items: result.items.map((product) => ({
        ...product,
        skus: product.skus.map((sku) => ({
          ...sku,
          isListed: listingStates[sku.id] ?? false,
        })),
      })),
    };
  }

  @Patch('skus/:skuId/visibility')
  async visibility(@Param('skuId', ParseUUIDPipe) skuId: string, @Body() body: VisibilityDto) {
    await this.items.ensureSkuEditable(skuId);
    return body.isVisible ? this.commerce.listSku(skuId) : this.commerce.unlistSku(skuId);
  }

  @Patch('skus/:skuId/availability')
  async availability(@Param('skuId', ParseUUIDPipe) skuId: string, @Body() body: AvailabilityDto) {
    return this.items.setSkuActive(skuId, body.isActive);
  }

  @Post(':productId/archive')
  archive(@Param('productId', ParseUUIDPipe) productId: string) { return this.items.archive(productId); }

  @Post(':productId/restore')
  restore(@Param('productId', ParseUUIDPipe) productId: string) { return this.items.restore(productId); }
}
