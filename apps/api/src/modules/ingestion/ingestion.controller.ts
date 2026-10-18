import { Controller, Post, Body, Get, Param, Patch, Query, Req, HttpCode, HttpStatus, UseGuards, ForbiddenException, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './services/ingestion.service';
import { CreateIngestionJobDto, ApproveIngestionItemDto, UpdateCandidateDto, SupplierSourceUploadDto, ReviewCandidateContentDto, RecordCandidateEvidenceDto } from './dto/ingestion.dto';
import { ProductContentService } from './services/product-content.service';
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
  constructor(private readonly ingestionService: IngestionService, private readonly contentService: ProductContentService) {}

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

  @Post('jobs/:id/publish')
  @HttpCode(HttpStatus.CREATED)
  async publishJob(@Param('id') id: string) {
    return this.ingestionService.publishJob(id);
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

