import { Controller, Post, Body, Get, Param, Patch } from '@nestjs/common';
import { IngestionService } from './services/ingestion.service';
import { CreateIngestionJobDto, ApproveIngestionItemDto } from './dto/ingestion.dto';

@Controller('ingestion')
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
}
