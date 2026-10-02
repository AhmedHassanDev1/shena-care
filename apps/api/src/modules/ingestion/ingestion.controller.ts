import { Controller, Post, Body, Get, Param, Patch, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { IngestionService } from './services/ingestion.service';
import { CreateIngestionJobDto, ApproveIngestionItemDto } from './dto/ingestion.dto';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { PermissionsGuard, RequirePermissions } from '../../platform/auth';
import { Roles } from '../accounts/decorators/roles.decorator';

@Controller('ingestion')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'HUB_OPERATOR') // Mostly backend operations
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('jobs')
  async createJob(@Body() dto: CreateIngestionJobDto) {
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

  @Patch('items/:id/approve')
  async approveItem(
    @Param('id') id: string,
    @Body() dto: ApproveIngestionItemDto,
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
