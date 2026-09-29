import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  CommerceService,
  CreateSellingPriceDto,
  UpdateSellingPriceDto,
} from '../../../modules/commerce/public';

@Controller('commerce/prices')
export class PriceController {
  constructor(private readonly commerceService: CommerceService) {}

  // ---------------------------------------------------------------------------
  // Price Write
  // ---------------------------------------------------------------------------

  // POST /commerce/prices
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSellingPrice(@Body() dto: CreateSellingPriceDto) {
    return this.commerceService.addSellingPrice(dto);
  }

  // ---------------------------------------------------------------------------
  // Price Query by SKU
  // ---------------------------------------------------------------------------

  // GET /commerce/prices/skus/:skuId/current
  @Get('skus/:skuId/current')
  async getCurrentPrice(@Param('skuId') skuId: string) {
    const price = await this.commerceService.getCurrentSellingPrice(skuId);
    if (!price) {
      throw new NotFoundException(`No active selling price found for SKU: ${skuId}`);
    }
    return price;
  }

  // GET /commerce/prices/skus/:skuId
  @Get('skus/:skuId')
  async getPriceHistory(@Param('skuId') skuId: string) {
    return this.commerceService.getSellingPrices(skuId);
  }

  // ---------------------------------------------------------------------------
  // Price Updates & Deactivation
  // ---------------------------------------------------------------------------

  // PATCH /commerce/prices/:id/deactivate
  @Patch(':id/deactivate')
  async deactivateSellingPrice(@Param('id') id: string) {
    return this.commerceService.deactivateSellingPrice(id);
  }

  // PATCH /commerce/prices/:id
  @Patch(':id')
  async updateSellingPrice(
    @Param('id') id: string,
    @Body() dto: UpdateSellingPriceDto,
  ) {
    return this.commerceService.updateSellingPrice(id, dto);
  }
}
