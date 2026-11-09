import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { MediaRightsStatus, MediaRole } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { CatalogIntakeService, CanonicalResearchService, CatalogDecisionLogService } from '../../../modules/catalog/public';
import { CatalogPublicationService } from '../services/catalog-publication.service';
import { CatalogProfileService } from '../services/catalog-profile.service';
import { CatalogExceptionStatus } from '@prisma/client';

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
  @IsString() @MinLength(2) @MaxLength(120) sourcePublisher: string;
  @IsOptional() @IsString() @MaxLength(300) licenseUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) copyrightNotice?: string;
}

export class PublishSkuDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) priceEgp?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) compareAtEgp?: number;
}

export class RefreshSkuDto {
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true }) sourceUrls?: string[];
}

export class BrandResearchDto {
  /** The brand's own site (homepage). */
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) websiteUrl?: string;
  /** A page of the company that owns or makes the brand (e.g. its "about us"). */
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) ownerPageUrl?: string;
  /** Pages listing the brand's range (its own site, its owner's store, an approved distributor). */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true }) rangeUrls?: string[];
}

export class SequenceDto {
  @IsArray() @ArrayMaxSize(30) @IsUUID('all', { each: true }) skuIds: string[];
  @IsOptional() @IsIn(['AM', 'PM']) period?: 'AM' | 'PM';
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
    private readonly decisions: CatalogDecisionLogService,
    private readonly profiles: CatalogProfileService,
  ) {}

  /** The Critical Exceptions Queue: only what needs a person. */
  @Get('exceptions')
  exceptions(@Query('status') status?: string, @Query('skuId') skuId?: string) {
    const wanted = status && status in CatalogExceptionStatus ? (status as CatalogExceptionStatus) : CatalogExceptionStatus.OPEN;
    return this.decisions.list({ status: wanted, ...(skuId && { skuId }) });
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
  async refresh(@CurrentUser() user: RequestUser, @Param('skuId', ParseUUIDPipe) skuId: string, @Body() dto: RefreshSkuDto) {
    await this.profiles.repairUsage(skuId, user.id);
    if (dto.sourceUrls?.length) await this.research.startRun(skuId, { sourceUrls: dto.sourceUrls }, user.id);
    const verified = await this.research.autoVerify(skuId, user.id);
    for (const hold of verified.holds) await this.decisions.open({ subjectType: 'SKU', subjectId: skuId, skuId, hold, evidence: { factIds: hold.factIds } });
    const profile = await this.profiles.refresh(skuId, user.id);
    return { verified, profile, openExceptions: await this.decisions.openForSku(skuId) };
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

  /** The enriched SKU: identity, classification, composition, usage, routine metadata, safety, media, sources, field coverage and publication blockers. */
  @Get('skus/:skuId/profile')
  skuProfile(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.profiles.skuProfile(skuId);
  }

  /** Recomputes classification and routine metadata from the SKU's verified facts (derived data; safe to repeat). */
  @Post('skus/:skuId/profile/rebuild')
  @HttpCode(HttpStatus.OK)
  rebuildProfile(@CurrentUser() user: RequestUser, @Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.profiles.refresh(skuId, user.id);
  }

  /** Recomputes every verified SKU's derived profiles, e.g. after a rule version change. */
  @Post('profiles/rebuild')
  @HttpCode(HttpStatus.OK)
  rebuildAll(@CurrentUser() user: RequestUser) {
    return this.profiles.refreshAll(user.id);
  }

  /** Researches a brand we hold from the pages named (its site, its owner's page, range pages); keeps the evidence on the brand profile. */
  @Post('brands/:brandId/research')
  @HttpCode(HttpStatus.OK)
  researchBrand(@CurrentUser() user: RequestUser, @Param('brandId', ParseUUIDPipe) brandId: string, @Body() dto: BrandResearchDto) {
    if (!dto.websiteUrl && !dto.ownerPageUrl && !dto.rangeUrls?.length) throw new BadRequestException('Name at least one page to read');
    return this.profiles.enrichBrand(brandId, dto, user.id);
  }

  /** The persisted routine profile with its machine-readable product context, for unpublished SKUs too (Admin). */
  @Get('skus/:skuId/routine-profile')
  routineProfile(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.profiles.routineProfileWithContext(skuId);
  }

  /** Orders SKUs into one routine from their persisted placement constraints (Admin; unpublished SKUs allowed). */
  @Post('routines/sequence')
  @HttpCode(HttpStatus.OK)
  sequence(@Body() dto: SequenceDto) {
    return this.profiles.sequence(dto.skuIds, dto.period, false);
  }

  /** The brand profile: identity with evidence, aliases, and the (explicitly partial) portfolio its verified SKUs show. */
  @Get('brands/:brandId/profile')
  brandProfile(@Param('brandId', ParseUUIDPipe) brandId: string) {
    return this.profiles.brandProfile(brandId);
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
