import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { CapitalPartnerService, EntryKind } from '../services/capital-partner.service';

const intOr = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException(`Expected a whole number between ${min} and ${max}`);
  return parsed;
};

/**
 * The capital partner portal API. Read-only, role CAPITAL_PARTNER only. There is no partner id anywhere in these routes: the profile is found
 * from the signed-in account, so one partner can never ask for another's data. Admins use the Finance workspace, not this portal.
 */
@Controller('capital-partner')
@UseGuards(AuthGuard, RolesGuard)
@Roles('CAPITAL_PARTNER')
export class CapitalPartnerController {
  constructor(private readonly partner: CapitalPartnerService) {}

  @Get('me')
  me(@CurrentUser() user: { id: string }) { return this.partner.me(user.id); }

  /** Overview of a month range (default: the last 3 months). */
  @Get('overview')
  overview(@CurrentUser() user: { id: string }, @Query('from') from?: string, @Query('to') to?: string) { return this.partner.overview(user.id, from, to); }

  @Get('movements')
  movements(
    @CurrentUser() user: { id: string }, @Query('from') from?: string, @Query('to') to?: string, @Query('type') type?: string, @Query('status') status?: string,
    @Query('q') q?: string, @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.partner.listMovements(user.id, { from, to, type, status, q, limit: intOr(limit, 50, 1, 200), offset: intOr(offset, 0, 0, 100_000) });
  }

  @Get('movements/:id')
  movement(@CurrentUser() user: { id: string }, @Param('id') id: string) { return this.partner.movementDetail(user.id, id); }

  @Get('statements')
  statements(@CurrentUser() user: { id: string }, @Query('from') from?: string, @Query('to') to?: string) { return this.partner.statements(user.id, from, to); }

  @Get('statements/:period')
  statement(@CurrentUser() user: { id: string }, @Param('period') period: string) { return this.partner.statement(user.id, period); }
}

export class DesignatePartnerDto {
  @IsUUID() accountId!: string;
  @IsString() @MinLength(2) @MaxLength(120) displayName!: string;
}

export class RecordPartnerEntryDto {
  @IsIn(['CAPITAL_RETURN', 'PROFIT_PAYOUT']) kind!: EntryKind;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) amount!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) paidOn!: string;
  /** The profit month a PROFIT_PAYOUT settles (YYYY-MM). */
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period?: string;
  @IsString() @MinLength(2) @MaxLength(80) reference!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsUUID() idempotencyKey!: string;
}

export class VoidPartnerEntryDto {
  @IsString() @MinLength(3) @MaxLength(200) reason!: string;
}

/** Admin side of the capital partner: who the partner is and what was actually paid to them. Admin only. */
@Controller('operations/finance/capital-partner')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class CapitalPartnerAdminController {
  constructor(private readonly partner: CapitalPartnerService) {}

  @Get()
  profile() { return this.partner.adminProfile(); }

  @Put()
  designate(@Body() dto: DesignatePartnerDto, @CurrentUser() user: { id: string }) { return this.partner.designate(dto, user.id); }

  @Post('deactivate')
  deactivate() { return this.partner.deactivate(); }

  @Get('entries')
  entries(@Query('limit') limit?: string) { return this.partner.listEntries(intOr(limit, 100, 1, 300)); }

  @Post('entries')
  record(@Body() dto: RecordPartnerEntryDto, @CurrentUser() user: { id: string }) { return this.partner.recordEntry(dto, user.id); }

  @Post('entries/:id/void')
  void(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidPartnerEntryDto, @CurrentUser() user: { id: string }) { return this.partner.voidEntry(id, dto.reason, user.id); }
}
