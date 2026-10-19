import { Body, ConflictException, Controller, Get, Headers, Param, Post, Query, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { validateSync } from 'class-validator';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PageQueryDto, page } from '../../../platform/api/paging.dto';
import {
  CartService,
  GuestOrderAccessHeaderDto, GuestOrderLookupParamsDto, OrderLookupParamsDto, OrderingService, OrderTrackingService, customerMayCancel,
  ReorderOrderDto,
} from '../../../modules/ordering/public';
import { FulfillmentService } from '../../../modules/fulfillment/public';
import { SupportService } from '../../../modules/operations/services/support.service';
import { OrderCancellationService } from '../services/order-cancellation.service';

const TOPICS = ['delivery', 'payment', 'cancellation', 'return', 'damaged_item', 'wrong_item', 'other'] as const;

export class CustomerSupportRequestDto {
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  message: string;

  @IsOptional()
  @IsIn(TOPICS)
  topic?: (typeof TOPICS)[number];
}

type Owner = { customerId: string } | { guestToken: string };

function guestOwner(rawToken?: string): Owner {
  const header = Object.assign(new GuestOrderAccessHeaderDto(), { token: rawToken });
  if (validateSync(header).length) throw new UnauthorizedException('Invalid order access token');
  return { guestToken: header.token };
}

/**
 * Customer self-service on their own order (C0 W6): list (signed in), cancel while nothing physical
 * has happened, and order-linked support requests. Ownership is the account or the order's own guest
 * token; the cancellation itself is the same audited staff composition (GLO-240).
 */
@Controller('ordering')
export class CustomerOrderActionsController {
  constructor(
    private readonly ordering: OrderingService,
    private readonly fulfillment: FulfillmentService,
    private readonly support: SupportService,
    private readonly cancellation: OrderCancellationService,
    private readonly cart: CartService,
    private readonly tracking: OrderTrackingService,
  ) {}

  @Get('orders')
  @UseGuards(AuthGuard)
  myOrders(@CurrentUser() user: { id: string }, @Query() query: PageQueryDto) {
    return this.tracking.listForCustomer(user.id, page(query));
  }

  @Post('orders/:idOrOrderNumber/reorder')
  @UseGuards(AuthGuard)
  async reorderOwn(
    @CurrentUser() user: { id: string },
    @Param() params: OrderLookupParamsDto,
    @Body() dto: ReorderOrderDto,
  ) {
    return this.cart.reorderFromOrder(
      { customerId: user.id },
      { customerId: user.id, idOrOrderNumber: params.idOrOrderNumber },
      { skuIds: dto?.skuIds },
    );
  }

  @Post('guest/orders/:orderNumber/reorder')
  async reorderGuest(
    @Param() params: GuestOrderLookupParamsDto,
    @Headers('x-order-access-token') orderToken: string | undefined,
    @Headers('x-cart-token') cartToken: string | undefined,
    @Body() dto: ReorderOrderDto,
    @Res({ passthrough: true }) res: any,
  ) {
    const owner = guestOwner(orderToken) as { guestToken: string };
    const cartOwner = cartToken ? { guestToken: cartToken } : null;
    const result = await this.cart.reorderFromOrder(
      cartOwner,
      { guestToken: owner.guestToken, idOrOrderNumber: params.orderNumber },
      { skuIds: dto?.skuIds },
    );
    if (result.cart.guestCartToken) {
      res.setHeader('x-cart-token', result.cart.guestCartToken);
    }
    return result;
  }

  @Post('orders/:idOrOrderNumber/customer-cancel')
  @UseGuards(AuthGuard)
  cancelOwn(@CurrentUser() user: { id: string }, @Param() params: OrderLookupParamsDto) {
    return this.cancel({ customerId: user.id }, params.idOrOrderNumber, `customer:${user.id}`);
  }

  @Post('guest/orders/:orderNumber/cancel')
  cancelGuest(@Param() params: GuestOrderLookupParamsDto, @Headers('x-order-access-token') token?: string) {
    return this.cancel(guestOwner(token), params.orderNumber, 'customer:guest');
  }

  @Post('orders/:idOrOrderNumber/support')
  @UseGuards(AuthGuard)
  supportOwn(@CurrentUser() user: { id: string }, @Param() params: OrderLookupParamsDto, @Body() dto: CustomerSupportRequestDto) {
    return this.request({ customerId: user.id }, params.idOrOrderNumber, dto);
  }

  @Post('guest/orders/:orderNumber/support')
  supportGuest(@Param() params: GuestOrderLookupParamsDto, @Headers('x-order-access-token') token: string | undefined, @Body() dto: CustomerSupportRequestDto) {
    return this.request(guestOwner(token), params.orderNumber, dto);
  }

  private async cancel(owner: Owner, ref: string, actorId: string) {
    const order = await this.ordering.findOwnedOrder(owner, ref);
    if (order.status === 'cancelled') return { orderNumber: order.orderNumber, status: 'cancelled', alreadyCancelled: true };
    const physical = await this.fulfillment.physicalState(order.id);
    if (!customerMayCancel({ orderStatus: order.status, ...physical })) {
      throw new ConflictException({ code: 'CANCELLATION_REQUIRES_SUPPORT', message: 'This order is already being prepared or delivered; contact support to cancel or return it.' });
    }
    const result = await this.cancellation.cancel(order.id, actorId, { reasonCode: 'CUSTOMER_REQUEST', notes: 'Cancelled by the customer' });
    return { orderNumber: order.orderNumber, status: 'cancelled', alreadyCancelled: result.alreadyCancelled };
  }

  private async request(owner: Owner, ref: string, dto: CustomerSupportRequestDto) {
    const order = await this.ordering.findOwnedOrder(owner, ref);
    const created = await this.support.createCase({
      title: `Customer request — ${order.orderNumber}`, description: dto.message.trim(),
      category: (dto.topic ?? 'other') as never,
      orderId: order.id, customerId: order.customerId ?? undefined,
    });
    return { caseId: created.id, status: created.status };
  }
}
