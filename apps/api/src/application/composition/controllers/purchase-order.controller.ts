import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { PurchaseOrderService } from '../../../modules/sourcing/public';
import { CreatePurchaseOrderDto, ConfirmPurchaseOrderDto } from '../../../modules/sourcing/public';

@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  @Post()
  async createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrderService.createPurchaseOrder(dto);
  }

  @Get(':id')
  async getPurchaseOrder(@Param('id') id: string) {
    return this.purchaseOrderService.getPurchaseOrder(id);
  }

  @Post(':id/confirm')
  async confirmPurchaseOrder(
    @Param('id') id: string,
    @Body() dto: ConfirmPurchaseOrderDto,
  ) {
    return this.purchaseOrderService.confirmPurchaseOrder(id, dto);
  }
}
