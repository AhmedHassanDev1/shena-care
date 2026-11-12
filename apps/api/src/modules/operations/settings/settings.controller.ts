import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsObject } from 'class-validator';
import { AuthGuard } from '../../accounts/guards/auth.guard';
import { RolesGuard } from '../../accounts/guards/roles.guard';
import { Roles } from '../../accounts/decorators/roles.decorator';
import { CurrentUser } from '../../accounts/decorators/current-user.decorator';
import { SettingsService } from './settings.service';

export class UpdateSettingsDto {
  /** `{ "<setting key>": <value> }`; each value is validated by the setting's own rules. */
  @IsObject()
  changes!: Record<string, unknown>;
}

/** Admin-only: every read and write of operational settings is authorised here, never by the UI. */
@Controller('operations/settings')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list() {
    return this.settings.list();
  }

  @Patch()
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: { id: string }) {
    return this.settings.update(dto.changes, user.id);
  }

  @Post(':key/reset')
  reset(@Param('key') key: string, @CurrentUser() user: { id: string }) {
    return this.settings.reset(key, user.id);
  }

  @Get('history')
  history(@Query('limit') limit?: string) {
    return this.settings.history(limit ? Number(limit) || 30 : 30);
  }

  @Get('security')
  security() {
    return this.settings.securityOverview();
  }
}

/** What the storefront may show about the business; contains no secrets, and no sign-in is needed to read it. */
@Controller('storefront')
export class StorefrontInfoController {
  constructor(private readonly settings: SettingsService) {}

  @Get('contact')
  contact() {
    return this.settings.publicBusinessInfo();
  }
}
