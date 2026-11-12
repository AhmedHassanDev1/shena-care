import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IntakeRowOutcome, IntakeSource } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { ColumnMap, IntakeStoreService } from '../../../modules/intake/public';
import { AdminIntakeService } from '../services/intake/admin-intake.service';
import { SupplierIntakeService } from '../services/intake/supplier-intake.service';
import { IntakeRunnerService } from '../services/intake/intake-runner.service';
import { MarketPriceResearchService } from '../services/intake/market-price-research.service';
import { CatalogEnrichmentService } from '../services/intake/catalog-enrichment.service';

type RequestUser = { id: string; roles?: string[]; supplierId?: string | null };

/** Spreadsheets and plain text lists only, held in memory (never written to disk), 10 MB at most. */
export const intakeUpload = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, done: (error: Error | null, accept: boolean) => void) => {
    const ok = /\.(xlsx|xls|csv|tsv|txt)$/i.test(file.originalname);
    done(ok ? null : new BadRequestException({ code: 'UNSUPPORTED_FILE', message: 'Upload an .xlsx, .xls, .csv or .txt file' }), ok);
  },
};

const FIELDS = ['name', 'brand', 'purchasePrice', 'consumerPrice', 'discountPercent', 'price', 'code', 'barcode', 'quantity', 'size', 'category', 'url'];
/** Optional explicit column mapping sent as JSON text with a multipart upload: { "purchasePrice": 3, ... } (0-indexed columns). */
export function parseMapping(raw: unknown): ColumnMap | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  let value: unknown = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { throw new BadRequestException('mapping must be JSON'); } }
  if (!value || typeof value !== 'object') throw new BadRequestException('mapping must be an object');
  const map: ColumnMap = {};
  for (const [field, index] of Object.entries(value as Record<string, unknown>)) {
    if (!FIELDS.includes(field) || !Number.isInteger(index) || (index as number) < 0 || (index as number) > 200) throw new BadRequestException(`Invalid mapping for ${field}`);
    (map as Record<string, number>)[field] = index as number;
  }
  // A single "price" column the supplier has named as purchase or consumer.
  return map;
}

export class SubmitNamesDto {
  /** One name, or many (array, or text with one name per line). */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(300, { each: true }) names?: string[];
  @IsOptional() @IsString() @MaxLength(60_000) text?: string;
  @IsOptional() @IsBoolean() researchPrices?: boolean;
}

export class ListRowsQuery {
  @IsOptional() @IsIn(Object.values(IntakeRowOutcome)) outcome?: IntakeRowOutcome;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) take?: number;
}

export class ResolveAdminRowDto {
  @IsIn(['RETRY', 'DISMISS']) action: 'RETRY' | 'DISMISS';
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) url?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) note?: string;
}

export class ResolveSupplierRowDto {
  @IsIn(['LINK', 'DISMISS']) action: 'LINK' | 'DISMISS';
  @IsOptional() @IsUUID() skuId?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) note?: string;
}

export class MarketPriceDto {
  @IsOptional() @IsBoolean() force?: boolean;
}

const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';
export class UploadOptionsDto {
  @IsOptional() @IsString() @MaxLength(2000) mapping?: string;
  @IsOptional() @Transform(bool) @IsBoolean() researchPrices?: boolean;
}

/** Admin side of Catalog Intake: names in, verified drafts out; supplier files on a supplier's behalf; the review queues; market prices. */
@Controller('catalog/intake')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('catalog.manage')
export class CatalogIntakeController {
  constructor(
    private readonly store: IntakeStoreService,
    private readonly admin: AdminIntakeService,
    private readonly supplier: SupplierIntakeService,
    private readonly runner: IntakeRunnerService,
    private readonly market: MarketPriceResearchService,
    private readonly enrichment: CatalogEnrichmentService,
  ) {}

  @Post('names')
  async submitNames(@CurrentUser() user: RequestUser, @Body() dto: SubmitNamesDto) {
    if (!dto.names?.length && !dto.text?.trim()) throw new BadRequestException({ code: 'NO_NAMES', message: 'Give at least one product name' });
    const result = await this.admin.submit({ actorId: user.id, names: dto.names?.length ? dto.names : dto.text, researchPrices: dto.researchPrices });
    this.runner.kick();
    return result;
  }

  @Post('names/file')
  @UseInterceptors(FileInterceptor('file', intakeUpload))
  async submitNamesFile(@CurrentUser() user: RequestUser, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadOptionsDto) {
    if (!file) throw new BadRequestException({ code: 'FILE_MISSING', message: 'Attach a file' });
    const result = await this.admin.submit({ actorId: user.id, file, mapping: parseMapping(dto.mapping), researchPrices: dto.researchPrices });
    this.runner.kick();
    return result;
  }

  /** An Admin uploads a supplier's price file on the supplier's behalf; the same rules as the supplier's own upload. */
  @Post('suppliers/:supplierId/files')
  @UseInterceptors(FileInterceptor('file', intakeUpload))
  submitSupplierFile(@CurrentUser() user: RequestUser, @Param('supplierId', ParseUUIDPipe) supplierId: string, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadOptionsDto) {
    if (!file) throw new BadRequestException({ code: 'FILE_MISSING', message: 'Attach a file' });
    return this.supplier.submit({ supplierId, actorId: user.id, file, mapping: parseMapping(dto.mapping) });
  }

  @Get('jobs')
  jobs(@Query('source') source?: string, @Query('supplierId') supplierId?: string) {
    return this.store.listJobs({ ...(source === 'ADMIN' || source === 'SUPPLIER' ? { source: source as IntakeSource } : {}), ...(supplierId && { supplierId }) });
  }

  @Get('jobs/:jobId')
  async job(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return { job: await this.store.getJob(jobId), totals: await this.store.totals(jobId) };
  }

  @Get('jobs/:jobId/rows')
  rows(@Param('jobId', ParseUUIDPipe) jobId: string, @Query() query: ListRowsQuery) {
    return this.store.listRows(jobId, query);
  }

  /** Re-runs what is pending (after a restart, or to retry now). Settled rows are never redone. */
  @Post('jobs/:jobId/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@Param('jobId', ParseUUIDPipe) jobId: string) {
    const job = await this.store.getJob(jobId);
    if (job.source === IntakeSource.SUPPLIER) this.supplier.start(jobId);
    else this.runner.kick();
    return { jobId, totals: await this.store.totals(jobId) };
  }

  /** The review queue: supplier rows with a critical identity conflict and Admin names whose identity could not be verified. */
  @Get('review')
  review(@Query('take') take?: string) {
    return this.store.reviewQueue(Math.min(Number(take) || 100, 300));
  }

  @Post('rows/:rowId/admin-resolution')
  @HttpCode(HttpStatus.OK)
  async resolveAdmin(@CurrentUser() user: RequestUser, @Param('rowId', ParseUUIDPipe) rowId: string, @Body() dto: ResolveAdminRowDto) {
    if (dto.action === 'DISMISS' && !dto.note) throw new BadRequestException('A note is required to dismiss a row');
    const row = await this.admin.resolveUnresolved(rowId, dto.action === 'DISMISS' ? { action: 'DISMISS', note: dto.note! } : { action: 'RETRY', url: dto.url, name: dto.name }, user.id);
    this.runner.kick();
    return row;
  }

  @Post('rows/:rowId/supplier-resolution')
  @HttpCode(HttpStatus.OK)
  resolveSupplier(@CurrentUser() user: RequestUser, @Param('rowId', ParseUUIDPipe) rowId: string, @Body() dto: ResolveSupplierRowDto) {
    if (dto.action === 'LINK' && !dto.skuId) throw new BadRequestException('Choose the SKU to link');
    if (dto.action === 'DISMISS' && !dto.note) throw new BadRequestException('A note is required to dismiss a row');
    return this.supplier.resolveCritical(rowId, dto.action === 'LINK' ? { action: 'LINK', skuId: dto.skuId! } : { action: 'DISMISS', note: dto.note! }, user.id);
  }

  /** The four independent readiness answers for one SKU: PDP, chatbot, routine, selling. */
  @Get('skus/:skuId/readiness')
  readiness(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.enrichment.readiness(skuId);
  }

  @Get('skus/:skuId/market-price')
  marketPrice(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.market.latest(skuId);
  }

  @Post('skus/:skuId/market-price')
  @HttpCode(HttpStatus.OK)
  researchMarketPrice(@CurrentUser() user: RequestUser, @Param('skuId', ParseUUIDPipe) skuId: string, @Body() dto: MarketPriceDto) {
    return this.market.research(skuId, user.id, { force: dto.force });
  }
}

/** Supplier side: a supplier uploads its own price file and sees only its own jobs and rows. */
@Controller('supplier/intake')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('SUPPLIER')
@RequirePermissions('supplier_offer.manage')
export class SupplierIntakeController {
  constructor(private readonly store: IntakeStoreService, private readonly supplier: SupplierIntakeService) {}

  private supplierOf(user: RequestUser): string {
    if (!user.roles?.includes('SUPPLIER') || !user.supplierId) throw new ForbiddenException('A linked supplier account is required');
    return user.supplierId;
  }

  @Post('files')
  @UseInterceptors(FileInterceptor('file', intakeUpload))
  upload(@CurrentUser() user: RequestUser, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadOptionsDto) {
    if (!file) throw new BadRequestException({ code: 'FILE_MISSING', message: 'Attach a file' });
    return this.supplier.submit({ supplierId: this.supplierOf(user), actorId: user.id, file, mapping: parseMapping(dto.mapping) });
  }

  @Get('jobs')
  jobs(@CurrentUser() user: RequestUser) {
    return this.store.listJobs({ source: IntakeSource.SUPPLIER, supplierId: this.supplierOf(user) });
  }

  @Get('jobs/:jobId')
  job(@CurrentUser() user: RequestUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.supplier.summary(jobId, this.supplierOf(user));
  }

  /** The supplier sees each row's outcome and reason; never candidate SKUs from the catalog or other suppliers' data. */
  @Get('jobs/:jobId/rows')
  async rows(@CurrentUser() user: RequestUser, @Param('jobId', ParseUUIDPipe) jobId: string, @Query() query: ListRowsQuery) {
    await this.store.getJob(jobId, { supplierId: this.supplierOf(user) });
    const page = await this.store.listRows(jobId, query);
    return { total: page.total, items: page.items.map(row => ({ id: row.id, rowNumber: row.rowNumber, name: row.rawName, purchasePrice: row.purchasePrice, consumerPrice: row.consumerPrice,
      quantity: row.quantity, outcome: row.outcome, reasonCode: row.reasonCode, reason: row.reason, matched: Boolean(row.matchedSkuId) })) };
  }
}
