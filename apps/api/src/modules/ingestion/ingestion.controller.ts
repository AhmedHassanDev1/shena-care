import { Controller, Post, Body, Get, Param, Patch, Query, Req, HttpCode, HttpStatus, UseGuards, ForbiddenException, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './services/ingestion.service';
import { CreateIngestionJobDto, ApproveIngestionItemDto, UpdateCandidateDto, SupplierSourceUploadDto, ReviewCandidateContentDto, RecordCandidateEvidenceDto, ApplyJobMappingDto } from './dto/ingestion.dto';
import { ProductContentService } from './services/product-content.service';
import { OfferBatchCommitService } from './services/offer-batch-commit.service';
import { BrandEnrichmentService } from './services/brand-enrichment.service';
import { IngredientOntologyService } from './services/ingredient-ontology.service';
import { RoutinePlacementService, DeterminePlacementInput } from './services/routine-placement.service';
import { IngredientService } from '../catalog/public';
import { ClaimValidationRequest } from './contracts/ingredient-ontology.contract';
import { EnrichBrandDraftDto, EnrichProductLineDraftDto } from './contracts/brand-enrichment.contract';
import { ParseUUIDPipe } from '@nestjs/common';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { PermissionsGuard } from '../../platform/auth';
import { Roles } from '../accounts/decorators/roles.decorator';
import { IngestionStatus } from '@prisma/client';
import { multerOptions } from '../../platform/security/upload-validator';

export interface AuthenticatedUserRequest {
  user?: {
    id: string;
    roles?: string[];
    supplierId?: string;
  };
}

@Controller('ingestion')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'HUB_OPERATOR')
export class IngestionController {
  constructor(
    private readonly ingestionService: IngestionService,
    private readonly contentService: ProductContentService,
    private readonly offerBatchCommitService: OfferBatchCommitService,
    private readonly brandEnrichmentService: BrandEnrichmentService,
    private readonly ingredientOntologyService: IngredientOntologyService,
    private readonly ingredientService: IngredientService,
    private readonly routinePlacementService: RoutinePlacementService,
  ) {}

  private supplierReadScope(user?: AuthenticatedUserRequest['user']): string | undefined {
    if (user?.roles?.includes('ADMIN') || user?.roles?.includes('HUB_OPERATOR')) return undefined;
    if (user?.roles?.includes('SUPPLIER') && user.supplierId) return user.supplierId;
    throw new ForbiddenException('Supplier account is not linked to a supplier');
  }

  @Post('jobs')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async createJob(
    @Req() req: AuthenticatedUserRequest,
    @Body() dto: CreateIngestionJobDto,
  ) {
    const user = req.user;
    if (user?.roles?.includes('SUPPLIER') && !user.roles.includes('ADMIN') && !user.roles.includes('HUB_OPERATOR')) {
      if (!user.supplierId || user.supplierId !== dto.supplierId) {
        throw new ForbiddenException('Cannot submit ingestion job for another supplier');
      }
    }
    return this.ingestionService.createJob(dto);
  }

  @Post('jobs/upload')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async uploadSupplierSpreadsheet(
    @Req() req: AuthenticatedUserRequest,
    @Body() dto: SupplierSourceUploadDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const supplierId = dto.supplierId;
    if (!file) {
      throw new BadRequestException('File is required');
    }
    if (!supplierId) {
      throw new BadRequestException('supplierId is required');
    }
    const user = req.user;
    if (user?.roles?.includes('SUPPLIER') && !user.roles.includes('ADMIN') && !user.roles.includes('HUB_OPERATOR')) {
      if (!user.supplierId || user.supplierId !== supplierId) {
        throw new ForbiddenException('Cannot upload ingestion job for another supplier');
      }
    }
    return this.ingestionService.uploadSupplierSpreadsheet(supplierId, file);
  }

  @Get('jobs')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getJobs(@Req() req: AuthenticatedUserRequest) {
    return this.ingestionService.getJobs(this.supplierReadScope(req.user));
  }

  @Get('jobs/:id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getJob(@Req() req: AuthenticatedUserRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.ingestionService.getJob(id, this.supplierReadScope(req.user));
  }

  @Post('jobs/:id/mapping')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async applyJobMapping(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyJobMappingDto,
  ) {
    const user = req.user;
    const job = await this.ingestionService.getJob(id);
    if (user?.roles?.includes('SUPPLIER') && !user.roles.includes('ADMIN') && !user.roles.includes('HUB_OPERATOR')) {
      if (!user.supplierId || user.supplierId !== job.supplierId) {
        throw new ForbiddenException('Cannot modify an ingestion job belonging to another supplier');
      }
    }
    const approvedBy = user?.id || 'system';
    return this.ingestionService.applyJobMapping(id, job.supplierId, dto, approvedBy);
  }

  @Get('profiles')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getProfiles(@Req() req: AuthenticatedUserRequest) {
    return this.ingestionService.getProfiles(this.supplierReadScope(req.user));
  }

  @Get('profiles/:id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getProfile(@Req() req: AuthenticatedUserRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.ingestionService.getProfile(id, this.supplierReadScope(req.user));
  }

  @Post('profiles/:id/approve')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async approveProfile(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { supplierId: string },
  ) {
    if (!body?.supplierId) {
      throw new BadRequestException('supplierId is required');
    }
    return this.ingestionService.approveProfile(body.supplierId, id, req.user?.id || 'admin');
  }

  @Post('jobs/:id/publish')
  @HttpCode(HttpStatus.CREATED)
  async publishJob(@Param('id') id: string) {
    return this.ingestionService.publishJob(id);
  }

  // ─── SG-05 Offer Staging, Diff & Safe Batch Commit Endpoints ─────────────

  @Get('jobs/:id/diff')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getJobDiff(@Param('id', ParseUUIDPipe) id: string) {
    return this.offerBatchCommitService.computeJobDiff(id);
  }

  @Post('jobs/:id/commit-offers')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async commitJobOffers(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body?: { autoApplyLowRisk?: boolean; declaredCompleteAssortment?: boolean },
  ) {
    return this.offerBatchCommitService.commitJobOffers(id, {
      ...body,
      actorId: req.user?.id,
    });
  }

  @Post('jobs/:id/approve-deactivations')
  @Roles('ADMIN')
  async approveDeactivations(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body?: { supplierId?: string; confirmedAssortmentCoverage?: boolean; approvedSkuIds?: string[] },
  ) {
    const actorId = req.user?.id;
    if (!actorId) throw new BadRequestException('Actor ID required');
    return this.offerBatchCommitService.approveDeactivations(id, actorId, body);
  }

  // ─── SG-06 Brand & ProductLine Knowledge Enrichment Endpoints ───────────

  @Get('brands/drafts')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getBrandDrafts(@Query('status') status?: string) {
    return this.brandEnrichmentService.getBrandDrafts(status);
  }

  @Get('brands/drafts/:id')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getBrandDraft(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandEnrichmentService.getBrandDraft(id);
  }

  @Post('brands/drafts/:id/enrich')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async enrichBrandDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrichBrandDraftDto,
  ) {
    return this.brandEnrichmentService.enrichBrandDraft(id, dto);
  }

  @Post('brands/drafts/:id/approve')
  @Roles('ADMIN')
  async approveBrandDraft(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const actorId = req.user?.id;
    if (!actorId) throw new BadRequestException('Actor ID required');
    return this.brandEnrichmentService.approveBrandDraft(id, actorId);
  }

  @Post('brands/drafts/:id/reject')
  @Roles('ADMIN')
  async rejectBrandDraft(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
  ) {
    const actorId = req.user?.id;
    if (!actorId) throw new BadRequestException('Actor ID required');
    return this.brandEnrichmentService.rejectBrandDraft(id, actorId, body?.reason);
  }

  @Patch('product-lines/drafts/:id/enrich')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async enrichProductLineDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrichProductLineDraftDto,
  ) {
    return this.brandEnrichmentService.enrichProductLineDraft(id, dto);
  }

  // ─── GLO-254 Storefront Content Synthesis & Review Endpoints ─────────────

  @Post('candidates/:id/content/generate')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async generateCandidateContentExplicit(@Param('id', ParseUUIDPipe) id: string) {
    return this.contentService.generateContent(id);
  }

  @Post('candidates/:id/content/approve')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async approveCandidateContent(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const actorId = req.user?.id;
    if (!actorId) throw new BadRequestException('Actor ID required');
    return this.contentService.approveContentDraft(id, actorId);
  }

  @Post('candidates/:id/content/reject')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async rejectCandidateContent(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body?: { reason?: string },
  ) {
    const actorId = req.user?.id;
    if (!actorId) throw new BadRequestException('Actor ID required');
    return this.contentService.rejectContentDraft(id, actorId, body?.reason);
  }

  @Get('candidates/:id/content')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getCandidateContent(@Param('id', ParseUUIDPipe) id: string) {
    return this.contentService.getContentDraft(id);
  }

  // ─── GLO-252 Ingredient Knowledge Endpoints ──────────────────────────────

  @Get('ingredients')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async listIngredients(
    @Query('isActive') isActive?: string,
    @Query('family') familySlug?: string,
  ) {
    const activeBool = isActive !== undefined ? isActive === 'true' : undefined;
    return this.ingredientService.listAll({ isActive: activeBool, familySlug });
  }

  @Get('ingredients/families/:familySlug')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async listIngredientsByFamily(@Param('familySlug') familySlug: string) {
    return this.ingredientService.listByFamily(familySlug);
  }

  @Post('ingredients/validate-claim')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async validateClaim(@Body() dto: ClaimValidationRequest) {
    return this.ingredientOntologyService.validateClaim(dto);
  }

  @Post('candidates/:id/enrich-ingredients')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async enrichCandidateIngredients(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body?: { rawIngredients?: string[] | string },
  ) {
    return this.ingredientOntologyService.enrichCandidateIngredients(id, body?.rawIngredients);
  }

  @Post('routine/determine-placement')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async determineRoutinePlacement(@Body() dto: DeterminePlacementInput) {
    return this.routinePlacementService.determineRoutinePlacement(dto);
  }

  // ─── GLO-77 Candidate Review & Publish Endpoints (Admin / Operator only) ──

  @Get('candidates')
  async getCandidates(@Query('status') status?: IngestionStatus) {
    return this.ingestionService.getCandidates(status);
  }

  @Get('candidates/:id')
  async getCandidateDetail(@Param('id') id: string) {
    return this.ingestionService.getCandidateDetail(id);
  }

  @Patch('candidates/:id')
  async updateCandidate(
    @Param('id') id: string,
    @Body() dto: UpdateCandidateDto,
  ) {
    return this.ingestionService.updateCandidate(id, dto);
  }

  @Patch('candidates/:id/approve')
  async approveCandidate(
    @Req() req: AuthenticatedUserRequest,
    @Param('id') id: string,
    @Body() dto?: ApproveIngestionItemDto,
  ) {
    return this.ingestionService.approveItem(id, dto, req.user?.id);
  }

  @Patch('candidates/:id/reject')
  async rejectCandidate(@Param('id') id: string) {
    return this.ingestionService.rejectItem(id);
  }

  @Post('candidates/:id/publish')
  @HttpCode(HttpStatus.OK)
  async publishCandidate(@Param('id') id: string) {
    return this.ingestionService.publishCandidate(id);
  }

  @Post('candidates/:id/research')
  @HttpCode(HttpStatus.OK)
  async researchCandidate(@Param('id') id: string) {
    return this.ingestionService.researchCandidate(id);
  }

  @Post('candidates/:id/content')
  @HttpCode(HttpStatus.OK)
  async generateCandidateContent(@Param('id') id: string) {
    return this.ingestionService.generateCandidateContent(id);
  }

  @Patch('candidates/:id/content/review')
  async reviewContent(@Req() req: AuthenticatedUserRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewCandidateContentDto) {
    return this.contentService.reviewContent(id, dto, req.user!.id);
  }

  @Patch('candidates/:id/evidence')
  async recordEvidence(@Req() req: AuthenticatedUserRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordCandidateEvidenceDto) {
    return this.contentService.recordSourceEvidence(id, dto, req.user!.id);
  }

  @Post('candidates/:id/media')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async uploadCandidateMedia(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    // Only accept images for now
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only images are supported');
    }
    return this.ingestionService.uploadCandidateMedia(id, file);
  }

  // ─── Item Aliases (Backwards Compatibility) ─────────────────────────────

  @Get('items/:id')
  async getItemDetail(@Param('id') id: string) {
    return this.ingestionService.getCandidateDetail(id);
  }

  @Patch('items/:id/approve')
  async approveItem(
    @Req() req: AuthenticatedUserRequest,
    @Param('id') id: string,
    @Body() dto?: ApproveIngestionItemDto,
  ) {
    return this.ingestionService.approveItem(id, dto, req.user?.id);
  }

  @Patch('items/:id/reject')
  async rejectItem(@Param('id') id: string) {
    return this.ingestionService.rejectItem(id);
  }

  @Post('items/:id/enrich')
  @HttpCode(HttpStatus.OK)
  async enrichItem(@Param('id') id: string) {
    return this.ingestionService.enrichItem(id);
  }

  @Post('items/:id/research')
  @HttpCode(HttpStatus.OK)
  async researchItem(@Param('id') id: string) {
    return this.ingestionService.researchCandidate(id);
  }
}

