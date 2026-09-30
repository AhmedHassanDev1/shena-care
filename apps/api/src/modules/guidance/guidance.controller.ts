import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { GuidanceService } from './services/guidance.service';
import { CreateGuidanceSessionDto, SendGuidanceMessageDto } from './dto/guidance.dto';

@Controller('guidance')
export class GuidanceController {
  constructor(private readonly guidanceService: GuidanceService) {}

  @Post('sessions')
  async createSession(@Body() dto: CreateGuidanceSessionDto) {
    return this.guidanceService.createSession(dto);
  }

  @Get('sessions/:sessionId')
  async getSession(@Param('sessionId') sessionId: string) {
    return this.guidanceService.getSession(sessionId);
  }

  @Post('sessions/:sessionId/messages')
  async sendMessage(@Param('sessionId') sessionId: string, @Body() dto: SendGuidanceMessageDto) {
    return this.guidanceService.sendMessage(sessionId, dto);
  }
}
