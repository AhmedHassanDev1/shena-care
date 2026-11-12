import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { clearRuntimeSetting, replaceRuntimeSettings, runtimeSetting, SETTING_KEYS, setRuntimeSetting } from '../../../platform/settings/runtime-settings';
import { SETTING_BY_KEY, SETTING_DEFINITIONS, SettingDefinition } from './setting-definitions';

const REFRESH_MS = 30_000;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface SettingView {
  key: string;
  group: SettingDefinition['group'];
  kind: SettingDefinition['kind'];
  options?: readonly string[];
  min?: number;
  max?: number;
  nullable: boolean;
  /** The value in force right now. */
  value: unknown;
  /** The deployment default that applies when the override is removed. */
  defaultValue: unknown;
  /** ADMIN = saved in Settings; DEFAULT = environment variable or built-in value. */
  source: 'ADMIN' | 'DEFAULT';
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Server-persisted operational settings. A row in `operations.app_settings` overrides the deployment default for its key; the value is
 * validated by the registry, written with an audit row, and published to the in-process runtime store the business code reads, so a change
 * takes effect without a redeploy. Other instances pick it up on the next refresh (at most 30 seconds).
 */
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => { void this.refresh(); }, REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Reloads the overrides; on a database failure the values already in force are kept. */
  async refresh(): Promise<void> {
    try {
      const rows = await this.prisma.appSetting.findMany();
      replaceRuntimeSettings(rows.filter(row => SETTING_BY_KEY.has(row.key)).map(row => [row.key, row.value] as [string, unknown]));
    } catch (error) {
      this.logger.warn(`Settings refresh failed, keeping current values: ${(error as Error).message}`);
    }
  }

  /** The value in force for a key (override, else deployment default). */
  effective<T>(key: string): T {
    const definition = SETTING_BY_KEY.get(key);
    if (!definition) throw new NotFoundException(`Unknown setting ${key}`);
    const override = runtimeSetting<T>(key);
    return (override !== undefined ? override : definition.fallback()) as T;
  }

  async list(): Promise<SettingView[]> {
    const rows = await this.prisma.appSetting.findMany();
    const byKey = new Map(rows.map(row => [row.key, row]));
    return SETTING_DEFINITIONS.map(definition => {
      const row = byKey.get(definition.key);
      return {
        key: definition.key, group: definition.group, kind: definition.kind, options: definition.options,
        min: definition.min, max: definition.max, nullable: !!definition.nullable,
        value: row ? row.value : definition.fallback(), defaultValue: definition.fallback(),
        source: row ? 'ADMIN' : 'DEFAULT',
        updatedAt: row ? row.updatedAt.toISOString() : null, updatedBy: row ? row.updatedBy : null,
      };
    });
  }

  /** Applies a batch atomically: every value is validated first, and nothing is stored if any is invalid. */
  async update(changes: Record<string, unknown>, actorId: string): Promise<SettingView[]> {
    const entries = Object.entries(changes ?? {});
    if (!entries.length) throw new BadRequestException({ code: 'NO_SETTING_CHANGES', message: 'Send at least one setting to change.' });
    const parsed = new Map<string, unknown>();
    for (const [key, input] of entries) {
      const definition = SETTING_BY_KEY.get(key);
      if (!definition) throw new BadRequestException({ code: 'UNKNOWN_SETTING', key, message: `${key} is not a configurable setting` });
      if (input === null && !definition.nullable) throw new BadRequestException({ code: 'INVALID_SETTING', key, message: `${key} cannot be empty` });
      parsed.set(key, definition.parse(input));
    }
    this.assertChannelsConsistent(parsed);

    const applied: Array<[string, unknown]> = [];
    await this.prisma.$transaction(async tx => {
      for (const [key, value] of parsed) {
        const definition = SETTING_BY_KEY.get(key)!;
        const row = await tx.appSetting.findUnique({ where: { key } });
        const current = row ? row.value : definition.fallback();
        if (same(current, value)) continue;
        const json = value as Prisma.InputJsonValue;
        await tx.appSetting.upsert({
          where: { key },
          create: { key, value: json, updatedBy: actorId },
          update: { value: json, updatedBy: actorId, version: { increment: 1 } },
        });
        await tx.appSettingChange.create({ data: { key, previous: (current ?? Prisma.JsonNull) as Prisma.InputJsonValue, current: json, actorId } });
        applied.push([key, value]);
      }
    });
    for (const [key, value] of applied) setRuntimeSetting(key, value);
    return this.list();
  }

  /** Removes the Admin override so the deployment default applies again. */
  async reset(key: string, actorId: string): Promise<SettingView[]> {
    const definition = SETTING_BY_KEY.get(key);
    if (!definition) throw new NotFoundException(`Unknown setting ${key}`);
    await this.prisma.$transaction(async tx => {
      const row = await tx.appSetting.findUnique({ where: { key } });
      if (!row) return;
      await tx.appSetting.delete({ where: { key } });
      await tx.appSettingChange.create({ data: { key, previous: row.value as Prisma.InputJsonValue, current: Prisma.JsonNull, actorId } });
    });
    clearRuntimeSetting(key);
    return this.list();
  }

  async history(limit = 30) {
    const rows = await this.prisma.appSettingChange.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) });
    const actors = await this.prisma.customer.findMany({ where: { id: { in: [...new Set(rows.map(row => row.actorId))] } }, select: { id: true, name: true } });
    const names = new Map(actors.map(actor => [actor.id, actor.name]));
    return rows.map(row => ({
      id: row.id, key: row.key, previous: row.previous, current: row.current,
      actorId: row.actorId, actorName: names.get(row.actorId) ?? null, createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Contact channels the storefront may show: a channel is exposed only when it is switched on and has its number or link. */
  publicBusinessInfo() {
    const phone = this.effective<string | null>(SETTING_KEYS.businessPhone);
    const whatsapp = this.effective<string | null>(SETTING_KEYS.whatsappNumber);
    const facebook = this.effective<string | null>(SETTING_KEYS.facebookUrl);
    return {
      phone,
      whatsapp: this.effective<boolean>(SETTING_KEYS.whatsappEnabled) && whatsapp ? { number: whatsapp } : null,
      facebook: this.effective<boolean>(SETTING_KEYS.facebookEnabled) && facebook ? { url: facebook } : null,
      ordersOpen: this.effective<boolean>(SETTING_KEYS.checkoutEnabled),
    };
  }

  /** Admin accounts and their live sessions, for the Security section. Never returns tokens or password data. */
  async securityOverview() {
    const [admins, staffAccounts, activeStaffSessions] = await Promise.all([
      this.prisma.customer.findMany({
        where: { roles: { has: Role.ADMIN } },
        select: { id: true, name: true, email: true, isActive: true, createdAt: true, sessions: { where: { isValid: true, expiresAt: { gt: new Date() } }, select: { id: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.customer.count({ where: { roles: { hasSome: [Role.ADMIN, Role.HUB_OPERATOR, Role.SUPPLIER, Role.DRIVER] }, isActive: true } }),
      this.prisma.session.count({ where: { isValid: true, expiresAt: { gt: new Date() }, customer: { roles: { hasSome: [Role.ADMIN, Role.HUB_OPERATOR, Role.SUPPLIER, Role.DRIVER] } } } }),
    ]);
    return {
      activeAdmins: admins.filter(admin => admin.isActive).length,
      activeStaffAccounts: staffAccounts,
      activeStaffSessions,
      admins: admins.map(admin => ({ id: admin.id, name: admin.name, email: admin.email, isActive: admin.isActive, activeSessions: admin.sessions.length })),
    };
  }

  private assertChannelsConsistent(parsed: Map<string, unknown>) {
    const next = <T>(key: string): T => (parsed.has(key) ? parsed.get(key) : this.effective<unknown>(key)) as T;
    if (next<boolean>(SETTING_KEYS.whatsappEnabled) && !next<string | null>(SETTING_KEYS.whatsappNumber)) {
      throw new BadRequestException({ code: 'INVALID_SETTING', key: SETTING_KEYS.whatsappEnabled, message: 'Add the WhatsApp number before switching WhatsApp on.' });
    }
    if (next<boolean>(SETTING_KEYS.facebookEnabled) && !next<string | null>(SETTING_KEYS.facebookUrl)) {
      throw new BadRequestException({ code: 'INVALID_SETTING', key: SETTING_KEYS.facebookEnabled, message: 'Add the Facebook page link before switching Facebook on.' });
    }
  }
}
