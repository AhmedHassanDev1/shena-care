import { Controller, Get, Post, Body, Param, Patch, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { SourcingService } from '../services/sourcing.service';
import { CreateSupplierDto, UpdateSupplierDto } from '../dto/supplier.dto';
import { CreateSupplierOfferDto, UpdateSupplierOfferDto } from '../dto/supplier-offer.dto';
import { AdjustPayableDto, MarkAsPaidDto } from '../dto/payables.dto';
import { IsBoolean, IsNotEmpty } from 'class-validator';
import { PayablesService } from '../services/payables.service';
import { AuthGuard } from '../../accounts/guards/auth.guard';
import { RolesGuard } from '../../accounts/guards/roles.guard';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { Roles } from '../../accounts/decorators/roles.decorator';
import { CurrentUser } from '../../accounts/decorators/current-user.decorator';

export class ConfirmAvailabilityDto {
  @IsBoolean()
  @IsNotEmpty()
  isAvailable: boolean;
}

@Controller('sourcing')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class SourcingController {
  constructor(
    private readonly sourcingService: SourcingService,
    private readonly payablesService: PayablesService,
  ) {}

  private checkTenantIsolation(user: any, requestedSupplierId?: string) {
    if (user.roles?.includes('SUPPLIER')) {
      // In a real implementation with `userId` on `Supplier`, we would verify ownership.
      // For MVP, block access if it's not their explicit ID or if we can't determine it.
      // We will assume for now they must provide a supplierId matching their user id or a linked property.
      if (!requestedSupplierId || requestedSupplierId !== user.supplierId) {
        throw new ForbiddenException('Cannot access other supplier data');
      }
    }
  }

  @Post('suppliers')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async createSupplier(@Body() dto: CreateSupplierDto) {
    return this.sourcingService.createSupplier(dto);
  }

  @Get('suppliers')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async getSuppliers() {
    return this.sourcingService.getSuppliers();
  }

  @Get('suppliers/:id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getSupplier(@CurrentUser() user: any, @Param('id') id: string) {
    this.checkTenantIsolation(user, id);
    return this.sourcingService.getSupplier(id);
  }

  @Patch('suppliers/:id')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async updateSupplier(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.sourcingService.updateSupplier(id, dto);
  }

  @Post('offers')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async createSupplierOffer(@CurrentUser() user: any, @Body() dto: CreateSupplierOfferDto) {
    this.checkTenantIsolation(user, dto.supplierId);
    return this.sourcingService.createSupplierOffer(dto);
  }

  @Get('offers')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getSupplierOffers(
    @CurrentUser() user: any,
    @Query('supplierId') supplierId?: string,
    @Query('skuId') skuId?: string,
  ) {
    this.checkTenantIsolation(user, supplierId);
    return this.sourcingService.getSupplierOffers({ supplierId, skuId });
  }

  @Get('offers/:id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async getSupplierOffer(@CurrentUser() user: any, @Param('id') id: string) {
    // Assuming offer is retrieved to check ownership. For simplicity, skipped in MVP controller
    // but would be done in service.
    return this.sourcingService.getSupplierOffer(id);
  }

  @Patch('offers/:id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async updateSupplierOffer(@Param('id') id: string, @Body() dto: UpdateSupplierOfferDto) {
    return this.sourcingService.updateSupplierOffer(id, dto);
  }

  @Post('offers/:id/confirm-availability')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async confirmAvailability(@Param('id') id: string, @Body() dto: ConfirmAvailabilityDto) {
    return this.sourcingService.confirmSupplierOfferAvailability(id, dto.isAvailable);
  }

  // --- GLO-129: Supplier Payables ---

  @Post('purchase-orders/:id/payable')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async createPayableFromPO(@Param('id') id: string) {
    return this.payablesService.createPayableFromPO(id);
  }

  @Patch('payables/:id/adjust')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async adjustPayable(
    @Param('id') id: string,
    @Body() dto: AdjustPayableDto
  ) {
    return this.payablesService.adjustPayable(id, dto);
  }

  @Patch('payables/:id/mark-paid')
  @Roles('ADMIN')
  async markPayableAsPaid(
    @Param('id') id: string,
    @Body() dto: MarkAsPaidDto
  ) {
    return this.payablesService.markAsPaid(id, dto.paymentRef);
  }
}
