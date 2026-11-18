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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import {
  ChangeSellingPriceDto,
  CommerceService,
  CreateSellingPriceDto,
  UpdateSellingPriceDto,
} from '../../../modules/commerce/public';

@Controller('commerce/prices')
@UseGuards(AuthGuard, RolesGuard)
// Hub operators may READ prices (reference and prefill); every write is Admin only, so the storefront price is never edited by the Hub.
@Roles('ADMIN', 'HUB_OPERATOR')
export class PriceController {
  constructor(private readonly commerceService: CommerceService) {}

  // ---------------------------------------------------------------------------
  // Price Write
  // ---------------------------------------------------------------------------

  // POST /commerce/prices
  @Roles('ADMIN')
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

  // POST /commerce/prices/skus/:skuId/change — new storefront price from now on (current price closed, history kept)
  @Roles('ADMIN')
  @Post('skus/:skuId/change')
  @HttpCode(HttpStatus.OK)
  async changeSellingPrice(@Param('skuId') skuId: string, @Body() dto: ChangeSellingPriceDto) {
    return this.commerceService.changeSellingPrice(skuId, dto);
  }

  // PATCH /commerce/prices/:id/deactivate
  @Roles('ADMIN')
  @Patch(':id/deactivate')
  async deactivateSellingPrice(@Param('id') id: string) {
    return this.commerceService.deactivateSellingPrice(id);
  }

  // PATCH /commerce/prices/:id
  @Roles('ADMIN')
  @Patch(':id')
  async updateSellingPrice(
    @Param('id') id: string,
    @Body() dto: UpdateSellingPriceDto,
  ) {
    return this.commerceService.updateSellingPrice(id, dto);
  }
}
