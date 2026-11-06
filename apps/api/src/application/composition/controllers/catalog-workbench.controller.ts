import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { MediaRightsStatus, MediaRole } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { CatalogIntakeService } from '../../../modules/catalog/public';
import { CanonicalResearchService } from '../../../modules/ingestion/public';
import { CatalogPublicationService } from '../services/catalog-publication.service';
import { CatalogAutopilotService, ExceptionResolution } from '../services/catalog-autopilot.service';
import { CatalogDecisionLogService } from '../../../modules/ingestion/public';
import { CatalogExceptionStatus } from '@prisma/client';
import { ValidateNested } from 'class-validator';

type RequestUser = { id: string };

export class ManualIntakeDto {
  @IsUUID() brandId: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() productLineId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsString() @MinLength(1) @MaxLength(120) variantName: string;
  @IsString() @Matches(/^[A-Za-z0-9._-]+$/, { message: 'SKU code may contain letters, digits, dots, dashes and underscores' }) @MaxLength(80) skuCode: string;
  @Type(() => Number) @IsNumber() @IsPositive() size: number;
  @IsIn(['ml', 'g', 'l', 'kg', 'oz', 'piece']) sizeUnit: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) packCount?: number;
  @IsOptional() @Matches(/^\d{8,14}$/, { message: 'Barcode must be 8 to 14 digits' }) barcode?: string;
  @IsOptional() @IsBoolean() hasOuterCarton?: boolean;
}

export class StartResearchDto {
  /** Pages a person picked: the manufacturer's product page first. */
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true }) sourceUrls?: string[];
  /** Spends configured provider credits (Exa, Firecrawl, model) only when asked for. */
  @IsOptional() @IsBoolean() useConfiguredProviders?: boolean;
}

export class ReviewFactDto {
  @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
  @IsString() @MinLength(5) @MaxLength(500) note: string;
  @IsOptional() @IsBoolean() overwrite?: boolean;
}

export class ImportSourceImageDto {
  @IsUrl({ protocols: ['https'], require_protocol: true }) imageUrl: string;
  @IsEnum(MediaRole) role: MediaRole;
  @IsEnum(MediaRightsStatus) rightsStatus: MediaRightsStatus;
  @IsString() @MinLength(2) @MaxLength(200) sourcePublisher: string;
}

export class PublishSkuDto {
  /** The approved customer price; needed unless this SKU already has an active one. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() priceEgp?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() compareAtEgp?: number;
}

export class RowCorrectionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) name?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) brand?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive() size?: number;
  @IsOptional() @IsIn(['ml', 'g', 'l', 'kg', 'oz', 'piece']) sizeUnit?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) categoryHint?: string;
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) sourceUrl?: string;
  @IsOptional() @Matches(/^\d{8,14}$/, { message: 'Barcode must be 8 to 14 digits' }) barcode?: string;
}

export class ResolveExceptionDto {
  @IsIn(['RESOLVE', 'CORRECT', 'REJECT', 'RETRY']) action: ExceptionResolution['action'];
  @IsString() @MinLength(3) @MaxLength(500) note: string;
  @IsOptional() @IsUUID() skuId?: string;
  @IsOptional() @IsUUID() factId?: string;
  @IsOptional() @ValidateNested() @Type(() => RowCorrectionDto) correction?: RowCorrectionDto;
}

export class RefreshSkuDto {
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true }) sourceUrls?: string[];
}

export class CartonDecisionDto {
  @IsBoolean() hasOuterCarton: boolean;
}

/** The owner's product workspace: intake, research, evidence review, media state and publication for one canonical SKU. Independent of supplier files. */
@Controller('catalog/workbench')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('catalog.manage')
export class CatalogWorkbenchController {
  constructor(
    private readonly publication: CatalogPublicationService,
    private readonly research: CanonicalResearchService,
    private readonly catalog: CatalogIntakeService,
    private readonly autopilot: CatalogAutopilotService,
    private readonly decisions: CatalogDecisionLogService,
  ) {}

  /** Runs the automatic pipeline over an Admin list: every row ends AUTO_ACCEPT, AUTO_LINK, SKIP, HOLD_CRITICAL or RETRY_AUTOMATIC. Safe to call again. */
  @Post('imports/:jobId/autopilot')
  @HttpCode(HttpStatus.OK)
  runAutopilot(@CurrentUser() user: RequestUser, @Param('jobId', ParseUUIDPipe) jobId: string, @Query('limit') limit?: string) {
    return this.autopilot.runJob(jobId, user.id, { limit: limit ? Math.min(Math.max(Number(limit) || 1, 1), 500) : undefined });
  }

  /** The Critical Exceptions Queue: only what needs a person. */
  @Get('exceptions')
  exceptions(@Query('status') status?: string, @Query('skuId') skuId?: string) {
    const wanted = status && status in CatalogExceptionStatus ? (status as CatalogExceptionStatus) : CatalogExceptionStatus.OPEN;
    return this.decisions.list({ status: wanted, ...(skuId && { skuId }) });
  }

  @Post('exceptions/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolveException(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveExceptionDto) {
    if (dto.action === 'CORRECT' && !dto.correction) throw new BadRequestException('A correction needs the corrected values');
    const input = (dto.action === 'CORRECT' ? { action: 'CORRECT', note: dto.note, correction: dto.correction }
      : { action: dto.action, note: dto.note, skuId: dto.skuId, factId: dto.factId }) as ExceptionResolution;
    return this.autopilot.resolveException(id, input, user.id);
  }

  /** Every automatic and manual decision about a row or SKU, oldest first. */
  @Get('decisions/:subjectId')
  decisionTrail(@Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.decisions.decisionsFor(subjectId);
  }

  @Get('autopilot/summary')
  summary() {
    return this.decisions.summary();
  }

  /** Reads an existing SKU's sources again (optionally new pages), re-verifies its facts and prepares its media. */
  @Post('skus/:skuId/refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@CurrentUser() user: RequestUser, @Param('skuId', ParseUUIDPipe) skuId: string, @Body() dto: RefreshSkuDto) {
    return this.autopilot.refreshSku(skuId, user.id, dto.sourceUrls ?? []);
  }

  @Get('skus')
  search(@Query('q') q?: string) {
    return this.catalog.search(q, 40);
  }

  @Post('intake')
  intake(@Body() dto: ManualIntakeDto) {
    return this.publication.intake(dto);
  }

  @Get('skus/:skuId')
  workbench(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.publication.workbench(skuId);
  }

  @Get('skus/:skuId/readiness')
  readiness(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.publication.readiness(skuId);
  }

  @Patch('skus/:skuId/carton')
  carton(@Param('skuId', ParseUUIDPipe) skuId: string, @Body() dto: CartonDecisionDto) {
    return this.catalog.setOuterCarton(skuId, dto.hasOuterCarton);
  }

  @Post('skus/:skuId/research')
  startResearch(@CurrentUser() user: RequestUser, @Param('skuId', ParseUUIDPipe) skuId: string, @Body() dto: StartResearchDto) {
    return this.research.startRun(skuId, dto, user.id);
  }

  @Post('research/runs/:runId/resume')
  @HttpCode(HttpStatus.OK)
  resume(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.research.resume(runId);
  }

  @Post('research/facts/:factId/review')
  @HttpCode(HttpStatus.OK)
  reviewFact(@CurrentUser() user: RequestUser, @Param('factId', ParseUUIDPipe) factId: string, @Body() dto: ReviewFactDto) {
    return this.research.review(factId, dto, user.id);
  }

  @Post('research/facts/:factId/import-image')
  importImage(@CurrentUser() user: RequestUser, @Param('factId', ParseUUIDPipe) factId: string, @Body() dto: ImportSourceImageDto) {
    return this.publication.importSourceImage(factId, dto, user.id);
  }

  @Post('skus/:skuId/publish')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentUser() user: RequestUser, @Param('skuId', ParseUUIDPipe) skuId: string, @Body() dto: PublishSkuDto) {
    return this.publication.publish(skuId, user.id, dto.priceEgp !== undefined ? { priceEgp: dto.priceEgp, compareAtEgp: dto.compareAtEgp } : undefined);
  }

  @Post('skus/:skuId/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.publication.unpublish(skuId);
  }
}
