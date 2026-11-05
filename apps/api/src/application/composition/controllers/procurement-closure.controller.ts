import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { page } from '../../../platform/api/paging.dto';
import {
  AcquisitionCostService, CaptureAcquisitionCostDto, CorrectAcquisitionCostDto, ListAcquisitionCostsQueryDto,
  RegisterSupplierEnrollmentDto, SupplierEnrollmentService, UpdateSupplierEnrollmentDto,
} from '../../../modules/sourcing/public';

type RequestUser = { id: string };

/** Admin-only supplier participation in BROADCAST_ON_DEMAND: registration, activation, product scope, calendar, readiness and audit. */
@Controller('procurement/enrollment')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('supplier.manage')
export class SupplierEnrollmentController {
  constructor(private readonly enrollment: SupplierEnrollmentService) {}

  @Get()
  list() {
    return this.enrollment.list();
  }

  @Post()
  register(@CurrentUser() user: RequestUser, @Body() dto: RegisterSupplierEnrollmentDto) {
    return this.enrollment.register(dto, user.id);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierEnrollmentDto) {
    return this.enrollment.update(id, dto, user.id);
  }

  @Get(':id/audit')
  audit(@Param('id', ParseUUIDPipe) id: string) {
    return this.enrollment.audit(id);
  }
}

/** Hub capture of the actual invoice cost; corrections and order contribution are Admin-only. Suppliers have no route here. */
@Controller('procurement/acquisition-costs')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class AcquisitionCostController {
  constructor(private readonly costs: AcquisitionCostService) {}

  @Get()
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.receive')
  list(@Query() query: ListAcquisitionCostsQueryDto) {
    return this.costs.listLines({ status: query.status, purchaseOrderId: query.purchaseOrderId, ...page(query) });
  }

  @Post('purchase-orders/:purchaseOrderId/lines/:lineId')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.receive')
  capture(@CurrentUser() user: RequestUser, @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() dto: CaptureAcquisitionCostDto) {
    return this.costs.capture(purchaseOrderId, lineId, dto, user.id);
  }

  @Post('lots/:id/corrections')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @RequirePermissions('sourcing.manage')
  correct(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectAcquisitionCostDto) {
    return this.costs.correct(id, dto, user.id);
  }

  @Get('lots/:id/history')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('hub.receive')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.costs.history(id);
  }

  @Get('orders/:orderId/contribution')
  @Roles('ADMIN')
  @RequirePermissions('sourcing.manage')
  contribution(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.costs.orderContribution(orderId);
  }
}
