import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MediaTemplate, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../../platform/database/prisma.service';
import { MEDIA_PROCESSOR, MediaProcessorPort } from '../../../platform/storage/media-processor.port';
import { TemplateRules } from '../../../platform/storage/product-compositor';
import { StorageService } from '../../../platform/storage/storage.service';
import { RegisterMediaTemplateDto } from '../dto/media-asset.dto';

const TEMPLATE_OWNER = 'catalog-media';
const TEMPLATE_FOLDER = 'templates';
const MIN_TEMPLATE_EDGE = 800;
/** The approved product background is bundled unchanged and versioned; older templates remain available for rollback. */
export const DEFAULT_TEMPLATE_KEY = 'catalog-approved';
const BUNDLED_DEFAULT = { file: 'assets/media-templates/catalog-approved-v1.png', rules: 'assets/media-templates/catalog-approved.rules.json', name: 'Approved catalog background' };
const defaultKey = () => (process.env.MEDIA_DEFAULT_TEMPLATE_KEY ?? DEFAULT_TEMPLATE_KEY).trim();

/** JSONB does not keep key order, so "same rules" has to compare content. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item));

const inRange = (value: unknown, low: number, high: number) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;

/** Rejects a rule set that could place the pack off the scene, so a bad upload fails at registration rather than on a product. */
export function parseTemplateRules(value: unknown): TemplateRules {
  const rules = value as TemplateRules | null | undefined;
  const placement = rules?.placement;
  const shadow = rules?.shadow;
  const output = rules?.output;
  const valid = placement && shadow && output
    && inRange(output.size, 400, 3000) && inRange(output.quality, 50, 100)
    && inRange(placement.centerX, 0.1, 0.9) && inRange(placement.baselineY, 0.2, 1) && (placement.centerY === undefined || inRange(placement.centerY, 0.2, 0.8))
    && (shadow?.enabled === undefined || typeof shadow.enabled === 'boolean') && inRange(placement.maxHeight, 0.1, 1) && inRange(placement.maxWidth, 0.1, 1) && inRange(placement.maxUpscale, 0.1, 4)
    && inRange(shadow.contactOpacity, 0, 1) && inRange(shadow.contactBlur, 0, 0.1) && inRange(shadow.contactHeight, 0, 0.2)
    && inRange(shadow.castOpacity, 0, 1) && inRange(shadow.castBlur, 0, 0.1)
    && (shadow.castReach === undefined || inRange(shadow.castReach, -1, 1)) && (shadow.castDrop === undefined || inRange(shadow.castDrop, 0, 0.5))
    && (shadow.ambientOpacity === undefined || inRange(shadow.ambientOpacity, 0, 1)) && (shadow.ambientBlur === undefined || inRange(shadow.ambientBlur, 0, 0.1))
    && Array.isArray(shadow.color) && shadow.color.length === 3 && shadow.color.every(channel => inRange(channel, 0, 255));
  if (!valid) throw new BadRequestException('Template rules are incomplete or out of range');
  return { output: { size: output.size, quality: output.quality }, placement: { ...placement }, shadow: { ...shadow, color: [...shadow.color] as [number, number, number] } };
}

/**
 * Versioned, replaceable editorial scenes. The file lives in storage and the layout lives with it, so the owner replaces a template with an upload. Processing code knows
 * no image path. Every derivative points at the immutable version that generated it.
 */
@Injectable()
export class MediaTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(MEDIA_PROCESSOR) private readonly processor: MediaProcessorPort,
  ) {}

  async register(dto: RegisterMediaTemplateDto, file: Express.Multer.File, actorId: string): Promise<MediaTemplate> {
    const image = await this.processor.inspect(file.buffer);
    if (Math.min(image.width, image.height) < MIN_TEMPLATE_EDGE) throw new BadRequestException(`A template needs at least ${MIN_TEMPLATE_EDGE}px on each side`);
    if (image.width !== image.height) throw new BadRequestException('A template must be square');
    if (dto.categoryIds?.length) {
      const known = await this.prisma.category.count({ where: { id: { in: dto.categoryIds } } });
      if (known !== dto.categoryIds.length) throw new BadRequestException('One or more categories do not exist');
    }
    const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const previous = await this.prisma.mediaTemplate.findFirst({ where: { templateKey: dto.templateKey }, orderBy: { version: 'desc' } });
    if (!dto.rules && !previous) throw new BadRequestException('The first version of a template needs its placement rules');
    const rules = parseTemplateRules(dto.rules ?? previous!.rules);
    const url = await this.storage.uploadFile({ ...file, mimetype: image.mimeType }, true, TEMPLATE_FOLDER, TEMPLATE_OWNER);
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media-template:${dto.templateKey}`}))`;
        const latest = await tx.mediaTemplate.findFirst({ where: { templateKey: dto.templateKey }, orderBy: { version: 'desc' } });
        if (latest?.contentHash === contentHash && canonical(latest.rules) === canonical(rules)) {
          throw new ConflictException({ code: 'TEMPLATE_UNCHANGED', message: `This file is already version ${latest.version} of the template`, templateId: latest.id });
        }
        await tx.mediaTemplate.updateMany({ where: { templateKey: dto.templateKey, isActive: true }, data: { isActive: false } });
        return tx.mediaTemplate.create({ data: {
          templateKey: dto.templateKey, version: (latest?.version ?? 0) + 1, name: dto.name, categoryIds: dto.categoryIds ?? latest?.categoryIds ?? [],
          storageUrl: url, contentHash, mimeType: image.mimeType, width: image.width, height: image.height, byteSize: file.buffer.length,
          rules: rules as unknown as Prisma.InputJsonValue, createdBy: actorId,
        } });
      });
    } catch (error) {
      await this.storage.deleteFile(url).catch(() => undefined);
      throw error;
    }
  }

  async list(templateKey?: string): Promise<Array<MediaTemplate & { derivativeCount: number }>> {
    const rows = await this.prisma.mediaTemplate.findMany({
      where: templateKey ? { templateKey } : {}, orderBy: [{ templateKey: 'asc' }, { version: 'desc' }],
      include: { _count: { select: { assets: true } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, derivativeCount: _count.assets }));
  }

  async get(id: string): Promise<MediaTemplate> {
    const template = await this.prisma.mediaTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Media template not found');
    return template;
  }

  /** Reactivating an old version is a rollback: it becomes the only active version of its key. */
  async setActive(id: string, isActive: boolean): Promise<MediaTemplate> {
    return this.prisma.$transaction(async tx => {
      const template = await tx.mediaTemplate.findUnique({ where: { id } });
      if (!template) throw new NotFoundException('Media template not found');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media-template:${template.templateKey}`}))`;
      if (isActive) await tx.mediaTemplate.updateMany({ where: { templateKey: template.templateKey, isActive: true, id: { not: id } }, data: { isActive: false } });
      return tx.mediaTemplate.update({ where: { id }, data: { isActive } });
    });
  }

  async activeVersion(templateKey: string): Promise<MediaTemplate> {
    const template = await this.prisma.mediaTemplate.findFirst({ where: { templateKey, isActive: true } });
    if (!template) throw new ConflictException({ code: 'NO_ACTIVE_TEMPLATE', message: `Template ${templateKey} has no active version` });
    return template;
  }

  /** An explicit choice wins. Otherwise the active template of the SKU's category, then the active fallback; never a guess. */
  async resolveForSku(skuId: string, templateId?: string): Promise<MediaTemplate> {
    if (templateId) return this.get(templateId);
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, select: { product: { select: { categoryId: true } } } });
    if (!sku) throw new NotFoundException('Canonical SKU not found');
    const active = await this.prisma.mediaTemplate.findMany({ where: { isActive: true }, orderBy: [{ templateKey: 'asc' }] });
    const preferred = active.find(template => template.templateKey === defaultKey());
    if (preferred) return preferred;
    const categoryId = sku.product.categoryId;
    const match = (categoryId ? active.find(template => template.categoryIds.includes(categoryId)) : undefined) ?? active.find(template => template.categoryIds.length === 0);
    if (!match) throw new ConflictException({ code: 'NO_ACTIVE_TEMPLATE', message: 'No active media template serves this product category' });
    return match;
  }

  /**
   * Makes sure the bundled default template is registered and active (first use, or a fresh environment). Registering the same file again is a no-op, so this is safe
   * to call before every automatic derivation. Never replaces a newer version a person registered under the same key.
   */
  async ensureDefaultTemplate(actorId: string): Promise<MediaTemplate | null> {
    const key = defaultKey();
    if (key !== DEFAULT_TEMPLATE_KEY) return this.prisma.mediaTemplate.findFirst({ where: { templateKey: key, isActive: true } });
    const existing = await this.prisma.mediaTemplate.findFirst({ where: { templateKey: key }, orderBy: { version: 'desc' } });
    if (existing) return existing.isActive ? existing : this.prisma.mediaTemplate.findFirst({ where: { templateKey: key, isActive: true } });
    // Source and compiled layouts differ in depth: walk up to the API package that ships the asset.
    let root = __dirname;
    while (!fs.existsSync(path.join(root, BUNDLED_DEFAULT.file)) && path.dirname(root) !== root) root = path.dirname(root);
    const buffer = fs.readFileSync(path.join(root, BUNDLED_DEFAULT.file));
    const rules = JSON.parse(fs.readFileSync(path.join(root, BUNDLED_DEFAULT.rules), 'utf8'));
    try {
      return await this.register({ templateKey: key, name: BUNDLED_DEFAULT.name, rules } as RegisterMediaTemplateDto,
        { buffer, mimetype: 'image/png', originalname: 'catalog-approved-v1.png', size: buffer.length, fieldname: 'file', encoding: '7bit' } as Express.Multer.File, actorId);
    } catch (error) {
      if (error instanceof ConflictException) return this.prisma.mediaTemplate.findFirst({ where: { templateKey: key, isActive: true } });
      throw error;
    }
  }

  async readFile(template: MediaTemplate): Promise<Buffer> {
    const buffer = await this.storage.getFileBuffer(this.storage.privateObjectKey(template.storageUrl, TEMPLATE_OWNER, TEMPLATE_FOLDER));
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== template.contentHash) throw new ConflictException('Template file no longer matches its recorded hash');
    return buffer;
  }

  rulesOf(template: MediaTemplate): TemplateRules {
    return parseTemplateRules(template.rules);
  }
}
