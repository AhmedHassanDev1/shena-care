import { Body, Controller, Delete, Get, Headers, Param, Put, UnauthorizedException, UseGuards } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { GuestOrderAccessHeaderDto, GuestOrderLookupParamsDto, OrderLookupParamsDto } from './dto/order-tracking.dto';
import { GuestOrderItemReasonParamsDto, OrderItemReasonParamsDto, SetPurchaseReasonDto } from './dto/purchase-reason.dto';
import { PurchaseReasonService } from './services/purchase-reason.service';

function guestToken(raw?: string): string {
  const header = Object.assign(new GuestOrderAccessHeaderDto(), { token: raw });
  if (validateSync(header).length) throw new UnauthorizedException('Invalid order access token');
  return header.token;
}

/** «Why I bought it» for a signed-in customer's own order. Never needed to check out; always optional and editable. */
@Controller('ordering/orders')
@UseGuards(AuthGuard)
export class PurchaseReasonController {
  constructor(private readonly reasons: PurchaseReasonService) {}

  @Get(':idOrOrderNumber/purchase-reasons')
  list(@CurrentUser() user: { id: string }, @Param() params: OrderLookupParamsDto) {
    return this.reasons.list({ customerId: user.id }, params);
  }

  @Put(':idOrOrderNumber/items/:orderItemId/purchase-reason')
  set(@CurrentUser() user: { id: string }, @Param() params: OrderItemReasonParamsDto, @Body() dto: SetPurchaseReasonDto) {
    return this.reasons.set({ customerId: user.id }, { idOrOrderNumber: params.idOrOrderNumber }, params.orderItemId, dto);
  }

  @Delete(':idOrOrderNumber/items/:orderItemId/purchase-reason')
  clear(@CurrentUser() user: { id: string }, @Param() params: OrderItemReasonParamsDto) {
    return this.reasons.clear({ customerId: user.id }, { idOrOrderNumber: params.idOrOrderNumber }, params.orderItemId);
  }
}

/** The same for a guest order, proven by the order's own access token (x-order-access-token). */
@Controller('ordering/guest/orders')
export class GuestPurchaseReasonController {
  constructor(private readonly reasons: PurchaseReasonService) {}

  @Get(':orderNumber/purchase-reasons')
  list(@Param() params: GuestOrderLookupParamsDto, @Headers('x-order-access-token') token?: string) {
    return this.reasons.list({ guestToken: guestToken(token), orderNumber: params.orderNumber }, {});
  }

  @Put(':orderNumber/items/:orderItemId/purchase-reason')
  set(@Param() params: GuestOrderItemReasonParamsDto, @Body() dto: SetPurchaseReasonDto, @Headers('x-order-access-token') token?: string) {
    return this.reasons.set({ guestToken: guestToken(token), orderNumber: params.orderNumber }, {}, params.orderItemId, dto);
  }

  @Delete(':orderNumber/items/:orderItemId/purchase-reason')
  clear(@Param() params: GuestOrderItemReasonParamsDto, @Headers('x-order-access-token') token?: string) {
    return this.reasons.clear({ guestToken: guestToken(token), orderNumber: params.orderNumber }, {}, params.orderItemId);
  }
}
