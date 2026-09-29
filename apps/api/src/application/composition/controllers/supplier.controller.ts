import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  SourcingService,
  CreateSupplierDto,
  UpdateSupplierDto,
  CreateSupplierOfferDto,
  UpdateSupplierOfferDto,
} from '../../../modules/sourcing/public';

@Controller('sourcing')
export class SupplierController {
  constructor(private readonly sourcingService: SourcingService) {}

  // ---------------------------------------------------------------------------
  // Supplier Management
  // ---------------------------------------------------------------------------

  @Post('suppliers')
  @HttpCode(HttpStatus.CREATED)
  async createSupplier(@Body() dto: CreateSupplierDto) {
    return this.sourcingService.createSupplier(dto);
  }

  @Get('suppliers')
  async getSuppliers() {
    return this.sourcingService.getSuppliers();
  }

  @Get('suppliers/:id')
  async getSupplier(@Param('id') id: string) {
    const supplier = await this.sourcingService.getSupplier(id);
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }

  @Patch('suppliers/:id')
  async updateSupplier(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.sourcingService.updateSupplier(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Supplier Offer Management
  // ---------------------------------------------------------------------------

  @Post('offers')
  @HttpCode(HttpStatus.CREATED)
  async createOffer(@Body() dto: CreateSupplierOfferDto) {
    return this.sourcingService.createSupplierOffer(dto);
  }

  @Get('offers')
  async getOffers(
    @Query('supplierId') supplierId?: string,
    @Query('skuId') skuId?: string,
  ) {
    return this.sourcingService.getSupplierOffers({ supplierId, skuId });
  }

  @Patch('offers/:id')
  async updateOffer(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierOfferDto,
  ) {
    return this.sourcingService.updateSupplierOffer(id, dto);
  }

  @Patch('offers/:id/confirm')
  async confirmOfferAvailability(
    @Param('id') id: string,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    return this.sourcingService.confirmSupplierOfferAvailability(id, isAvailable);
  }
}
