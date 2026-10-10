import { Controller, Post, Body, Get, Param, Patch, Query, Req, HttpCode, HttpStatus, UseGuards, ForbiddenException } from '@nestjs/common';
import { IngestionService } from './services/ingestion.service';
import { CreateIngestionJobDto, ApproveIngestionItemDto, UpdateCandidateDto } from './dto/ingestion.dto';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { PermissionsGuard } from '../../platform/auth';
import { Roles } from '../accounts/decorators/roles.decorator';
import { IngestionStatus } from '@prisma/client';

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
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('jobs')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async createJob(
    @Req() req: AuthenticatedUserRequest,
    @Body() dto: CreateIngestionJobDto,
  ) {
    const user = req.user;
    if (user?.roles?.includes('SUPPLIER') && !user.roles.includes('ADMIN') && !user.roles.includes('HUB_OPERATOR')) {
      if (user.supplierId && user.supplierId !== dto.supplierId) {
        throw new ForbiddenException('Cannot submit ingestion job for another supplier');
      }
    }
    return this.ingestionService.createJob(dto);
  }

  @Get('jobs')
  async getJobs() {
    return this.ingestionService.getJobs();
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    return this.ingestionService.getJob(id);
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
    @Param('id') id: string,
    @Body() dto?: ApproveIngestionItemDto,
  ) {
    return this.ingestionService.approveItem(id, dto);
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

  // ─── Item Aliases (Backwards Compatibility) ─────────────────────────────

  @Get('items/:id')
  async getItemDetail(@Param('id') id: string) {
    return this.ingestionService.getCandidateDetail(id);
  }

  @Patch('items/:id/approve')
  async approveItem(
    @Param('id') id: string,
    @Body() dto?: ApproveIngestionItemDto,
  ) {
    return this.ingestionService.approveItem(id, dto);
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
}
