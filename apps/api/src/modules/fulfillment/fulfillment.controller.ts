import { Controller, Post, Body, Get, Param, Patch, Delete } from '@nestjs/common';
import { FulfillmentService } from './services/fulfillment.service';
import { CreateLocationDto, AllocateShipmentDto, UpdateShipmentStatusDto, StartPreparationDto, ScanItemDto, RecordShipmentEventDto, CreateDeliveryBatchDto, AddStopsToBatchDto, UpdateStopSequenceDto } from './dto/fulfillment.dto';

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

  @Post('shipments/:id/preparation')
  async startPreparationSession(
    @Param('id') id: string,
    @Body() dto: StartPreparationDto,
  ) {
    return this.fulfillmentService.startPreparationSession(id, dto);
  }

  @Post('preparation-sessions/:sessionId/scan')
  async scanItem(
    @Param('sessionId') sessionId: string,
    @Body() dto: ScanItemDto,
  ) {
    return this.fulfillmentService.scanItem(sessionId, dto);
  }

  @Post('preparation-sessions/:sessionId/complete')
  async completePreparationSession(@Param('sessionId') sessionId: string) {
    return this.fulfillmentService.completePreparationSession(sessionId);
  }

  @Post('shipments/:id/label')
  async generateShipmentLabel(@Param('id') id: string) {
    return this.fulfillmentService.generateShipmentLabel(id);
  }

  @Post('shipments/:id/events')
  async recordShipmentEvent(
    @Param('id') id: string,
    @Body() dto: RecordShipmentEventDto,
  ) {
    return this.fulfillmentService.recordShipmentEvent(id, dto);
  }

  // --- Delivery Batch Planning ---

  @Get('locations/:id/eligible-shipments')
  async getEligibleShipmentsForBatching(@Param('id') locationId: string) {
    return this.fulfillmentService.getEligibleShipmentsForBatching(locationId);
  }

  @Post('delivery-batches')
  async createDeliveryBatch(@Body() dto: CreateDeliveryBatchDto) {
    return this.fulfillmentService.createDeliveryBatch(dto);
  }

  @Post('delivery-batches/:id/stops')
  async addStopsToBatch(@Param('id') id: string, @Body() dto: AddStopsToBatchDto) {
    return this.fulfillmentService.addStopsToBatch(id, dto.stops);
  }

  @Patch('delivery-batches/:id/stops/sequence')
  async updateBatchStopsSequence(@Param('id') id: string, @Body() dto: UpdateStopSequenceDto) {
    return this.fulfillmentService.updateBatchStopsSequence(id, dto.stops);
  }

  @Delete('delivery-batches/:id/stops/:shipmentId')
  async removeStopFromBatch(@Param('id') id: string, @Param('shipmentId') shipmentId: string) {
    return this.fulfillmentService.removeStopFromBatch(id, shipmentId);
  }

  @Post('delivery-batches/:id/dispatch')
  async dispatchBatch(@Param('id') id: string) {
    return this.fulfillmentService.dispatchBatch(id);
  }

  @Post('delivery-batches/:id/complete')
  async completeBatch(@Param('id') id: string) {
    return this.fulfillmentService.completeBatch(id);
  }
}

