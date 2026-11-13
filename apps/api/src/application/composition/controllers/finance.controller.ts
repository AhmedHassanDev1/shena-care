import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { CreateExpenseDto, FinanceExpenseService, VoidExpenseDto } from '../../../modules/operations/services/finance-expense.service';
import { FinanceReportService, TRANSACTION_TYPES, TransactionType } from '../services/finance-report.service';
import { currentPeriod, ProfitService } from '../services/profit.service';

const intOr = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException(`Expected a whole number between ${min} and ${max}`);
  return parsed;
};

/** Finance workspace API. Admin only: reads and writes alike are authorised here, not by hiding the page. */
@Controller('operations/finance')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class FinanceController {
  constructor(private readonly reports: FinanceReportService, private readonly expenses: FinanceExpenseService, private readonly profit: ProfitService) {}

  /** Monthly profit and profit share. `month` is YYYY-MM (default: the current month). A closed month returns its frozen figures. */
  @Get('profit')
  profitFor(@Query('month') month?: string) {
    return this.profit.month(month ?? currentPeriod());
  }

  @Get('profit/trend')
  profitTrend(@Query('months') months?: string) {
    return this.profit.trend(intOr(months, 6, 1, 12));
  }

  /** Freezes a finished, fully costed month with the percentage in force. Records numbers only; no funds move. */
  @Post('profit/:month/close')
  closeMonth(@Param('month') month: string, @CurrentUser() user: { id: string }) {
    return this.profit.close(month, user.id);
  }

  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.summary(this.reports.range(from, to));
  }

  @Get('series')
  series(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.series(this.reports.range(from, to));
  }

  @Get('orders')
  orders(@Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.reports.orders(this.reports.range(from, to), { limit: intOr(limit, 25, 1, 100), offset: intOr(offset, 0, 0, 100_000) });
  }

  @Get('transactions')
  transactions(@Query('from') from?: string, @Query('to') to?: string, @Query('type') type?: string, @Query('limit') limit?: string) {
    if (type && !TRANSACTION_TYPES.includes(type as TransactionType)) throw new BadRequestException(`type must be one of ${TRANSACTION_TYPES.join(', ')}`);
    return this.reports.transactions(this.reports.range(from, to), { type: type as TransactionType | undefined, limit: intOr(limit, 100, 1, 300) });
  }

  @Get('expenses')
  listExpenses(@Query('category') category?: string, @Query('includeVoided') includeVoided?: string) {
    return this.expenses.list({ category, includeVoided: includeVoided === 'true' });
  }

  @Post('expenses')
  createExpense(@Body() dto: CreateExpenseDto, @CurrentUser() user: { id: string }) {
    return this.expenses.create(dto, user.id);
  }

  @Post('expenses/:id/void')
  voidExpense(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidExpenseDto, @CurrentUser() user: { id: string }) {
    return this.expenses.void(id, dto.reason, user.id);
  }
}
