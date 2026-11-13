import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { Roles } from '../accounts/decorators/roles.decorator';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../platform/auth';
import { RoutineImportDto, StudioRoutineDto } from './dto/routine-content.dto';
import { RoutineStudioService } from './services/routine-studio.service';
import { EXAMPLE_ROUTINE_DOCUMENT, IMPORT_LIMITS, IMPORT_TIMINGS, ROUTINE_IMPORT_SCHEMA } from './services/routine-import';

type Staff = { id: string };

/** Admin Routine Studio (GLO-312). Admin only: customers, hub, drivers and suppliers have no route here. */
@Controller('care/admin/studio')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('catalog.manage')
export class RoutineStudioController {
  constructor(private readonly studio: RoutineStudioService) {}

  @Get('routines')
  list() { return this.studio.list(); }

  @Post('routines')
  create(@Body() dto: StudioRoutineDto, @CurrentUser() admin: Staff) { return this.studio.createDraft(dto, admin.id); }

  @Get('routines/:id')
  get(@Param('id') id: string) { return this.studio.get(id); }

  @Put('routines/:id')
  update(@Param('id') id: string, @Body() dto: StudioRoutineDto, @CurrentUser() admin: Staff) { return this.studio.updateDraft(id, dto, admin.id); }

  @Post('routines/:id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('id') id: string, @CurrentUser() admin: Staff) { return this.studio.publish(id, admin.id); }

  @Post('routines/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@Param('id') id: string, @CurrentUser() admin: Staff) { return this.studio.unpublish(id, admin.id); }

  @Get('routines/:id/revisions')
  revisions(@Param('id') id: string) { return this.studio.revisions(id); }

  /** The documented import format with a downloadable example. */
  @Get('import/schema')
  schema() {
    return {
      schema: ROUTINE_IMPORT_SCHEMA, limits: IMPORT_LIMITS, timings: IMPORT_TIMINGS, example: EXAMPLE_ROUTINE_DOCUMENT,
      notes: [
        'Each product is identified by exactly one of: skuId (UUID), sku (catalog code) or barcode.',
        'The import creates a DRAFT only; publishing is a separate, authorized action.',
        'The import never creates or changes catalog products.',
      ],
    };
  }

  /** Validates and resolves a document; nothing is saved. */
  @Post('import/preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: RoutineImportDto) { return this.studio.previewImport(dto.document); }

  /** Creates the draft after the Admin confirmed the preview (`confirm: true`). */
  @Post('import')
  importDraft(@Body() dto: RoutineImportDto, @CurrentUser() admin: Staff) {
    if (dto.confirm !== true) return this.studio.previewImport(dto.document).then(preview => ({ ...preview, created: false, message: 'Send confirm: true to create the draft' }));
    return this.studio.importDraft(dto.document, admin.id);
  }
}
