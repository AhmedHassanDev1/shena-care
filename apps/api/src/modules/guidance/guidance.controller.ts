import { Controller, Post, Body, Get, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { GuidanceService } from './services/guidance.service';
import { CreateGuidanceSessionDto, SendGuidanceMessageDto } from './dto/guidance.dto';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';

@Controller('guidance')
@UseGuards(AuthGuard)
export class GuidanceController {
  constructor(private readonly guidanceService: GuidanceService) {}

  @Post('sessions')
  async createSession(@CurrentUser() customer: any, @Body() dto: CreateGuidanceSessionDto) {
    if (dto.customerId && dto.customerId !== customer.id) {
      throw new ForbiddenException('Cannot create session for another customer');
    }
    return this.guidanceService.createSession({ ...dto, customerId: customer.id });
  }

  @Get('sessions/:sessionId')
  async getSession(@CurrentUser() customer: any, @Param('sessionId') sessionId: string) {
    const session = await this.guidanceService.getSession(sessionId);
    if (session && session.customerId !== customer.id) {
      throw new ForbiddenException('Cannot access another customer session');
    }
    return session;
  }

  @Post('sessions/:sessionId/messages')
  async sendMessage(@CurrentUser() customer: any, @Param('sessionId') sessionId: string, @Body() dto: SendGuidanceMessageDto) {
    const session = await this.guidanceService.getSession(sessionId);
    if (!session || session.customerId !== customer.id) {
      throw new ForbiddenException('Cannot send message to another customer session');
    }
    return this.guidanceService.sendMessage(sessionId, dto);
  }
}
