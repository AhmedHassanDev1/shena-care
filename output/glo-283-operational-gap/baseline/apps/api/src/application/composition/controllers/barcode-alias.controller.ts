import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { BARCODE_ALIAS_SOURCES, ProductIdentityService } from '../../../modules/catalog/public';

export class ApproveBarcodeAliasDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  barcode: string;

  @IsUUID()
  skuId: string;

  @IsIn([...BARCODE_ALIAS_SOURCES])
  source: string;

  /** Packaging photo reference, manufacturer notice, invoice line… */
  @IsOptional() @IsString() @MaxLength(255)
  evidenceRef?: string;

  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

export class AliasQueryDto {
  @IsUUID()
  skuId: string;
}

/** Catalog review of extra manufacturer barcodes for the same SKU (GLO-242). Reviewers only. */
@Controller('catalog/barcode-aliases')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('catalog.manage')
export class BarcodeAliasController {
  constructor(private readonly identity: ProductIdentityService) {}

  @Post()
  approve(@CurrentUser() actor: { id: string }, @Body() dto: ApproveBarcodeAliasDto) {
    return this.identity.approveAlias({ ...dto, actorId: actor.id });
  }

  @Patch(':id/retire')
  retire(@CurrentUser() actor: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.identity.retireAlias(id, actor.id);
  }

  @Get()
  list(@Query() query: AliasQueryDto) {
    return this.identity.listAliases(query.skuId);
  }
}
