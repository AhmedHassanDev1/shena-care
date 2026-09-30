import { Controller, Post, Body, Get, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { GuidanceService } from './services/guidance.service';
import { CreateGuidanceSessionDto, SendGuidanceMessageDto } from './dto/guidance.dto';
import { CustomerAuthGuard, CurrentCustomer } from '../../platform/auth';

@Controller('guidance')
@UseGuards(CustomerAuthGuard)
export class GuidanceController {
  constructor(private readonly guidanceService: GuidanceService) {}

  @Post('sessions')
  async createSession(@CurrentCustomer() customerId: string, @Body() dto: CreateGuidanceSessionDto) {
    if (dto.customerId && dto.customerId !== customerId) {
      throw new ForbiddenException('Cannot create session for another customer');
    }
    return this.guidanceService.createSession({ ...dto, customerId });
  }

  @Get('sessions/:sessionId')
  async getSession(@CurrentCustomer() customerId: string, @Param('sessionId') sessionId: string) {
    const session = await this.guidanceService.getSession(sessionId);
    if (session && session.customerId !== customerId) {
      throw new ForbiddenException('Cannot access another customer session');
    }
    return session;
  }

  @Post('sessions/:sessionId/messages')
  async sendMessage(@CurrentCustomer() customerId: string, @Param('sessionId') sessionId: string, @Body() dto: SendGuidanceMessageDto) {
    const session = await this.guidanceService.getSession(sessionId);
    if (!session || session.customerId !== customerId) {
      throw new ForbiddenException('Cannot send message to another customer session');
    }
    return this.guidanceService.sendMessage(sessionId, dto);
  }
}
