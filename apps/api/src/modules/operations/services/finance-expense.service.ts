import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PrismaService } from '../../../platform/database/prisma.service';

export const EXPENSE_CATEGORIES = ['RENT', 'UTILITIES', 'MARKETING', 'PACKAGING', 'DELIVERY', 'SOFTWARE', 'SUPPLIES', 'OTHER'] as const;
export const EXPENSE_RECURRENCES = ['NONE', 'WEEKLY', 'MONTHLY'] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export type ExpenseRecurrence = typeof EXPENSE_RECURRENCES[number];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class CreateExpenseDto {
  @IsIn(EXPENSE_CATEGORIES as unknown as string[])
  category!: ExpenseCategory;

  @IsString() @MinLength(3) @MaxLength(200)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000)
  amount!: number;

  /** The day the cost was incurred (Cairo calendar date, YYYY-MM-DD); the first occurrence when recurring. */
  @Matches(YMD)
  incurredOn!: string;

  @IsOptional() @IsIn(EXPENSE_RECURRENCES as unknown as string[])
  recurrence?: ExpenseRecurrence;

  /** Last day a recurring expense applies; empty means it continues until voided. */
  @IsOptional() @Matches(YMD)
  endsOn?: string;
}

export class VoidExpenseDto {
  @IsString() @MinLength(3) @MaxLength(200)
  reason!: string;
}

const ymd = (date: Date) => date.toISOString().slice(0, 10);
const parse = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return { y, m, d };
};
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function isValidYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const { y, m, d } = parse(value);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/**
 * Every date a (possibly recurring) expense is due inside [from, to], inclusive, as YYYY-MM-DD. A monthly expense keeps its day of the
 * month and falls on the last day of shorter months; a weekly one repeats every seven days from the first date.
 */
export function expenseOccurrences(
  expense: { incurredOn: string; recurrence: ExpenseRecurrence; endsOn?: string | null },
  from: string,
  to: string,
): string[] {
  const last = expense.endsOn && expense.endsOn < to ? expense.endsOn : to;
  if (expense.incurredOn > last) return [];
  if (expense.recurrence === 'NONE') return expense.incurredOn >= from ? [expense.incurredOn] : [];
  const dates: string[] = [];
  const start = parse(expense.incurredOn);
  if (expense.recurrence === 'WEEKLY') {
    const startMs = Date.UTC(start.y, start.m - 1, start.d);
    const f = parse(from);
    const fromMs = Date.UTC(f.y, f.m - 1, f.d);
    const skip = Math.max(0, Math.ceil((fromMs - startMs) / (7 * 86_400_000)));
    for (let ms = startMs + skip * 7 * 86_400_000; ; ms += 7 * 86_400_000) {
      const day = ymd(new Date(ms));
      if (day > last) break;
      if (day >= from) dates.push(day);
    }
    return dates;
  }
  let y = start.y;
  let m = start.m;
  for (let guard = 0; guard < 1200; guard++) {
    const day = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(start.d, daysInMonth(y, m))).padStart(2, '0')}`;
    if (day > last) break;
    if (day >= from) dates.push(day);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return dates;
}

@Injectable()
export class FinanceExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateExpenseDto, actorId: string) {
    const recurrence = dto.recurrence ?? 'NONE';
    if (!isValidYmd(dto.incurredOn)) throw new BadRequestException({ code: 'INVALID_DATE', message: 'incurredOn is not a valid date' });
    if (dto.endsOn !== undefined) {
      if (recurrence === 'NONE') throw new BadRequestException({ code: 'ENDS_ON_REQUIRES_RECURRENCE', message: 'An end date applies only to a recurring expense' });
      if (!isValidYmd(dto.endsOn) || dto.endsOn < dto.incurredOn) throw new BadRequestException({ code: 'INVALID_DATE', message: 'endsOn must be a valid date on or after the first date' });
    }
    const expense = await this.prisma.financeExpense.create({
      data: {
        category: dto.category, description: dto.description.trim(), amount: new Prisma.Decimal(dto.amount.toFixed(2)),
        incurredOn: new Date(`${dto.incurredOn}T00:00:00Z`), recurrence, endsOn: dto.endsOn ? new Date(`${dto.endsOn}T00:00:00Z`) : null,
        recordedBy: actorId,
      },
    });
    return this.present(expense);
  }

  async void(id: string, reason: string, actorId: string) {
    const expense = await this.prisma.financeExpense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');
    if (expense.voidedAt) throw new BadRequestException({ code: 'EXPENSE_ALREADY_VOID', message: 'This expense is already voided' });
    const updated = await this.prisma.financeExpense.update({ where: { id }, data: { voidedAt: new Date(), voidedBy: actorId, voidReason: reason.trim() } });
    return this.present(updated);
  }

  async list(filter: { category?: string; includeVoided?: boolean; take?: number } = {}) {
    const rows = await this.prisma.financeExpense.findMany({
      where: { ...(filter.category ? { category: filter.category } : {}), ...(filter.includeVoided ? {} : { voidedAt: null }) },
      orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(filter.take ?? 100, 300),
    });
    return rows.map(row => this.present(row));
  }

  /** Every due occurrence of every active expense inside [from, to], expanded for reporting. */
  async occurrencesBetween(from: string, to: string) {
    const rows = await this.prisma.financeExpense.findMany({
      where: {
        voidedAt: null,
        incurredOn: { lte: new Date(`${to}T00:00:00Z`) },
        OR: [{ recurrence: 'NONE', incurredOn: { gte: new Date(`${from}T00:00:00Z`) } }, { recurrence: { not: 'NONE' }, OR: [{ endsOn: null }, { endsOn: { gte: new Date(`${from}T00:00:00Z`) } }] }],
      },
    });
    return rows.flatMap(row => expenseOccurrences(
      { incurredOn: ymd(row.incurredOn), recurrence: row.recurrence as ExpenseRecurrence, endsOn: row.endsOn ? ymd(row.endsOn) : null }, from, to,
    ).map(date => ({ expenseId: row.id, category: row.category as ExpenseCategory, description: row.description, date, amount: Number(row.amount) })));
  }

  private present(row: { id: string; category: string; description: string; amount: Prisma.Decimal; currency: string; incurredOn: Date; recurrence: string; endsOn: Date | null; recordedBy: string; voidedAt: Date | null; voidReason: string | null; createdAt: Date }) {
    return {
      id: row.id, category: row.category, description: row.description, amount: Number(row.amount), currency: row.currency,
      incurredOn: ymd(row.incurredOn), recurrence: row.recurrence, endsOn: row.endsOn ? ymd(row.endsOn) : null,
      recordedBy: row.recordedBy, voided: !!row.voidedAt, voidReason: row.voidReason, createdAt: row.createdAt.toISOString(),
    };
  }
}
