import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { Roles } from '../accounts/decorators/roles.decorator';
import { RecordRetailObservationDto } from './dto/retail-price.dto';
import { RetailPriceObservationService } from './services/retail-price-observation.service';

@Controller('ingestion/retail-prices')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class RetailPriceController {
  constructor(private readonly observations: RetailPriceObservationService) {}

  @Post()
  record(@Req() req: { user: { id: string } }, @Body() dto: RecordRetailObservationDto) {
    return this.observations.record(dto, req.user.id);
  }

  @Get('sku/:skuId')
  benchmark(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.observations.benchmark(skuId);
  }

  @Post('sku/:skuId/research')
  @HttpCode(HttpStatus.OK)
  research(@Req() req: { user: { id: string } }, @Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.observations.researchSku(skuId, req.user.id);
  }
}
