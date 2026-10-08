import { Controller, Post, Body, Get, Param, Patch, Delete, UseGuards } from '@nestjs/common';
import { FulfillmentService } from './services/fulfillment.service';
import { CreateLocationDto, AllocateShipmentDto, UpdateShipmentStatusDto, StartPreparationDto, ScanItemDto, RecordShipmentEventDto, CreateDeliveryBatchDto, AddStopsToBatchDto, UpdateStopSequenceDto, AdjustInventoryDto, AssignLocationOperatorDto, ReceiveAllocatedGoodsDto } from './dto/fulfillment.dto';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { PermissionsGuard, RequirePermissions } from '../../platform/auth';
import { Roles } from '../accounts/decorators/roles.decorator';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { Role } from '@prisma/client';

interface FulfillmentActor {
  id: string;
  roles: Role[];
}

@Controller('fulfillment')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class FulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Post('locations')
  @Roles('ADMIN')
  async createLocation(@Body() dto: CreateLocationDto) {
    return this.fulfillmentService.createLocation(dto);
  }

  @Get('locations')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getLocations() {
    return this.fulfillmentService.getLocations();
  }

  @Post('locations/:id/operators')
  @Roles('ADMIN')
  async assignLocationOperator(@Param('id') id: string, @Body() dto: AssignLocationOperatorDto) {
    return this.fulfillmentService.assignLocationOperator(id, dto.operatorId);
  }

  @Post('receipts')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.receive')
  async receiveAllocatedGoods(
    @Body() dto: ReceiveAllocatedGoodsDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.fulfillmentService.receiveAllocatedGoods(dto, actor);
  }

  @Post('shipments/allocate')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async allocateShipment(@Body() dto: AllocateShipmentDto) {
    return this.fulfillmentService.allocateShipment(dto);
  }

  @Get('shipments/:id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async getShipment(@Param('id') id: string) {
    return this.fulfillmentService.getShipment(id);
  }

  @Get('orders/:orderId/shipment')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getShipmentByOrder(@Param('orderId') orderId: string) {
    return this.fulfillmentService.getShipmentByOrder(orderId);
  }

  @Patch('shipments/:id/status')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async updateShipmentStatus(
    @Param('id') id: string,
    @Body() dto: UpdateShipmentStatusDto,
  ) {
    return this.fulfillmentService.updateShipmentStatus(id, dto);
  }

  @Post('shipments/:id/preparation')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async startPreparationSession(
    @Param('id') id: string,
    @Body() dto: StartPreparationDto,
  ) {
    return this.fulfillmentService.startPreparationSession(id, dto);
  }

  @Post('preparation-sessions/:sessionId/scan')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async scanItem(
    @Param('sessionId') sessionId: string,
    @Body() dto: ScanItemDto,
  ) {
    return this.fulfillmentService.scanItem(sessionId, dto);
  }

  @Post('preparation-sessions/:sessionId/complete')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async completePreparationSession(@Param('sessionId') sessionId: string) {
    return this.fulfillmentService.completePreparationSession(sessionId);
  }

  @Post('shipments/:id/label')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async generateShipmentLabel(@Param('id') id: string) {
    return this.fulfillmentService.generateShipmentLabel(id);
  }

  @Post('shipments/:id/events')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async recordShipmentEvent(
    @Param('id') id: string,
    @Body() dto: RecordShipmentEventDto,
  ) {
    return this.fulfillmentService.recordShipmentEvent(id, dto);
  }

  // --- Delivery Batch Planning ---

  @Get('locations/:id/eligible-shipments')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getEligibleShipmentsForBatching(@Param('id') locationId: string) {
    return this.fulfillmentService.getEligibleShipmentsForBatching(locationId);
  }

  @Post('delivery-batches')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async createDeliveryBatch(@Body() dto: CreateDeliveryBatchDto) {
    return this.fulfillmentService.createDeliveryBatch(dto);
  }

  @Post('delivery-batches/:id/stops')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async addStopsToBatch(@Param('id') id: string, @Body() dto: AddStopsToBatchDto) {
    return this.fulfillmentService.addStopsToBatch(id, dto.stops);
  }

  @Patch('delivery-batches/:id/stops/sequence')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async updateBatchStopsSequence(@Param('id') id: string, @Body() dto: UpdateStopSequenceDto) {
    return this.fulfillmentService.updateBatchStopsSequence(id, dto.stops);
  }

  @Delete('delivery-batches/:id/stops/:shipmentId')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async removeStopFromBatch(@Param('id') id: string, @Param('shipmentId') shipmentId: string) {
    return this.fulfillmentService.removeStopFromBatch(id, shipmentId);
  }

  @Post('delivery-batches/:id/dispatch')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async dispatchBatch(@Param('id') id: string) {
    return this.fulfillmentService.dispatchBatch(id);
  }

  @Post('delivery-batches/:id/complete')
  @Roles('ADMIN', 'DRIVER')
  async completeBatch(@Param('id') id: string) {
    return this.fulfillmentService.completeBatch(id);
  }

  // --- Inventory Management (GLO-151) ---

  @Get('locations/:id/inventory')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getInventoryBalances(@Param('id') locationId: string) {
    return this.fulfillmentService.getInventoryBalances(locationId);
  }

  @Post('inventory/adjust')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async adjustInventory(@Body() dto: AdjustInventoryDto) {
    return this.fulfillmentService.adjustInventory(dto);
  }
}
