import { Controller, Post, Body, Get, Param, Patch } from '@nestjs/common';
import { FulfillmentService } from './services/fulfillment.service';
import { CreateLocationDto, AllocateShipmentDto, UpdateShipmentStatusDto } from './dto/fulfillment.dto';

@Controller('fulfillment')
export class FulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Post('locations')
  async createLocation(@Body() dto: CreateLocationDto) {
    return this.fulfillmentService.createLocation(dto);
  }

  @Get('locations')
  async getLocations() {
    return this.fulfillmentService.getLocations();
  }

  @Post('shipments/allocate')
  async allocateShipment(@Body() dto: AllocateShipmentDto) {
    return this.fulfillmentService.allocateShipment(dto);
  }

  @Get('shipments/:id')
  async getShipment(@Param('id') id: string) {
    return this.fulfillmentService.getShipment(id);
  }

  @Get('orders/:orderId/shipment')
  async getShipmentByOrder(@Param('orderId') orderId: string) {
    return this.fulfillmentService.getShipmentByOrder(orderId);
  }

  @Patch('shipments/:id/status')
  async updateShipmentStatus(
    @Param('id') id: string,
    @Body() dto: UpdateShipmentStatusDto,
  ) {
    return this.fulfillmentService.updateShipmentStatus(id, dto);
  }
}
