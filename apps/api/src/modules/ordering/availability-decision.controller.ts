import {
  Body, Controller, Get, Headers, Param, Post, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { validateSync } from 'class-validator';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import {
  AvailabilityDecisionParamsDto, GuestAvailabilityDecisionParamsDto, SubmitAvailabilityDecisionDto,
} from './dto/availability-decision.dto';
import { GuestOrderAccessHeaderDto, GuestOrderLookupParamsDto, OrderLookupParamsDto } from './dto/order-tracking.dto';
import { AvailabilityResolutionService } from './services/availability-resolution.service';

/** Authenticated owner access. Ownership is enforced in the service (404 for anyone else). */
@Controller('ordering')
@UseGuards(AuthGuard)
export class AvailabilityDecisionController {
  constructor(private readonly resolution: AvailabilityResolutionService) {}

  @Get('orders/:idOrOrderNumber/availability-decisions')
  list(@CurrentUser() user: any, @Param() params: OrderLookupParamsDto) {
    return this.resolution.listForOrder({ customerId: user.id }, { idOrOrderNumber: params.idOrOrderNumber });
  }

  @Post('availability-decisions/:decisionId/decision')
  decide(@CurrentUser() user: any, @Param() params: AvailabilityDecisionParamsDto, @Body() dto: SubmitAvailabilityDecisionDto) {
    return this.resolution.decide({ customerId: user.id }, params.decisionId, dto);
  }
}

/** Guest access: per-order bearer secret in a header, same model as guest tracking. */
@Controller('ordering/guest/orders')
export class GuestAvailabilityDecisionController {
  constructor(private readonly resolution: AvailabilityResolutionService) {}

  private token(rawToken?: string): string {
    const header = Object.assign(new GuestOrderAccessHeaderDto(), { token: rawToken });
    if (validateSync(header).length) throw new UnauthorizedException('Invalid order access token');
    return header.token;
  }

  @Get(':orderNumber/availability-decisions')
  list(@Param() params: GuestOrderLookupParamsDto, @Headers('x-order-access-token') rawToken?: string) {
    return this.resolution.listForOrder(
      { guestOrderNumber: params.orderNumber, guestToken: this.token(rawToken) }, { orderNumber: params.orderNumber });
  }

  @Post(':orderNumber/availability-decisions/:decisionId/decision')
  decide(@Param() params: GuestAvailabilityDecisionParamsDto,
    @Body() dto: SubmitAvailabilityDecisionDto, @Headers('x-order-access-token') rawToken?: string) {
    return this.resolution.decide(
      { guestOrderNumber: params.orderNumber, guestToken: this.token(rawToken) }, params.decisionId, dto,
      { orderNumber: params.orderNumber });
  }
}
