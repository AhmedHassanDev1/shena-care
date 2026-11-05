import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminCatalogImportRowOutcome } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { Roles } from '../accounts/decorators/roles.decorator';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../platform/auth';
import { multerOptions } from '../../platform/security/upload-validator';
import { AdminCatalogImportService } from './services/admin-catalog-import.service';

export class ResolveImportRowDto {
  @IsIn(['LINK_SKU', 'REJECT']) action: 'LINK_SKU' | 'REJECT';
  @ValidateIf(dto => dto.action === 'LINK_SKU') @IsUUID() skuId?: string;
  @IsString() @MinLength(5) @MaxLength(500) note: string;
}

export class MatchImportDto {
  /** Look again at rows still waiting on a person, e.g. after their SKU was created in the workbench. */
  @IsOptional() recheck?: boolean;
}

/**
 * Admin catalog bootstrap. Deliberately not behind SupplierFileIntakeFrozenGuard: these lists carry no supplier, stock, offer or price meaning,
 * so they stay available in every sourcing mode. Admin only.
 */
@Controller('admin/catalog-imports')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('catalog.manage')
export class AdminCatalogImportController {
  constructor(private readonly imports: AdminCatalogImportService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', multerOptions))
  upload(@CurrentUser() user: { id: string }, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    return this.imports.upload(file, user.id);
  }

  @Get()
  list() {
    return this.imports.listJobs();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.getJob(id);
  }

  @Get(':id/rows')
  rows(@Param('id', ParseUUIDPipe) id: string, @Query('outcome') outcome?: string, @Query('offset') offset?: string, @Query('limit') limit?: string) {
    if (outcome && !(outcome in AdminCatalogImportRowOutcome)) throw new BadRequestException('Unknown outcome');
    return this.imports.listRows(id, { outcome: outcome as AdminCatalogImportRowOutcome | undefined, offset: offset ? Number(offset) : 0, limit: limit ? Number(limit) : 100 });
  }

  @Post(':id/match')
  @HttpCode(HttpStatus.OK)
  match(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MatchImportDto) {
    return this.imports.match(id, { recheck: dto?.recheck === true });
  }

  @Post('rows/:rowId/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@CurrentUser() user: { id: string }, @Param('rowId', ParseUUIDPipe) rowId: string, @Body() dto: ResolveImportRowDto) {
    return this.imports.resolveRow(rowId, dto, user.id);
  }
}
