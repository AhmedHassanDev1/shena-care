import { Controller, Get, Post, Body, Param, Patch, Query } from '@nestjs/common';
import { SourcingService } from '../services/sourcing.service';
import { CreateSupplierDto, UpdateSupplierDto } from '../dto/supplier.dto';
import { CreateSupplierOfferDto, UpdateSupplierOfferDto } from '../dto/supplier-offer.dto';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class ConfirmAvailabilityDto {
  @IsBoolean()
  @IsNotEmpty()
  isAvailable: boolean;
}

@Controller('sourcing')
export class SourcingController {
  constructor(private readonly sourcingService: SourcingService) {}

  @Post('suppliers')
  async createSupplier(@Body() dto: CreateSupplierDto) {
    return this.sourcingService.createSupplier(dto);
  }

  @Get('suppliers')
  async getSuppliers() {
    return this.sourcingService.getSuppliers();
  }

  @Get('suppliers/:id')
  async getSupplier(@Param('id') id: string) {
    return this.sourcingService.getSupplier(id);
  }

  @Patch('suppliers/:id')
  async updateSupplier(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.sourcingService.updateSupplier(id, dto);
  }

  @Post('offers')
  async createSupplierOffer(@Body() dto: CreateSupplierOfferDto) {
    return this.sourcingService.createSupplierOffer(dto);
  }

  @Get('offers')
  async getSupplierOffers(
    @Query('supplierId') supplierId?: string,
    @Query('skuId') skuId?: string,
  ) {
    return this.sourcingService.getSupplierOffers({ supplierId, skuId });
  }

  @Get('offers/:id')
  async getSupplierOffer(@Param('id') id: string) {
    return this.sourcingService.getSupplierOffer(id);
  }

  @Patch('offers/:id')
  async updateSupplierOffer(@Param('id') id: string, @Body() dto: UpdateSupplierOfferDto) {
    return this.sourcingService.updateSupplierOffer(id, dto);
  }

  @Post('offers/:id/confirm-availability')
  async confirmAvailability(@Param('id') id: string, @Body() dto: ConfirmAvailabilityDto) {
    return this.sourcingService.confirmSupplierOfferAvailability(id, dto.isAvailable);
  }
}
