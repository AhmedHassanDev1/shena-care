import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { Roles } from '../accounts/decorators/roles.decorator';
import { AuthenticatedUserRequest } from './ingestion.controller';
import { ResearchBrandDto, SaveResearchedBrandDto, CreatePolicyBrandDto, UpdateBrandPolicyDto, PreviewEligibilityPolicyDto, PreviewEligibilityMappingsDto, RecheckEligibilityGroupDto, RetryEligibilityDto } from './dto/eligibility-policy.dto';
import { IngestionService } from './services/ingestion.service';
import { IngestionEligibilityService } from './services/ingestion-eligibility.service';
import { BrandResearchService } from './services/brand-research.service';

@Controller('ingestion/eligibility')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class EligibilityController {
  constructor(private readonly policy: IngestionEligibilityService, private readonly ingestion: IngestionService, private readonly research: BrandResearchService) {}
  @Get() current() { return this.policy.current(); }
  @Get('options') options() { return this.policy.options(); }
  @Get('history') history() { return this.policy.history(); }
  @Get('holds') holds() { return this.policy.holds(); }
  /** Catalog Policy page: one canonical Brand at a time; each change is the next approved version. */
  @Get('catalog-policy') catalogPolicy() { return this.policy.catalogPolicy(); }
  @Get('brands/:brandId/products') brandProducts(@Param('brandId', ParseUUIDPipe) brandId: string, @Query('q') q?: string) {
    return this.policy.brandProducts(brandId, typeof q === 'string' ? q : '');
  }
  @Post('brands') createBrand(@Body() dto: CreatePolicyBrandDto, @Req() req: AuthenticatedUserRequest) {
    return this.policy.createBrand(dto, req.user!.id);
  }
  /** Smart Add Brand: look a name up online (advisory), then save the reviewed result as one canonical Brand. */
  @Post('brands/research') researchBrand(@Body() dto: ResearchBrandDto, @Req() req: AuthenticatedUserRequest) { return this.research.research(dto, req.user!.id); }
  @Post('brands/from-research') saveResearchedBrand(@Body() dto: SaveResearchedBrandDto, @Req() req: AuthenticatedUserRequest) { return this.research.saveBrand(dto, req.user!.id); }
  @Get('brands/:brandId/identity') brandIdentity(@Param('brandId', ParseUUIDPipe) brandId: string, @Req() req: AuthenticatedUserRequest) { return this.research.identity(brandId, req.user!.id); }
  @Patch('brands/:brandId') updateBrand(@Param('brandId', ParseUUIDPipe) brandId: string, @Body() dto: UpdateBrandPolicyDto, @Req() req: AuthenticatedUserRequest) {
    return this.policy.updateBrand(brandId, dto, req.user!.id);
  }
  @Post('holds/recheck') recheckGroup(@Body() dto: RecheckEligibilityGroupDto, @Req() req: AuthenticatedUserRequest) {
    return this.ingestion.recheckEligibilityGroup(dto, req.user!.id);
  }
  @Post('mappings/preview') previewMappings(@Body() dto: PreviewEligibilityMappingsDto, @Req() req: AuthenticatedUserRequest) {
    return this.policy.previewMappings(dto, req.user!.id);
  }
  @Post('jobs/:id/recheck') recheck(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryEligibilityDto, @Req() req: AuthenticatedUserRequest) {
    return this.ingestion.recheckEligibilityHolds(id, req.user!.id, dto.reason);
  }
  @Post('preview') preview(@Body() dto: PreviewEligibilityPolicyDto, @Req() req: AuthenticatedUserRequest) {
    return this.policy.preview(dto, req.user!.id);
  }
  @Post(':id/approve') approve(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedUserRequest) {
    return this.policy.approve(id, req.user!.id);
  }
}
