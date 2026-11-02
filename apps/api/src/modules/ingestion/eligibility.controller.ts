import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { Roles } from '../accounts/decorators/roles.decorator';
import { AuthenticatedUserRequest } from './ingestion.controller';
import { PreviewEligibilityPolicyDto, PreviewEligibilityMappingsDto, RecheckEligibilityGroupDto, RetryEligibilityDto } from './dto/eligibility-policy.dto';
import { IngestionService } from './services/ingestion.service';
import { IngestionEligibilityService } from './services/ingestion-eligibility.service';

@Controller('ingestion/eligibility')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class EligibilityController {
  constructor(private readonly policy: IngestionEligibilityService, private readonly ingestion: IngestionService) {}
  @Get() current() { return this.policy.current(); }
  @Get('options') options() { return this.policy.options(); }
  @Get('history') history() { return this.policy.history(); }
  @Get('holds') holds() { return this.policy.holds(); }
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
