import { Controller, Get, Headers, Param, UnauthorizedException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { GuestOrderAccessHeaderDto, GuestOrderLookupParamsDto } from './dto/order-tracking.dto';
import { OrderTrackingService } from './services/order-tracking.service';

/** Guest order access is a separate per-order bearer secret, never an order number or phone. */
@Controller('ordering/guest/orders')
export class GuestOrderTrackingController {
  constructor(private readonly tracking: OrderTrackingService) {}

  @Get(':orderNumber/tracking')
  async track(@Param() params: GuestOrderLookupParamsDto, @Headers('x-order-access-token') rawToken?: string) {
    const header = Object.assign(new GuestOrderAccessHeaderDto(), { token: rawToken });
    if (validateSync(header).length) throw new UnauthorizedException('Invalid order access token');
    return this.tracking.forGuest(params.orderNumber, header.token);
  }
}
