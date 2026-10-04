import { Controller, Post, Body, Get, Param, UseGuards } from '@nestjs/common';
import { ReturnEligibilityService } from './services/return-eligibility.service';
import { SubmitReturnDto } from './dto/return.dto';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';

@Controller('ordering/orders')
@UseGuards(AuthGuard)
export class CustomerReturnsController {
  constructor(private readonly returnEligibility: ReturnEligibilityService) {}

  @Get(':idOrOrderNumber/items/:itemId/eligibility')
  async getEligibility(
    @Param('idOrOrderNumber') idOrOrderNumber: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: any
  ) {
    return this.returnEligibility.getEligibility(idOrOrderNumber, itemId, user.id);
  }

  @Post(':idOrOrderNumber/items/:itemId/returns')
  async submitReturn(
    @Param('idOrOrderNumber') idOrOrderNumber: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: any,
    @Body() dto: SubmitReturnDto
  ) {
    return this.returnEligibility.submitReturn(idOrOrderNumber, itemId, user.id, dto, true, user.id);
  }
}
