import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, RoutineActivation, RoutineLifecycle, RoutinePurchasePhase, RoutineTier, UsageRoutinePeriod } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../../catalog/public';
import { areaSlot, buildProposal, crossRoutineConflicts, Tier } from '../engine/routine-engine';
import { readSafety, RoutineEngineService, UNKNOWN_SAFETY } from './routine-engine.service';

type RoutineWithItems = Prisma.CustomerRoutineGetPayload<{ include: { items: true; careProfile: true } }>;

export interface ActivationResult {
  activated: boolean;
  blockedBy?: { code: 'AREA_LIMIT'; otherRoutineId: string }
    | { code: 'CONFLICT'; conflicts: ReturnType<typeof crossRoutineConflicts> }
    | { code: 'LIFECYCLE'; lifecycle: RoutineLifecycle };
  /** Steps another active routine already covers: take them instead of buying again (§5.6). */
  reuseSuggestions: Array<{ roleKey: string; fromRoutineId: string; productId: string }>;
}

/** Saved routines of a customer: activation, lifecycle, item swaps with versions, and what is left to buy. */
@Injectable()
export class MyRoutinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: RoutineEngineService,
    private readonly catalog: CatalogService,
  ) {}

  async listRoutines(customerId: string) {
    const profile = await this.prisma.customerCareProfile.findUnique({ where: { customerId }, select: { id: true } });
    if (!profile) return [];
    const routines = await this.prisma.customerRoutine.findMany({
      where: { careProfileId: profile.id },
      include: { items: { where: { removedAtVersion: null }, orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ activation: 'asc' }, { updatedAt: 'desc' }],
    });
    return routines.map(r => this.present(r, new Map()));
  }

  async getRoutine(routineId: string, customerId: string) {
    const routine = await this.load(routineId, customerId);
    const facts = new Map((await this.catalog.getRoutineProductFacts(
      routine.items.map(i => i.productId).filter((id): id is string => !!id))).map(f => [f.productId, f]));
    return this.present(routine, facts);
  }

  /** Activates when the care-area slot is free and no active ingredient collides; otherwise reports why. */
  async tryActivate(routineId: string, customerId: string, shareRoleKeys: string[]): Promise<ActivationResult> {
    let routine = await this.load(routineId, customerId);
    if (routine.lifecycle === RoutineLifecycle.COMPLETED || routine.lifecycle === RoutineLifecycle.STOPPED) {
      return { activated: false, blockedBy: { code: 'LIFECYCLE', lifecycle: routine.lifecycle }, reuseSuggestions: [] };
    }

    const others = await this.prisma.customerRoutine.findMany({
      where: { careProfileId: routine.careProfileId, activation: RoutineActivation.ACTIVE, id: { not: routine.id } },
      include: { items: { where: { removedAtVersion: null } } },
    });
    const slot = areaSlot(routine.careArea, routine.kind);
    const taken = others.find(o => areaSlot(o.careArea, o.kind) === slot);
    if (taken) return { activated: false, blockedBy: { code: 'AREA_LIMIT', otherRoutineId: taken.id }, reuseSuggestions: [] };

    const sameArea = others.filter(o => o.careArea === routine.careArea);
    const reusable = (r: RoutineWithItems) => r.items
      .filter(i => !i.isOwned && !i.sharedWithRoutineId)
      .flatMap(i => {
        const source = sameArea.flatMap(o => o.items.map(oi => ({ routineId: o.id, item: oi })))
          .find(x => x.item.roleKey === i.roleKey && x.item.productId);
        return source ? [{ roleKey: i.roleKey, fromRoutineId: source.routineId, productId: source.item.productId! }] : [];
      });

    const toShare = reusable(routine).filter(s => shareRoleKeys.includes(s.roleKey));
    if (toShare.length) {
      await this.newVersion(routine, routine.version, async (tx, version) => {
        for (const share of toShare) {
          const old = routine.items.find(i => i.roleKey === share.roleKey)!;
          await tx.customerRoutineItem.update({ where: { id: old.id }, data: { removedAtVersion: version } });
          await tx.customerRoutineItem.create({ data: {
            routineId: routine.id, roleKey: old.roleKey, sortOrder: old.sortOrder, isEssential: old.isEssential,
            productId: share.productId, skuId: null, tier: old.tier, isOwned: false, sharedWithRoutineId: share.fromRoutineId,
            purchasePhase: old.purchasePhase, startWeek: old.startWeek, reasonCodes: ['SHARED_WITH_ACTIVE_ROUTINE'], addedAtVersion: version,
          } });
        }
        return { change: 'SHARED_ROLES', roles: toShare.map(s => s.roleKey) };
      });
      routine = await this.load(routineId, customerId);
    }

    const activeProducts = await this.engine.activeRoutineProducts(routine.careProfileId, routine.id);
    const mine = await this.itemSubjects(routine.items.filter(i => !i.sharedWithRoutineId));
    const conflicts = crossRoutineConflicts(routine.careArea, mine, activeProducts, await this.engine.activeRules());
    if (conflicts.length) return { activated: false, blockedBy: { code: 'CONFLICT', conflicts }, reuseSuggestions: reusable(routine) };

    await this.prisma.customerRoutine.update({
      where: { id: routine.id }, data: { activation: RoutineActivation.ACTIVE, statusReason: null },
    });
    return { activated: true, reuseSuggestions: reusable(routine) };
  }

  async activate(routineId: string, customerId: string, shareRoleKeys: string[]) {
    const result = await this.tryActivate(routineId, customerId, shareRoleKeys);
    if (!result.activated) throw new ConflictException({ code: 'ACTIVATION_BLOCKED', ...result });
    return { ...(await this.getRoutine(routineId, customerId)), activationResult: result };
  }

  /** «استلمت وبدأت»: starts follow-up timing from today (§5.10). */
  async start(routineId: string, customerId: string) {
    const routine = await this.load(routineId, customerId);
    if (routine.activation !== RoutineActivation.ACTIVE) throw new ConflictException({ code: 'NOT_ACTIVE', message: 'Activate the routine first.' });
    if (routine.lifecycle === RoutineLifecycle.NOT_STARTED) {
      await this.prisma.customerRoutine.update({ where: { id: routine.id }, data: { lifecycle: RoutineLifecycle.IN_PROGRESS, startedAt: new Date() } });
    } else if (routine.lifecycle !== RoutineLifecycle.IN_PROGRESS) {
      throw new ConflictException({ code: 'LIFECYCLE', lifecycle: routine.lifecycle });
    }
    return this.getRoutine(routineId, customerId);
  }

  async changeStatus(routineId: string, customerId: string, action: 'DEACTIVATE' | 'STOP' | 'COMPLETE', reason?: string) {
    const routine = await this.load(routineId, customerId);
    const now = new Date();
    if (action === 'DEACTIVATE') {
      // Paused when in progress: the follow-up clock waits until it is active again.
      await this.prisma.customerRoutine.update({ where: { id: routine.id }, data: { activation: RoutineActivation.INACTIVE, statusReason: reason ?? 'CUSTOMER' } });
    } else if (action === 'STOP') {
      if (routine.lifecycle === RoutineLifecycle.COMPLETED) throw new ConflictException({ code: 'LIFECYCLE', lifecycle: routine.lifecycle });
      await this.prisma.customerRoutine.update({ where: { id: routine.id }, data: {
        activation: RoutineActivation.INACTIVE, lifecycle: RoutineLifecycle.STOPPED, stoppedAt: now, statusReason: reason ?? 'CUSTOMER' } });
    } else {
      if (routine.lifecycle !== RoutineLifecycle.IN_PROGRESS) throw new ConflictException({ code: 'LIFECYCLE', lifecycle: routine.lifecycle });
      await this.prisma.customerRoutine.update({ where: { id: routine.id }, data: {
        activation: RoutineActivation.INACTIVE, lifecycle: RoutineLifecycle.COMPLETED, completedAt: now, statusReason: 'COMPLETED' } });
    }
    const detail = await this.getRoutine(routineId, customerId);
    // Maintenance is a new routine the customer chooses to start (§5.6), never a silent change.
    return action === 'COMPLETE' ? { ...detail, nextStep: 'MAINTENANCE_SUGGESTED' } : detail;
  }

  /** Swaps one step for another product the engine accepts for this customer, as a new version. */
  async swapItem(routineId: string, customerId: string, roleKey: string, productId: string, expectedVersion: number) {
    const routine = await this.load(routineId, customerId);
    if (routine.version !== expectedVersion) throw new ConflictException({ code: 'ROUTINE_VERSION_CONFLICT', message: 'The routine changed; reload it.' });
    const current = routine.items.find(i => i.roleKey === roleKey);
    if (!current) throw new NotFoundException('No such step in this routine');

    const blueprint = await this.engine.blueprintById(routine.blueprintId);
    if (!blueprint) throw new UnprocessableEntityException({ code: 'BLUEPRINT_GONE', message: 'This routine can no longer be edited.' });
    const latest = await this.prisma.customerRoutineVersion.findFirst({ where: { routineId }, orderBy: { version: 'desc' } });
    const answers = ((latest?.snapshot as { answers?: { severity?: number | null; skinType?: string | null } } | null)?.answers ?? {});
    const flags = await this.prisma.careSafetyFlags.findUnique({ where: { careProfileId: routine.careProfileId } });
    const [{ candidates, facts }, rules, activeProducts] = await Promise.all([
      this.engine.candidatesFor(blueprint), this.engine.activeRules(), this.engine.activeRoutineProducts(routine.careProfileId, routine.id),
    ]);
    const proposal = buildProposal(blueprint, candidates, rules, {
      severity: answers.severity ?? null, skinType: answers.skinType ?? routine.careProfile.skinType ?? null,
      ageBand: routine.careProfile.ageBand ?? null, experienceLevel: routine.careProfile.experienceLevel ?? null,
      fragranceFree: routine.careProfile.fragranceFree ?? null,
      safety: flags ? readSafety(flags) : UNKNOWN_SAFETY, allergyIngredientIds: flags?.allergyIngredientIds ?? [],
      tier: (routine.tier as Tier | null) ?? null, budget: routine.budget === null ? null : Number(routine.budget),
      ownedRoleKeys: [], overrides: { swaps: { [roleKey]: productId }, removed: [], upgrades: [] },
      activeRoutineProducts: activeProducts, now: new Date(),
    });
    const chosen = proposal.items.find(i => i.roleKey === roleKey);
    if (chosen?.status !== 'SELECTED' || chosen.product?.productId !== productId) {
      throw new UnprocessableEntityException({ code: 'NOT_ELIGIBLE', message: 'That product does not fit this step for you.' });
    }

    await this.newVersion(routine, expectedVersion, async (tx, version) => {
      await tx.customerRoutineItem.update({ where: { id: current.id }, data: { removedAtVersion: version } });
      await tx.customerRoutineItem.create({ data: {
        routineId: routine.id, roleKey, sortOrder: current.sortOrder, isEssential: current.isEssential,
        productId, skuId: chosen.product!.skuId, tier: chosen.product!.tier as RoutineTier, isOwned: false,
        purchasePhase: current.purchasePhase, startWeek: current.startWeek, reasonCodes: chosen.reasonCodes, addedAtVersion: version,
      } });
      const f = facts.get(productId);
      return { change: 'SWAP_ITEM', roleKey, from: current.productId, to: productId,
        facts: f ? { actives: f.actives, usageRules: f.usageRules.filter(r => r.skuId === null || r.skuId === chosen.product!.skuId) } : null };
    });
    return this.getRoutine(routineId, customerId);
  }

  /** Steps still to buy: not owned, not covered by another routine, optionally this week's only. */
  async purchasableItems(routineId: string, customerId: string, phase: 'IMMEDIATE' | 'ALL') {
    const routine = await this.load(routineId, customerId);
    return routine.items
      .filter(i => !i.isOwned && !i.sharedWithRoutineId && i.skuId && i.productId)
      .filter(i => phase === 'ALL' || i.purchasePhase === RoutinePurchasePhase.IMMEDIATE)
      .map(i => ({ roleKey: i.roleKey, productId: i.productId!, skuId: i.skuId! }));
  }

  private async load(routineId: string, customerId: string): Promise<RoutineWithItems> {
    const routine = await this.prisma.customerRoutine.findUnique({
      where: { id: routineId },
      include: { items: { where: { removedAtVersion: null }, orderBy: { sortOrder: 'asc' } }, careProfile: true },
    });
    if (!routine) throw new NotFoundException('Routine not found');
    if (routine.careProfile.customerId !== customerId) throw new ForbiddenException('Not your routine');
    return routine;
  }

  /** Bumps the routine version under OCC and records a snapshot of the change and the resulting items. */
  private async newVersion(
    routine: RoutineWithItems, expectedVersion: number,
    apply: (tx: Prisma.TransactionClient, version: number) => Promise<Record<string, unknown>>,
  ) {
    const version = expectedVersion + 1;
    await this.prisma.$transaction(async tx => {
      const bumped = await tx.customerRoutine.updateMany({ where: { id: routine.id, version: expectedVersion }, data: { version } });
      if (bumped.count === 0) throw new ConflictException({ code: 'ROUTINE_VERSION_CONFLICT', message: 'The routine changed; reload it.' });
      const change = await apply(tx, version);
      const items = await tx.customerRoutineItem.findMany({ where: { routineId: routine.id, removedAtVersion: null }, orderBy: { sortOrder: 'asc' } });
      await tx.customerRoutineVersion.create({ data: {
        routineId: routine.id, version,
        snapshot: { change, items: items.map(i => ({ roleKey: i.roleKey, productId: i.productId, skuId: i.skuId, isOwned: i.isOwned,
          sharedWithRoutineId: i.sharedWithRoutineId, purchasePhase: i.purchasePhase, startWeek: i.startWeek, reasonCodes: i.reasonCodes })) } as Prisma.InputJsonValue,
      } });
    });
  }

  private async itemSubjects(items: Array<{ roleKey: string; productId: string | null }>) {
    const facts = new Map((await this.catalog.getRoutineProductFacts(items.map(i => i.productId).filter((id): id is string => !!id)))
      .map(f => [f.productId, f]));
    return items.filter(i => i.productId).map(i => {
      const f = facts.get(i.productId!);
      return { roleKey: i.roleKey, subjects: f ? [...new Set([...f.ingredientSlugs, ...f.ingredientFamilies])] : [] };
    });
  }

  /** Personalized weekly schedule entries for a customer's routine (GLO-284 §5). */
  async getSchedules(routineId: string, customerId: string) {
    const routine = await this.load(routineId, customerId);
    return this.prisma.customerUsageSchedule.findMany({
      where: { customerRoutineId: routine.id },
      orderBy: [{ phase: 'asc' }, { timingSlot: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Set or update a product's personal usage schedule in the customer's routine (GLO-284 §5). */
  async setSchedule(
    routineId: string,
    customerId: string,
    input: {
      routineItemId: string;
      productId: string;
      weekdays?: number[];
      timingSlot?: UsageRoutinePeriod;
      plannedUsesPerOccurrence?: number;
      phase?: number;
      startDate: Date;
      endDate?: Date | null;
      sourceUsageRuleId?: string | null;
      notes?: string | null;
      isConfirmed?: boolean;
    },
  ) {
    const routine = await this.load(routineId, customerId);
    const item = routine.items.find(i => i.id === input.routineItemId && i.productId === input.productId);
    if (!item) throw new BadRequestException('Routine item does not match product or routine');

    // 1. Weekday validation (1=Mon .. 7=Sun)
    if (input.weekdays?.length) {
      for (const day of input.weekdays) {
        if (!Number.isInteger(day) || day < 1 || day > 7) {
          throw new BadRequestException(`Invalid weekday '${day}'. Must be an integer between 1 and 7.`);
        }
      }
    }
    const cleanWeekdays = input.weekdays ? [...new Set(input.weekdays)].sort((a, b) => a - b) : [];

    // 2. Phase sequencing validation
    const phase = input.phase ?? 1;
    if (!Number.isInteger(phase) || phase < 1) {
      throw new BadRequestException('Schedule phase must be an integer >= 1');
    }

    // 3. Planned uses per occurrence validation
    const plannedUses = input.plannedUsesPerOccurrence ?? 1;
    if (!Number.isInteger(plannedUses) || plannedUses < 1) {
      throw new BadRequestException('Planned uses per occurrence must be an integer >= 1');
    }

    // 4. Usage rule consistency check
    const timingSlot = input.timingSlot ?? 'BOTH';
    if (input.sourceUsageRuleId) {
      const rule = await this.prisma.productUsageRule.findUnique({
        where: { id: input.sourceUsageRuleId },
      });
      if (!rule || rule.productId !== input.productId) {
        throw new BadRequestException('Source usage rule does not exist or does not match this product');
      }
      if (rule.routinePeriod === 'AM' && timingSlot !== 'AM') {
        throw new BadRequestException('Schedule timing slot is incompatible with approved AM-only usage rule');
      }
      if (rule.routinePeriod === 'PM' && timingSlot !== 'PM') {
        throw new BadRequestException('Schedule timing slot is incompatible with approved PM-only usage rule');
      }
      if (rule.frequencyUnit === 'WEEK' && rule.usesMax !== null && cleanWeekdays.length > rule.usesMax) {
        throw new BadRequestException(
          `Scheduled days (${cleanWeekdays.length}) exceed maximum approved weekly frequency (${rule.usesMax})`,
        );
      }
    } else {
      const productRules = await this.prisma.productUsageRule.findMany({
        where: { productId: input.productId },
      });
      const pmOnlyRule = productRules.find(r => r.routinePeriod === 'PM');
      const amOnlyRule = productRules.find(r => r.routinePeriod === 'AM');
      if (pmOnlyRule && !amOnlyRule && timingSlot !== 'PM') {
        throw new BadRequestException('Schedule timing slot is incompatible with product approved PM-only usage directions');
      }
      if (amOnlyRule && !pmOnlyRule && timingSlot !== 'AM') {
        throw new BadRequestException('Schedule timing slot is incompatible with product approved AM-only usage directions');
      }
    }

    // 5. Upsert to prevent duplicate conflicting schedule records for same (routine, item, timingSlot, phase)
    return this.prisma.customerUsageSchedule.upsert({
      where: {
        customerRoutineId_routineItemId_timingSlot_phase: {
          customerRoutineId: routine.id,
          routineItemId: input.routineItemId,
          timingSlot,
          phase,
        },
      },
      create: {
        customerRoutineId: routine.id,
        routineItemId: input.routineItemId,
        productId: input.productId,
        weekdays: cleanWeekdays,
        timingSlot,
        plannedUsesPerOccurrence: plannedUses,
        phase,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        sourceUsageRuleId: input.sourceUsageRuleId ?? null,
        notes: input.notes ?? null,
        isConfirmed: input.isConfirmed ?? false,
        routineVersion: routine.version,
      },
      update: {
        productId: input.productId,
        weekdays: cleanWeekdays,
        plannedUsesPerOccurrence: plannedUses,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        sourceUsageRuleId: input.sourceUsageRuleId ?? null,
        notes: input.notes ?? null,
        isConfirmed: input.isConfirmed ?? false,
        routineVersion: routine.version,
      },
    });
  }

  private present(r: Prisma.CustomerRoutineGetPayload<{ include: { items: true } }>, facts: Map<string, { name: string; brandName: string; imageUrl: string | null }>) {
    return {
      id: r.id, titleAr: r.titleAr, concernSlug: r.concernSlug, careArea: r.careArea, kind: r.kind, tier: r.tier,
      activation: r.activation, lifecycle: r.lifecycle, statusReason: r.statusReason, version: r.version,
      startedAt: r.startedAt, completedAt: r.completedAt, stoppedAt: r.stoppedAt, createdAt: r.createdAt,
      items: r.items.map(i => {
        const f = i.productId ? facts.get(i.productId) : undefined;
        return {
          roleKey: i.roleKey, sortOrder: i.sortOrder, isEssential: i.isEssential, productId: i.productId, skuId: i.skuId, tier: i.tier,
          isOwned: i.isOwned, sharedWithRoutineId: i.sharedWithRoutineId, purchasePhase: i.purchasePhase, startWeek: i.startWeek,
          reasonCodes: i.reasonCodes, product: f ? { name: f.name, brandName: f.brandName, imageUrl: f.imageUrl } : null,
        };
      }),
    };
  }
}

