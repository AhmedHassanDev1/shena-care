import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { Roles } from '../accounts/decorators/roles.decorator';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../platform/auth';
import { EligibilityDto } from './dto/routine-workspace.dto';
import { RoutineCatalogService } from './services/routine-catalog.service';

type Staff = { id: string };

/** Ready-made routines for discovery (public). Registered before CareController so «featured» is not read as an id. */
@Controller('care/routines')
export class RoutineCatalogController {
  constructor(private readonly catalog: RoutineCatalogService) {}

  @Get('featured')
  featured(@Query('concern') concern?: string) {
    return this.catalog.featured(concern && /^[a-z0-9-]{1,60}$/.test(concern) ? concern : undefined);
  }
}

/** Blueprint publishing and product-role approval: system configuration, never a customer's routine. */
@Controller('care/admin/routines')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('catalog.manage')
export class RoutineAdminController {
  constructor(private readonly catalog: RoutineCatalogService) {}

  @Get('blueprints')
  blueprints() {
    return this.catalog.listBlueprints();
  }

  @Get('readiness')
  readiness() {
    return this.catalog.readiness();
  }

  @Post('blueprints/:id/publish')
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: Staff) {
    return this.catalog.publish(id, admin.id);
  }

  @Post('blueprints/:id/retire')
  retire(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.retire(id);
  }

  @Post('eligibility')
  eligibility(@Body() dto: EligibilityDto, @CurrentUser() admin: Staff) {
    return this.catalog.upsertEligibility(dto, admin.id);
  }

  @Get('rules')
  rules() {
    return this.catalog.listRules();
  }
}
