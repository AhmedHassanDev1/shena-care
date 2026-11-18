import { Controller, Post, Body, Get, Param, ParseUUIDPipe, Patch, Delete, UseGuards, Query } from '@nestjs/common';
import { FulfillmentService } from './services/fulfillment.service';
import { RoutePlanningService } from './services/route-planning.service';
import { RouteOptimizationService } from './services/route-optimization.service';
import { DispatchPlanningService } from './services/dispatch-planning.service';
import { HubDeskService } from './services/hub-desk.service';
import { HubReturnsService } from './services/hub-returns.service';
import { CorrectInspectionDto, DeskScanDto, InspectReturnDto, RegisterBarcodeDto, ReverseReceiptDto } from './dto/hub-desk.dto';
import { PlanRouteDto } from './dto/routing.dto';
import { ApplyOptimizationDto, OptimizationOptionsDto } from './dto/optimization.dto';
import { PlanDispatchDto, ApproveDispatchPlanDto } from './dto/dispatch-planning.dto';
import { CreateLocationDto, AllocateShipmentDto, UpdateShipmentStatusDto, StartPreparationDto, ScanItemDto, RecordShipmentEventDto, CreateDeliveryBatchDto, AddStopsToBatchDto, UpdateStopSequenceDto, AdjustInventoryDto, AssignLocationOperatorDto, ReceiveAllocatedGoodsDto, HubShipmentQueryDto, HubRunQueryDto, BatchHandoffScanDto } from './dto/fulfillment.dto';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { PermissionsGuard, RequirePermissions } from '../../platform/auth';
import { Roles } from '../accounts/decorators/roles.decorator';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { FulfillmentActor } from './services/fulfillment.service';
import { PageQueryDto, page } from '../../platform/api/paging.dto';

@Controller('fulfillment')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class FulfillmentController {
  constructor(
    private readonly fulfillmentService: FulfillmentService,
    private readonly routePlanningService: RoutePlanningService,
    private readonly routeOptimizationService: RouteOptimizationService,
    private readonly dispatchPlanningService: DispatchPlanningService,
    private readonly hubDesk: HubDeskService,
    private readonly hubReturns: HubReturnsService,
  ) {}

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
  async allocateShipment(@Body() dto: AllocateShipmentDto, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.allocateShipment(dto, actor);
  }

  @Get('shipments/:id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async getShipment(@Param('id') id: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.getShipmentForActor(id, actor);
  }

  @Get('orders/:orderId/shipment')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getShipmentByOrder(@Param('orderId') orderId: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.getShipmentByOrder(orderId, actor);
  }

  @Patch('shipments/:id/status')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async updateShipmentStatus(
    @Param('id') id: string,
    @Body() dto: UpdateShipmentStatusDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.fulfillmentService.updateShipmentStatusAsActor(id, dto, actor);
  }

  @Post('shipments/:id/preparation')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async startPreparationSession(
    @Param('id') id: string,
    @Body() dto: StartPreparationDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.fulfillmentService.startPreparationSession(id, dto, actor);
  }

  @Get('shipments/:id/preparation')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getPreparationState(@Param('id') id: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.getPreparationState(id, actor);
  }

  @Post('preparation-sessions/:sessionId/scan')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async scanItem(
    @Param('sessionId') sessionId: string,
    @Body() dto: ScanItemDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.fulfillmentService.scanItem(sessionId, dto, actor);
  }

  @Post('preparation-sessions/:sessionId/complete')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async completePreparationSession(@Param('sessionId') sessionId: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.completePreparationSession(sessionId, actor);
  }

  @Post('shipments/:id/label')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async generateShipmentLabel(@Param('id') id: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.generateShipmentLabel(id, actor);
  }

  /** Inside customer receipt + outside shipping slip for thermal printing (GLO-210). Read-only, repeatable. */
  @Get('shipments/:id/documents')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getShipmentDocuments(@Param('id') id: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.getShipmentDocuments(id, actor);
  }

  @Post('shipments/:id/events')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async recordShipmentEvent(
    @Param('id') id: string,
    @Body() dto: RecordShipmentEventDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.fulfillmentService.recordShipmentEvent(id, dto, actor);
  }

  // --- Delivery Batch Planning ---

  /** The signed-in driver's active runs and stops (GLO-212). */
  @Get('driver/runs')
  @Roles('DRIVER')
  async getDriverManifest(@CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.getDriverManifest(actor);
  }

  @Get('driver/history')
  @Roles('DRIVER')
  async getDriverHistory(@CurrentUser() actor: FulfillmentActor, @Query() query: PageQueryDto) {
    return this.fulfillmentService.getDriverHistory(actor, page(query));
  }

  @Get('locations/:id/eligible-shipments')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getEligibleShipmentsForBatching(@Param('id') locationId: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.getEligibleShipmentsForBatching(locationId, actor);
  }

  @Post('delivery-batches')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async createDeliveryBatch(@Body() dto: CreateDeliveryBatchDto, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.createDeliveryBatch(dto, actor);
  }

  @Get('delivery-batches/:id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async getDeliveryRun(@Param('id') id: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.getDeliveryRun(id, actor);
  }

  @Post('delivery-batches/:id/stops')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async addStopsToBatch(@Param('id') id: string, @Body() dto: AddStopsToBatchDto, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.addStopsToBatch(id, dto.stops, actor);
  }

  @Patch('delivery-batches/:id/stops/sequence')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async updateBatchStopsSequence(@Param('id') id: string, @Body() dto: UpdateStopSequenceDto, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.updateBatchStopsSequence(id, dto.stops, actor);
  }

  @Delete('delivery-batches/:id/stops/:shipmentId')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async removeStopFromBatch(@Param('id') id: string, @Param('shipmentId') shipmentId: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.removeStopFromBatch(id, shipmentId, actor);
  }

  @Post('delivery-batches/:id/dispatch')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async dispatchBatch(@Param('id') id: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.dispatchBatch(id, actor);
  }

  @Post('delivery-batches/:id/complete')
  @Roles('ADMIN', 'DRIVER', 'HUB_OPERATOR')
  async completeBatch(@Param('id') id: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.completeBatch(id, actor);
  }

  @Post('delivery-batches/:id/handoff-scan')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  @RequirePermissions('delivery.handoff')
  async batchHandoffScan(
    @Param('id') id: string,
    @Body() dto: BatchHandoffScanDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.fulfillmentService.batchHandoffScan(id, dto.barcode, actor);
  }

  // --- One-person Hub desk (GLO-315): receive + verify with one scan ---

  @Get('locations/:id/desk')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.receive', 'hub.prepare')
  async getDesk(@Param('id') locationId: string, @CurrentUser() actor: FulfillmentActor) {
    return this.hubDesk.getDesk(locationId, actor);
  }

  @Post('locations/:id/desk/orders/:orderId/scan')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.receive', 'hub.prepare')
  async deskScan(@Param('id') locationId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: DeskScanDto, @CurrentUser() actor: FulfillmentActor) {
    return this.hubDesk.scan(locationId, orderId, dto, actor);
  }

  @Post('locations/:id/desk/orders/:orderId/verify')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.prepare')
  async deskVerify(@Param('id') locationId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @CurrentUser() actor: FulfillmentActor) {
    return this.hubDesk.verify(locationId, orderId, actor);
  }

  @Post('locations/:id/desk/orders/:orderId/register-barcode')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.receive', 'hub.prepare')
  async deskRegisterBarcode(@Param('id') locationId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: RegisterBarcodeDto, @CurrentUser() actor: FulfillmentActor) {
    return this.hubDesk.registerBarcode(locationId, orderId, dto, actor);
  }

  @Post('locations/:id/desk/receipts/:receiptId/reverse')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.receive')
  async deskReverse(@Param('id') locationId: string, @Param('receiptId', ParseUUIDPipe) receiptId: string, @Body() dto: ReverseReceiptDto, @CurrentUser() actor: FulfillmentActor) {
    return this.hubDesk.reverse(locationId, receiptId, dto, actor);
  }

  @Patch('locations/:id/desk/orders/:orderId/lines/:orderItemId')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.prepare')
  async deskUpdateLine(
    @Param('id') locationId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('orderItemId', ParseUUIDPipe) orderItemId: string,
    @Body() dto: { quantity?: number; unitPrice?: number },
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.hubDesk.updateLine(locationId, orderId, orderItemId, dto, actor);
  }

  // --- Hub Returns (GLO-315): physical inspection; the refund decision stays with Ordering/admin ---

  @Get('locations/:id/returns')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('return.read')
  async listReturns(@Param('id') locationId: string, @CurrentUser() actor: FulfillmentActor) {
    return this.hubReturns.list(locationId, actor);
  }

  @Post('locations/:id/returns/:resolutionId/inspections')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('return.manage')
  async inspectReturn(@Param('id') locationId: string, @Param('resolutionId', ParseUUIDPipe) resolutionId: string, @Body() dto: InspectReturnDto, @CurrentUser() actor: FulfillmentActor) {
    return this.hubReturns.inspect(locationId, resolutionId, dto, actor);
  }

  @Post('locations/:id/returns/:resolutionId/inspections/:inspectionId/correct')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('return.manage')
  async correctInspection(@Param('id') locationId: string, @Param('resolutionId', ParseUUIDPipe) resolutionId: string, @Param('inspectionId', ParseUUIDPipe) inspectionId: string, @Body() dto: CorrectInspectionDto, @CurrentUser() actor: FulfillmentActor) {
    return this.hubReturns.correct(locationId, resolutionId, inspectionId, dto, actor);
  }

  // --- Hub work queues (GLO-239) ---

  @Get('locations/:id/receivables')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.receive')
  async getReceivables(@Param('id') locationId: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.getReceivables(locationId, actor);
  }

  @Get('locations/:id/shipments')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.prepare')
  async listHubShipments(@Param('id') locationId: string, @Query() query: HubShipmentQueryDto, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.listHubShipments(locationId, actor, { statuses: query.status, take: query.take ?? 20, skip: query.skip ?? 0 });
  }

  @Get('locations/:id/runs')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('delivery.plan')
  async listHubRuns(@Param('id') locationId: string, @Query() query: HubRunQueryDto, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.listHubRuns(locationId, actor, { statuses: query.status, take: query.take ?? 20, skip: query.skip ?? 0 });
  }

  // --- Inventory Management (GLO-151) ---

  @Get('locations/:id/inventory')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getInventoryBalances(@Param('id') locationId: string, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.getInventoryBalances(locationId, actor);
  }

  @Post('inventory/adjust')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async adjustInventory(@Body() dto: AdjustInventoryDto, @CurrentUser() actor: FulfillmentActor) {
    return this.fulfillmentService.adjustInventory(dto, actor);
  }

  // --- Route Planning (Maps Phase 3.1) ---

  @Post('routes/plan')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async planRoute(@Body() dto: PlanRouteDto) {
    return this.routePlanningService.planRoute(dto);
  }

  @Get('delivery-batches/:id/route')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async getBatchRoute(@Param('id') id: string, @CurrentUser() actor: FulfillmentActor) {
    return this.routePlanningService.planBatchRoute(id, actor);
  }

  // --- Route Optimization (Maps Phase 3.2) ---

  @Get('delivery-batches/:id/optimize-preview')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async previewBatchOptimization(
    @Param('id') id: string,
    @Query() query: OptimizationOptionsDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.routeOptimizationService.previewBatchOptimization(id, actor, query);
  }

  @Get('delivery-batches/:id/optimize')
  @Roles('ADMIN', 'HUB_OPERATOR', 'DRIVER')
  async getBatchOptimizationAlias(
    @Param('id') id: string,
    @Query() query: OptimizationOptionsDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.routeOptimizationService.previewBatchOptimization(id, actor, query);
  }

  @Post('delivery-batches/:id/apply-optimization')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('delivery.plan')
  async applyBatchOptimization(
    @Param('id') id: string,
    @Body() dto: ApplyOptimizationDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.routeOptimizationService.applyBatchOptimization(id, actor, dto);
  }

  // --- Adaptive Multi-Driver Dispatch Planner (Maps Phase 3.3A) ---

  @Post('dispatch/plan-preview')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('delivery.plan')
  async planDispatchPreview(
    @Body() dto: PlanDispatchDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.dispatchPlanningService.planDispatch(dto, actor);
  }

  @Post('locations/:id/dispatch/plan-preview')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('delivery.plan')
  async planHubDispatchPreview(
    @Param('id') id: string,
    @Body() dto: PlanDispatchDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.dispatchPlanningService.planDispatch({ ...dto, hubId: id }, actor);
  }

  // --- Dispatch Plan Approval & Persistence (Maps Phase 3.3B) ---

  @Post('dispatch/plan-approve')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('delivery.plan')
  async approveDispatchPlan(
    @Body() dto: ApproveDispatchPlanDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.dispatchPlanningService.approveDispatchPlan(dto, actor);
  }

  @Post('locations/:id/dispatch/plan-approve')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('delivery.plan')
  async approveHubDispatchPlan(
    @Param('id') id: string,
    @Body() dto: ApproveDispatchPlanDto,
    @CurrentUser() actor: FulfillmentActor,
  ) {
    return this.dispatchPlanningService.approveDispatchPlan({ ...dto, hubId: id }, actor);
  }
}

