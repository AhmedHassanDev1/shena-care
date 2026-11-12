import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import {
  CatalogItemManagementService,
  CatalogItemReadinessFilter,
  CatalogItemStatusFilter,
  VERIFIED_IDENTITY_STATES,
} from '../../../modules/catalog/public';
import { CommerceService } from '../../../modules/commerce/public';

export class ItemQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['active', 'archived']) state?: 'active' | 'archived';
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsIn(['published', 'draft', 'archived']) status?: CatalogItemStatusFilter;
  @IsOptional()
  @IsIn(['missing_image', 'pending_image', 'missing_price', 'not_listed', 'incomplete', 'ready'])
  readiness?: CatalogItemReadinessFilter;
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
    const [pricedSkuIds, listedSkuIds, pendingImageSkuIds] = await Promise.all([
      query.readiness === 'missing_price' || query.readiness === 'ready'
        ? this.commerce.getPricedSkuIds()
        : Promise.resolve(undefined),
      query.readiness === 'not_listed'
        ? this.commerce.getListedSkuIds()
        : Promise.resolve(undefined),
      query.readiness === 'pending_image'
        ? this.items.getPendingImageSkuIds()
        : Promise.resolve(undefined),
    ]);

    const result = await this.items.list(
      query.page,
      query.limit,
      query.q?.trim(),
      query.state,
      {
        brandId: query.brandId,
        categoryId: query.categoryId,
        status: query.status,
        readiness: query.readiness,
        pricedSkuIds,
        listedSkuIds,
        pendingImageSkuIds,
      },
    );

    return { ...result, items: await this.withReadiness(result.items) };
  }

  @Get('media/:mediaId/file')
  async mediaFile(@Param('mediaId', ParseUUIDPipe) mediaId: string, @Res() res: Response) {
    const { stream, filename } = await this.items.openMediaFile(mediaId);
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const mime: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', avif: 'image/avif' };
    res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
  }

  @Get(':productId')
  async getOne(@Param('productId', ParseUUIDPipe) productId: string) {
    const item = await this.items.getOne(productId);
    const [decorated] = await this.withReadiness([item]);
    return decorated;
  }

  private async withReadiness<T extends { archivedAt: Date | null; categoryId: string | null; media: unknown[]; skus: Array<{ id: string; size: number | null; sizeUnit: string | null; variantName: string; barcode: string | null; identityStatus: string; hasOuterCarton: boolean | null; primaryMediaState: string; isActive: boolean }> }>(items: T[]) {
    const skuIds = items.flatMap((product) => product.skus.map((sku) => sku.id));
    const commercialMap = await this.commerce.getSkuCommercialSummaryBatch(skuIds);

    return items.map((product) => {
        const productIssues = new Set<string>();
        const skus = product.skus.map((sku) => {
          const commercial = commercialMap[sku.id] ?? { isListed: false, price: null };
          const issues: string[] = [];

          if (!product.archivedAt) {
            if (!product.categoryId) issues.push('CATEGORY_MISSING');
            if (sku.size === null || !sku.sizeUnit || !sku.variantName) {
              issues.push('IDENTITY_INCOMPLETE');
            }
            if (!VERIFIED_IDENTITY_STATES.has(sku.identityStatus) && !sku.barcode) {
              issues.push('IDENTITY_NOT_VERIFIED');
            }
            if (sku.hasOuterCarton === null) issues.push('CARTON_DECISION_MISSING');
            if (sku.primaryMediaState === 'MISSING') {
              issues.push('PRIMARY_PACKSHOT_MISSING');
            } else if (sku.primaryMediaState === 'PENDING_REVIEW') {
              issues.push('PRIMARY_PACKSHOT_PENDING_REVIEW');
            } else if (sku.primaryMediaState === 'REJECTED') {
              issues.push('PRIMARY_PACKSHOT_REJECTED');
            } else if (sku.primaryMediaState === 'APPROVED' && !product.media.length) {
              issues.push('PRIMARY_PACKSHOT_NOT_PUBLISHED');
            }
            if (!commercial.price) issues.push('SELLING_PRICE_MISSING');
            if (!commercial.isListed) issues.push('LISTING_NOT_ACTIVE');
            if (!sku.isActive) issues.push('SKU_INACTIVE');
          }

          for (const issue of issues) productIssues.add(issue);

          return {
            ...sku,
            isListed: commercial.isListed,
            currentPrice: commercial.price,
            readinessIssues: issues,
          };
        });

        const readinessStatus = product.archivedAt
          ? ('ARCHIVED' as const)
          : productIssues.size === 0 && skus.length > 0
            ? ('READY' as const)
            : ('NEEDS_ATTENTION' as const);

        return {
          ...product,
          skus,
          readiness: {
            status: readinessStatus,
            issues: Array.from(productIssues),
          },
        };
    });
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
