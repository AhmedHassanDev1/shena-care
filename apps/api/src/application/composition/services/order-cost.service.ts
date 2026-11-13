import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SETTING_KEYS } from '../../../platform/settings/runtime-settings';
import { SettingsService } from '../../../modules/operations/settings/settings.service';

export const PACKAGING_TYPES = ['BAG', 'BOX'] as const;
export type PackagingType = (typeof PACKAGING_TYPES)[number];

export class RecordOrderCostDto {
  /** What the courier actually cost for this order, in EGP. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  courierCost?: number;

  /** The packaging actually used; its cost is the configured cost of that type at this moment, frozen on the order. */
  @IsOptional()
  @IsIn(PACKAGING_TYPES)
  packagingType?: PackagingType;

  /** Required (and Admin only) to overwrite a value that was already recorded. */
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason?: string;
}

/** Statuses from which an order has left the Hub with its goods: its courier cost is expected. */
const COURIER_EXPECTED = ['shipped', 'delivered'] as const;
const OPEN_FOR_COST = ['packing', 'shipped', 'delivered'] as const;
const LOOKBACK_DAYS = 90;

/**
 * Actual per-order delivery and packaging cost. Both are recorded as snapshots, so changing a setting later never rewrites history,
 * and a recorded value can only be replaced by an Admin with a reason that stays in the record.
 */
@Injectable()
export class OrderCostService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  private packagingCostOf(type: PackagingType): number {
    const value = this.settings.effective<number | null>(type === 'BAG' ? SETTING_KEYS.bagCost : SETTING_KEYS.boxCost);
    if (value === null || value === undefined) {
      throw new ConflictException({ code: 'PACKAGING_COST_NOT_CONFIGURED', message: `Set the ${type === 'BAG' ? 'bag' : 'box'} cost in Admin Settings before recording it on an order` });
    }
    return value;
  }

  private present(row: { orderId: string; courierCost: Prisma.Decimal | null; courierRecordedAt: Date | null; packagingType: string | null; packagingCost: Prisma.Decimal | null; packagingRecordedAt: Date | null } | null) {
    return {
      courierCost: row?.courierCost?.toFixed(2) ?? null, courierRecordedAt: row?.courierRecordedAt ?? null,
      packagingType: (row?.packagingType as PackagingType | null) ?? null, packagingCost: row?.packagingCost?.toFixed(2) ?? null, packagingRecordedAt: row?.packagingRecordedAt ?? null,
    };
  }

  async record(orderId: string, dto: RecordOrderCostDto, actor: { id: string; roles: string[] }) {
    if (dto.courierCost === undefined && dto.packagingType === undefined) throw new BadRequestException('Record a courier cost, a packaging type, or both');
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!order) throw new NotFoundException('Order not found');
    const isAdmin = actor.roles.includes('ADMIN');
    const packagingCost = dto.packagingType ? new Prisma.Decimal(this.packagingCostOf(dto.packagingType)) : undefined;

    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44100, hashtext(${orderId}))::text AS locked`;
      const existing = await tx.orderCostRecord.findUnique({ where: { orderId } });
      const now = new Date();
      const data: Prisma.OrderCostRecordUncheckedUpdateInput = {};
      const changes: Array<Record<string, unknown>> = [];

      if (dto.courierCost !== undefined) {
        const next = new Prisma.Decimal(dto.courierCost);
        if (existing?.courierCost && !existing.courierCost.equals(next)) {
          this.assertCanOverwrite('courier cost', isAdmin, dto.reason);
          changes.push({ field: 'courierCost', previous: existing.courierCost.toFixed(2), next: next.toFixed(2) });
        }
        if (!existing?.courierCost || !existing.courierCost.equals(next)) {
          data.courierCost = next; data.courierRecordedBy = actor.id; data.courierRecordedAt = now;
        }
      }
      if (dto.packagingType && packagingCost) {
        const same = existing?.packagingType === dto.packagingType && existing.packagingCost?.equals(packagingCost);
        if (existing?.packagingType && !same) {
          this.assertCanOverwrite('packaging', isAdmin, dto.reason);
          changes.push({ field: 'packaging', previous: { type: existing.packagingType, cost: existing.packagingCost?.toFixed(2) ?? null }, next: { type: dto.packagingType, cost: packagingCost.toFixed(2) } });
        }
        if (!existing?.packagingType || !same) {
          data.packagingType = dto.packagingType; data.packagingCost = packagingCost; data.packagingRecordedBy = actor.id; data.packagingRecordedAt = now;
        }
      }
      if (changes.length) {
        const log = Array.isArray(existing?.corrections) ? existing!.corrections : [];
        data.corrections = [...log, { at: now.toISOString(), by: actor.id, reason: dto.reason!.trim(), changes }] as Prisma.InputJsonValue;
      }
      if (!Object.keys(data).length) return { replayed: true, ...this.present(existing) };
      const saved = existing
        ? await tx.orderCostRecord.update({ where: { orderId }, data })
        : await tx.orderCostRecord.create({ data: { ...(data as Omit<Prisma.OrderCostRecordUncheckedCreateInput, 'orderId'>), orderId } });
      return { replayed: false, ...this.present(saved) };
    });
  }

  private assertCanOverwrite(label: string, isAdmin: boolean, reason?: string) {
    if (!isAdmin) throw new ConflictException({ code: 'COST_ALREADY_RECORDED', message: `The ${label} of this order is already recorded; only an Admin can correct it` });
    if (!reason || reason.trim().length < 5) throw new BadRequestException({ code: 'CORRECTION_REASON_REQUIRED', message: `A reason is required to correct the recorded ${label}` });
  }

  /** The Hub queue: orders that left packing but still lack an actual courier cost or packaging type. */
  async pending(take = 100) {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const orders = await this.prisma.order.findMany({
      where: { status: { in: [...OPEN_FOR_COST] }, createdAt: { gte: since } },
      select: { id: true, orderNumber: true, status: true, shippingFee: true, createdAt: true, customerName: true },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    const records = await this.prisma.orderCostRecord.findMany({ where: { orderId: { in: orders.map(order => order.id) } } });
    const byOrder = new Map(records.map(record => [record.orderId, record]));
    const suggestedCourierCost = this.settings.effective<number | null>(SETTING_KEYS.deliveryInternalCost);
    const rows = orders.map(order => {
      const record = byOrder.get(order.id) ?? null;
      const missing: Array<'courier' | 'packaging'> = [];
      if ((COURIER_EXPECTED as readonly string[]).includes(order.status) && !record?.courierCost) missing.push('courier');
      if (!record?.packagingType) missing.push('packaging');
      return { orderId: order.id, orderNumber: order.orderNumber, status: order.status, customerName: order.customerName, customerDeliveryFee: order.shippingFee.toFixed(2), missing, ...this.present(record) };
    }).filter(row => row.missing.length);
    return {
      total: rows.length, items: rows.slice(0, take), suggestedCourierCost,
      packagingCosts: { BAG: this.settings.effective<number | null>(SETTING_KEYS.bagCost), BOX: this.settings.effective<number | null>(SETTING_KEYS.boxCost) },
    };
  }

  async forOrder(orderId: string) {
    return this.present(await this.prisma.orderCostRecord.findUnique({ where: { orderId } }));
  }
}
