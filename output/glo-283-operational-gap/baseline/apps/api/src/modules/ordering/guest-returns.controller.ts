import { Controller, Post, Body, Get, Param, Headers, UnauthorizedException } from '@nestjs/common';
import { ReturnEligibilityService } from './services/return-eligibility.service';
import { SubmitReturnDto } from './dto/return.dto';
import { createHash } from 'crypto';

@Controller('ordering/guest/orders')
export class GuestReturnsController {
  constructor(private readonly returnEligibility: ReturnEligibilityService) {}

  /**
   * The order access token arrives in x-order-access-token, like every other guest order route; the
   * older `Authorization: Bearer <token>` form is still accepted for existing clients.
   */
  private extractToken(authHeader?: string, accessToken?: string): string {
    const raw = accessToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined);
    if (!raw) throw new UnauthorizedException('Missing guest token');
    return createHash('sha256').update(raw).digest('hex');
  }

  @Get(':orderNumber/items/:itemId/eligibility')
  async getEligibility(
    @Param('orderNumber') orderNumber: string,
    @Param('itemId') itemId: string,
    @Headers('authorization') authHeader?: string,
    @Headers('x-order-access-token') accessToken?: string,
  ) {
    return this.returnEligibility.getEligibility(orderNumber, itemId, undefined, this.extractToken(authHeader, accessToken));
  }

  @Post(':orderNumber/items/:itemId/returns')
  async submitReturn(
    @Param('orderNumber') orderNumber: string,
    @Param('itemId') itemId: string,
    @Body() dto: SubmitReturnDto,
    @Headers('authorization') authHeader?: string,
    @Headers('x-order-access-token') accessToken?: string,
  ) {
    const tokenHash = this.extractToken(authHeader, accessToken);
    return this.returnEligibility.submitReturn(orderNumber, itemId, 'guest', dto, true, undefined, tokenHash);
  }
}
