import { Controller, Post, Body, Get, Param, Headers, UnauthorizedException } from '@nestjs/common';
import { ReturnEligibilityService } from './services/return-eligibility.service';
import { SubmitReturnDto } from './dto/return.dto';
import { createHash } from 'crypto';

@Controller('ordering/guest/orders')
export class GuestReturnsController {
  constructor(private readonly returnEligibility: ReturnEligibilityService) {}

  private extractToken(authHeader?: string): string {
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Missing guest token');
    return createHash('sha256').update(authHeader.split(' ')[1]).digest('hex');
  }

  @Get(':orderNumber/items/:itemId/eligibility')
  async getEligibility(
    @Param('orderNumber') orderNumber: string,
    @Param('itemId') itemId: string,
    @Headers('authorization') authHeader?: string
  ) {
    return this.returnEligibility.getEligibility(orderNumber, itemId, undefined, this.extractToken(authHeader));
  }

  @Post(':orderNumber/items/:itemId/returns')
  async submitReturn(
    @Param('orderNumber') orderNumber: string,
    @Param('itemId') itemId: string,
    @Body() dto: SubmitReturnDto,
    @Headers('authorization') authHeader?: string
  ) {
    const tokenHash = this.extractToken(authHeader);
    return this.returnEligibility.submitReturn(orderNumber, itemId, 'guest', dto, true, undefined, tokenHash);
  }
}
