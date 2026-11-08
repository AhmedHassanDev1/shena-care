import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { SequenceDto } from './catalog-workbench.controller';
import { ROUTINE_RULE_VERSION } from '../../../modules/ingestion/public';
import { CatalogProfileService } from '../services/catalog-profile.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Routine-ready metadata of live products for the Routine Builder, the Recommendation Engine and Ask Shina. Read-only. Every field carries its status
 * (VERIFIED, RULE_DERIVED, UNKNOWN, CONFLICT); consumers must not treat RULE_DERIVED guidance as a manufacturer instruction. Unpublished products are never returned.
 */
@Controller('catalog')
export class RoutineProfileController {
  constructor(private readonly profiles: CatalogProfileService) {}

  @Get('skus/:skuId/routine-profile')
  one(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.profiles.publicRoutineProfile(skuId);
  }

  /** Orders live products into one routine from their persisted placement constraints; unpublished SKUs are reported missing, never revealed. */
  @Post('routine-profiles/sequence')
  @HttpCode(HttpStatus.OK)
  sequence(@Body() dto: SequenceDto) {
    return this.profiles.sequence(dto.skuIds, dto.period, true);
  }

  @Get('routine-profiles')
  async many(@Query('skuIds') skuIds?: string) {
    const ids = [...new Set((skuIds ?? '').split(',').map(id => id.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 50 || ids.some(id => !UUID.test(id))) throw new BadRequestException('Give 1 to 50 SKU ids, comma separated');
    const found: Array<Awaited<ReturnType<CatalogProfileService['publicRoutineProfile']>>> = [];
    for (const id of ids) {
      try { found.push(await this.profiles.publicRoutineProfile(id)); } catch { /* not live or no profile: omitted, never invented */ }
    }
    return { ruleVersion: ROUTINE_RULE_VERSION, items: found, missing: ids.filter(id => !found.some(item => item.skuId === id)) };
  }
}
