import { createHash } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, RecommendationSource } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { PersonalRoutineDto, RoutineStepInputDto, SaveAiRoutineDto } from '../dto/routine-content.dto';
import { ResolvedStep, RoutineContentService, RoutineView } from './routine-content.service';
import { cleanNote, findUnsupportedClaim } from './routine-claims';
import { ImportIssue } from './routine-import';

export const MAX_PERSONAL_ROUTINES = 20;
const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Ready Routines for the storefront: published templates only, with live product availability shown per step and no silent
 * substitution. The Studio owns writing; nothing here can change a template.
 */
@Injectable()
export class ReadyRoutinesService {
  constructor(private readonly prisma: PrismaService, private readonly content: RoutineContentService) {}

  async list(concernSlug?: string) {
    const rows = await this.prisma.routine.findMany({
      where: { isTemplate: true, ownerCustomerId: null, status: 'PUBLISHED', isActive: true, ...(concernSlug ? { concernSlug } : {}) },
      orderBy: { publishedAt: 'desc' }, take: 50,
      select: { id: true, title: true, titleEn: true, description: true, careArea: true, concernSlug: true, publishedAt: true, _count: { select: { steps: true } } },
    });
    return rows.map(row => ({ id: row.id, title: row.title, titleEn: row.titleEn, description: row.description, careArea: row.careArea,
      concernSlug: row.concernSlug, publishedAt: row.publishedAt, steps: row._count.steps }));
  }

  async get(id: string): Promise<RoutineView> {
    const routine = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.routine.findFirst({ where: { id, isTemplate: true, ownerCustomerId: null, status: 'PUBLISHED', isActive: true }, select: { id: true } }) : null;
    if (!routine) throw new NotFoundException('Routine not found');
    return (await this.content.present(routine.id))!;
  }
}

/**
 * «My Routine»: a customer's own routines on the shared routine domain. Owner-only by construction (every query carries the owner),
 * a copy never touches the template it came from, and a product that stops being sellable is shown as such — never replaced,
 * never added to a cart, never purchased by this service.
 */
@Injectable()
export class PersonalRoutinesService {
  constructor(private readonly prisma: PrismaService, private readonly content: RoutineContentService) {}

  async list(customerId: string) {
    const rows = await this.prisma.routine.findMany({
      where: { ownerCustomerId: customerId, isTemplate: false }, orderBy: { updatedAt: 'desc' }, take: MAX_PERSONAL_ROUTINES,
      select: { id: true, title: true, careArea: true, origin: true, sourceRoutineId: true, version: true, updatedAt: true, _count: { select: { steps: true } } },
    });
    return rows.map(row => ({ id: row.id, title: row.title, careArea: row.careArea, origin: row.origin, sourceRoutineId: row.sourceRoutineId,
      version: row.version, steps: row._count.steps, updatedAt: row.updatedAt }));
  }

  async get(customerId: string, id: string): Promise<RoutineView> {
    await this.owned(customerId, id);
    return (await this.content.present(id))!;
  }

  /** Another customer's routine is indistinguishable from a missing one. */
  private async owned(customerId: string, id: string) {
    const routine = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.routine.findFirst({ where: { id, ownerCustomerId: customerId, isTemplate: false } }) : null;
    if (!routine) throw new NotFoundException('Routine not found');
    return routine;
  }

  private async assertRoom(customerId: string) {
    const count = await this.prisma.routine.count({ where: { ownerCustomerId: customerId, isTemplate: false } });
    if (count >= MAX_PERSONAL_ROUTINES) throw new ConflictException({ code: 'ROUTINE_LIMIT', message: `You can keep up to ${MAX_PERSONAL_ROUTINES} routines` });
  }

  /** Every product must be one real, active catalog variant; availability itself is shown, not enforced, for a personal routine. */
  private async resolveSteps(steps: RoutineStepInputDto[], source: RecommendationSource): Promise<ResolvedStep[]> {
    const issues: ImportIssue[] = [];
    const resolved: ResolvedStep[] = [];
    for (const [index, step] of steps.entries()) {
      const path = `$.steps[${index}]`;
      const claim = findUnsupportedClaim(step.instructions) ?? findUnsupportedClaim(step.title);
      if (claim) issues.push({ path, code: 'UNSUPPORTED_CLAIM', message: `Remove the unsupported claim «${claim}»`, severity: 'error' });
      const refs = [step.product, ...(step.alternatives ?? [])];
      const found: Array<{ skuId: string; productId: string }> = [];
      for (const [refIndex, ref] of refs.entries()) {
        const refPath = refIndex === 0 ? `${path}.product` : `${path}.alternatives[${refIndex - 1}]`;
        const result = await this.content.resolveReference({ ...(ref.skuId ? { skuId: ref.skuId } : {}), ...(ref.sku ? { skuCode: ref.sku } : {}), ...(ref.barcode ? { barcode: ref.barcode } : {}) });
        if (result.status !== 'resolved') { issues.push({ path: refPath, code: result.status === 'ambiguous' ? 'AMBIGUOUS_PRODUCT' : 'PRODUCT_NOT_FOUND', message: 'This product cannot be identified in the catalog', severity: 'error' }); continue; }
        const facts = (await this.content.facts([result.skuId])).get(result.skuId);
        if (!facts?.isActive) { issues.push({ path: refPath, code: 'INACTIVE_PRODUCT', message: 'This product is no longer in the catalog', severity: 'error' }); continue; }
        if (!found.some(item => item.skuId === result.skuId)) found.push({ skuId: result.skuId, productId: result.productId });
      }
      if (found.length) resolved.push({ title: step.title.trim(), timing: step.timing, instructions: cleanNote(step.instructions, 400), reason: null,
        isOptional: step.isOptional === true, product: found[0], alternatives: found.slice(1), source });
    }
    if (issues.length) throw new UnprocessableEntityException({ code: 'ROUTINE_INVALID', message: 'Some steps cannot be saved', issues });
    return resolved;
  }

  async create(customerId: string, dto: PersonalRoutineDto): Promise<RoutineView> {
    await this.assertRoom(customerId);
    if (findUnsupportedClaim(dto.title)) throw new UnprocessableEntityException({ code: 'UNSUPPORTED_CLAIM', message: 'The title contains an unsupported claim' });
    const steps = await this.resolveSteps(dto.steps, 'manual');
    const id = await this.prisma.$transaction(async tx => {
      const routine = await tx.routine.create({ data: {
        title: dto.title.trim(), careArea: dto.careArea ?? 'skin', isTemplate: false, isActive: true, status: 'DRAFT', origin: 'USER', ownerCustomerId: customerId,
      } });
      await this.content.writeSteps(tx, routine.id, steps);
      return routine.id;
    }, { timeout: 30000 });
    return (await this.content.present(id))!;
  }

  /** Replaces the title and the ordered steps in one save; the editor sends the whole routine back. */
  async replace(customerId: string, id: string, dto: PersonalRoutineDto): Promise<RoutineView> {
    const routine = await this.owned(customerId, id);
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== routine.version) {
      throw new ConflictException({ code: 'STALE_VERSION', message: 'This routine changed in another window; reload it first', currentVersion: routine.version });
    }
    if (findUnsupportedClaim(dto.title)) throw new UnprocessableEntityException({ code: 'UNSUPPORTED_CLAIM', message: 'The title contains an unsupported claim' });
    const steps = await this.resolveSteps(dto.steps, routine.origin === 'AI' ? 'ai' : 'manual');
    await this.prisma.$transaction(async tx => {
      const updated = await tx.routine.updateMany({ where: { id, ownerCustomerId: customerId, version: routine.version },
        data: { title: dto.title.trim(), ...(dto.careArea ? { careArea: dto.careArea } : {}), version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException({ code: 'STALE_VERSION', message: 'This routine changed at the same time; reload it first' });
      await this.content.writeSteps(tx, id, steps);
    }, { timeout: 30000 });
    return (await this.content.present(id))!;
  }

  async remove(customerId: string, id: string): Promise<{ deleted: true }> {
    await this.owned(customerId, id);
    await this.prisma.routine.deleteMany({ where: { id, ownerCustomerId: customerId } });
    return { deleted: true };
  }

  /** A personal copy of a published Ready Routine; the template itself is never altered. */
  async copyFromTemplate(customerId: string, templateId: string): Promise<RoutineView> {
    await this.assertRoom(customerId);
    const template = /^[0-9a-f-]{36}$/i.test(templateId)
      ? await this.prisma.routine.findFirst({ where: { id: templateId, isTemplate: true, ownerCustomerId: null, status: 'PUBLISHED', isActive: true },
        include: { steps: { orderBy: { stepOrder: 'asc' }, include: { recommendations: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } } } } }) : null;
    if (!template) throw new NotFoundException('Routine not found');
    const id = await this.prisma.$transaction(async tx => {
      const copy = await tx.routine.create({ data: {
        title: template.title, titleEn: template.titleEn, description: null, careArea: template.careArea, concernSlug: template.concernSlug,
        isTemplate: false, isActive: true, status: 'DRAFT', origin: 'COPY', ownerCustomerId: customerId, sourceRoutineId: template.id,
      } });
      for (const step of template.steps) {
        await tx.routineStep.create({ data: {
          routineId: copy.id, title: step.title, instructions: step.instructions, reason: step.reason, stepOrder: step.stepOrder, timing: step.timing, isOptional: step.isOptional,
          recommendations: { create: step.recommendations.map(rec => ({ productId: rec.productId, skuId: rec.skuId, isDefault: rec.isDefault, source: rec.source })) },
        } });
      }
      return copy.id;
    }, { timeout: 30000 });
    return (await this.content.present(id))!;
  }

  /**
   * An assistant's proposal, after the customer reviewed and explicitly confirmed it. The proposal is untrusted input: identity,
   * variant and availability are re-checked here, the assistant's usage text is never stored (only a short reason, screened for
   * unsupported claims), nothing is added to a cart, and a replay of the same key returns the routine already saved.
   */
  async saveFromAiProposal(customerId: string, dto: SaveAiRoutineDto): Promise<RoutineView & { replayed: boolean }> {
    const key = createHash('sha256').update(`ai:${customerId}:${dto.idempotencyKey}`).digest('hex');
    const existing = await this.prisma.routine.findUnique({ where: { importFingerprint: key }, select: { id: true, ownerCustomerId: true } });
    if (existing) {
      if (existing.ownerCustomerId !== customerId) throw new NotFoundException('Routine not found');
      return { ...(await this.content.present(existing.id))!, replayed: true };
    }
    await this.assertRoom(customerId);

    // Medical-sensitive customers are not given an assistant-made routine to save: a qualified professional comes first.
    const profile = await this.prisma.customerCareProfile.findUnique({ where: { customerId }, include: { safetyFlags: true } });
    if (profile?.ageBand === 'UNDER_15' || profile?.safetyFlags?.pregnant === 'YES' || profile?.safetyFlags?.breastfeeding === 'YES') {
      throw new ForbiddenException({ code: 'SAFETY_REVIEW_REQUIRED', message: 'This routine needs review by a qualified professional before it can be saved' });
    }

    const issues: ImportIssue[] = [];
    const titleClaim = findUnsupportedClaim(dto.title);
    if (titleClaim) issues.push({ path: '$.title', code: 'UNSUPPORTED_CLAIM', message: `Unsupported claim «${titleClaim}»`, severity: 'error' });
    const resolved: ResolvedStep[] = [];
    const skuIds = dto.steps.map(step => step.skuId);
    const states = await this.content.states(skuIds);
    for (const [index, step] of dto.steps.entries()) {
      const path = `$.steps[${index}]`;
      const state = states.get(step.skuId);
      if (!state || state.state === 'MISSING') { issues.push({ path: `${path}.skuId`, code: 'PRODUCT_NOT_FOUND', message: 'This variant does not exist in the catalog', severity: 'error' }); continue; }
      if (state.state !== 'AVAILABLE') { issues.push({ path: `${path}.skuId`, code: `PRODUCT_${state.state}`, message: `${state.skuCode} cannot be recommended right now (${state.state.toLowerCase()})`, severity: 'error' }); continue; }
      const reason = cleanNote(step.reason, 280);
      const claim = findUnsupportedClaim(reason) ?? findUnsupportedClaim(step.title);
      if (claim) { issues.push({ path: `${path}.reason`, code: 'UNSUPPORTED_CLAIM', message: `Unsupported claim «${claim}»`, severity: 'error' }); continue; }
      resolved.push({ title: step.title.trim(), timing: step.timing, instructions: null, reason, isOptional: step.isOptional === true,
        product: { skuId: step.skuId, productId: state.productId }, alternatives: [], source: 'ai' });
    }
    // All or nothing: one invalid step means nothing is saved, so a half-validated routine never exists.
    if (issues.length) throw new UnprocessableEntityException({ code: 'PROPOSAL_INVALID', message: 'The proposal has steps that cannot be saved', issues });
    if (!resolved.length) throw new BadRequestException('The proposal has no steps');

    try {
      const id = await this.prisma.$transaction(async tx => {
        const routine = await tx.routine.create({ data: {
          title: dto.title.trim(), careArea: dto.careArea ?? 'skin', isTemplate: false, isActive: true, status: 'DRAFT', origin: 'AI', ownerCustomerId: customerId, importFingerprint: key,
        } });
        await this.content.writeSteps(tx, routine.id, resolved);
        return routine.id;
      }, { timeout: 30000 });
      return { ...(await this.content.present(id))!, replayed: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.prisma.routine.findUnique({ where: { importFingerprint: key }, select: { id: true, ownerCustomerId: true } });
        if (again?.ownerCustomerId === customerId) return { ...(await this.content.present(again.id))!, replayed: true };
      }
      throw error;
    }
  }
}
