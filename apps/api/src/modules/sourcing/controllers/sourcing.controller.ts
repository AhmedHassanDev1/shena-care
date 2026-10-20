import { Controller, Get, Post, Body, Param, Patch, Query, UseGuards, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SourcingService } from '../services/sourcing.service';
import { CreateSupplierDto, UpdateSupplierDto } from '../dto/supplier.dto';
import { CreateSupplierOfferDto, UpdateSupplierOfferDto } from '../dto/supplier-offer.dto';
import { AdjustPayableDto, MarkAsPaidDto, PayableQueryDto } from '../dto/payables.dto';
import { page } from '../../../platform/api/paging.dto';
import { IsBoolean, IsNotEmpty } from 'class-validator';
import { PayablesService } from '../services/payables.service';
import { AuthGuard } from '../../accounts/guards/auth.guard';
import { RolesGuard } from '../../accounts/guards/roles.guard';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { Roles } from '../../accounts/decorators/roles.decorator';
import { CurrentUser } from '../../accounts/decorators/current-user.decorator';

type TenantUser = { roles?: string[]; supplierId?: string | null };

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

  /** Loads an offer and applies the same tenant isolation as supplierId-scoped routes. */
  private async ownedOffer(user: TenantUser, id: string) {
    const offer = await this.sourcingService.getSupplierOffer(id);
    if (!offer) throw new NotFoundException(`Supplier offer ${id} not found`);
    this.checkTenantIsolation(user, offer.supplierId);
    return offer;
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
  async getSupplierOffer(@CurrentUser() user: TenantUser, @Param('id') id: string) {
    return this.ownedOffer(user, id);
  }

  @Patch('offers/:id')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async updateSupplierOffer(@CurrentUser() user: TenantUser, @Param('id') id: string, @Body() dto: UpdateSupplierOfferDto) {
    await this.ownedOffer(user, id);
    return this.sourcingService.updateSupplierOffer(id, dto);
  }

  @Post('offers/:id/confirm-availability')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  async confirmAvailability(@CurrentUser() user: TenantUser, @Param('id') id: string, @Body() dto: ConfirmAvailabilityDto) {
    await this.ownedOffer(user, id);
    return this.sourcingService.confirmSupplierOfferAvailability(id, dto.isAvailable);
  }

  // --- GLO-129: Supplier Payables ---

  @Post('purchase-orders/:id/payable')
  @Roles('ADMIN', 'HUB_OPERATOR')
  async createPayableFromPO(@Param('id') id: string) {
    return this.payablesService.createPayableFromPO(id);
  }

  @Get('payables')
  @Roles('ADMIN')
  async listPayables(@Query() query: PayableQueryDto) {
    return this.payablesService.listPayables({ status: query.status, ...page(query) });
  }

  @Patch('payables/:id/adjust')
  @Roles('ADMIN')
  async adjustPayable(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: AdjustPayableDto
  ) {
    return this.payablesService.adjustPayable(id, { amount: dto.amount, reason: dto.reason, actorId: user.id });
  }

  @Post('payables/:id/apply-credit')
  @Roles('ADMIN')
  async applyCredit(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: { creditAmount: number; supplierReturnRef: string; reason?: string }
  ) {
    return this.payablesService.applySupplierCredit(id, {
      creditAmount: dto.creditAmount,
      supplierReturnRef: dto.supplierReturnRef,
      reason: dto.reason,
      actorId: user.id,
    });
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
