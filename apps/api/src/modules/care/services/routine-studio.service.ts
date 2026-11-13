import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SkuReference, SkuRoutineFacts } from '../../catalog/public';
import { StudioRoutineDto } from '../dto/routine-content.dto';
import { ApiTiming, ProductView, ResolvedStep, RoutineContentService, RoutineView } from './routine-content.service';
import { findUnsupportedClaim } from './routine-claims';
import { IMPORT_LIMITS, ImportIssue, ParsedRoutine, fingerprintOf, parseRoutineDocument } from './routine-import';

interface ProductInput { path: string; ref: SkuReference; expect?: { variant?: string; size?: number; sizeUnit?: string } | null }
interface StepInput { title: string; timing: ApiTiming; instructions: string | null; isOptional: boolean; product: ProductInput; alternatives: ProductInput[] }
export interface RoutineInput {
  title: string; titleEn: string | null; description: string | null; careArea: 'skin' | 'hair'; concernSlug: string
  references: Array<{ title: string; url: string }>; steps: StepInput[]
}

export interface ImportPreview {
  valid: boolean
  issues: ImportIssue[]
  /** Alternatives left out of the draft, each with the reason (nothing is dropped silently). */
  skipped: Array<{ path: string; reason: string }>
  fingerprint: string | null
  duplicateOf: string | null
  preview: { title: string; titleEn: string | null; concernSlug: string; careArea: string; description: string | null; steps: Array<{ index: number; timing: string; title: string; usage: string | null; optional: boolean; product: ProductView | null; alternatives: ProductView[] }> } | null
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Admin Routine Studio (GLO-312): curated Ready Routine templates on the shared routine domain. A template is a draft until an
 * authorized Admin publishes it, a published template is never edited in place (unpublish first), and every change leaves a revision.
 * JSON import normalizes into the very same input as the editor, creates a DRAFT only, and never changes the catalog.
 */
@Injectable()
export class RoutineStudioService {
  constructor(private readonly prisma: PrismaService, private readonly content: RoutineContentService) {}

  // ---- reads -----------------------------------------------------------------------------------

  async list() {
    const rows = await this.prisma.routine.findMany({
      where: { isTemplate: true, ownerCustomerId: null }, orderBy: [{ updatedAt: 'desc' }],
      select: { id: true, title: true, status: true, careArea: true, concernSlug: true, version: true, updatedAt: true, publishedAt: true, _count: { select: { steps: true } } },
    });
    return rows.map(row => ({ id: row.id, title: row.title, status: row.status, careArea: row.careArea, concernSlug: row.concernSlug,
      version: row.version, steps: row._count.steps, updatedAt: row.updatedAt, publishedAt: row.publishedAt }));
  }

  async get(id: string): Promise<RoutineView> {
    await this.template(id);
    return (await this.content.present(id))!;
  }

  async revisions(id: string) {
    await this.template(id);
    return this.prisma.routineRevision.findMany({ where: { routineId: id }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, version: true, action: true, actorId: true, createdAt: true, snapshot: true } });
  }

  private async template(id: string) {
    const routine = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.routine.findFirst({ where: { id, isTemplate: true, ownerCustomerId: null } }) : null;
    if (!routine) throw new NotFoundException('Routine template not found');
    return routine;
  }

  // ---- resolution + validation (shared by editor and import) -----------------------------------

  /** Resolves every reference to one canonical SKU and checks the text; returns what can be stored plus every problem found. */
  async resolve(input: RoutineInput): Promise<{ steps: ResolvedStep[]; issues: ImportIssue[]; skipped: Array<{ path: string; reason: string }>; views: Map<string, ProductView> }> {
    const issues: ImportIssue[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    const error = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: 'error' });
    const warn = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: 'warning' });

    const concern = await this.prisma.concern.findUnique({ where: { slug: input.concernSlug }, select: { isActive: true, careArea: true } });
    if (!concern || !concern.isActive) error('$.concern', 'UNKNOWN_CONCERN', `No active concern with slug "${input.concernSlug}"`);
    else if (concern.careArea !== input.careArea) warn('$.careArea', 'CARE_AREA_MISMATCH', `The concern belongs to ${concern.careArea}, not ${input.careArea}`);

    for (const [path, text] of [['$.title', input.title], ['$.description', input.description]] as const) {
      const claim = findUnsupportedClaim(text);
      if (claim) error(path, 'UNSUPPORTED_CLAIM', `Remove the unsupported claim «${claim}»; routines make no cure, prevention or safety promises`);
    }

    // Resolve every reference first, then load facts once.
    const resolved = new Map<string, Awaited<ReturnType<RoutineContentService['resolveReference']>>>();
    const refs = input.steps.flatMap(step => [step.product, ...step.alternatives]);
    for (const ref of refs) resolved.set(ref.path, await this.content.resolveReference(ref.ref));
    const skuIds = [...resolved.values()].flatMap(result => result.status === 'resolved' ? [result.skuId] : []);
    const views = await this.content.states(skuIds);
    const facts = await this.content.facts(skuIds);

    const check = (ref: ProductInput, role: 'default' | 'alternative'): { skuId: string; productId: string } | null => {
      const result = resolved.get(ref.path)!;
      const fail = (code: string, message: string) => { if (role === 'default') error(ref.path, code, message); else { warn(ref.path, code, message); skipped.push({ path: ref.path, reason: message }); } };
      if (result.status === 'invalid') { fail('INVALID_PRODUCT_REFERENCE', 'Give exactly one valid identifier (skuId, sku or barcode)'); return null; }
      if (result.status === 'missing') { fail('PRODUCT_NOT_FOUND', 'No catalog product matches this identifier'); return null; }
      if (result.status === 'ambiguous') { fail('AMBIGUOUS_PRODUCT', 'This identifier matches more than one catalog variant'); return null; }
      const fact = facts.get(result.skuId) as SkuRoutineFacts;
      if (!fact.isActive) { fail('INACTIVE_PRODUCT', `${fact.skuCode} is inactive in the catalog`); return null; }
      if (ref.expect) {
        const wrong = (ref.expect.variant !== undefined && norm(ref.expect.variant) !== norm(fact.variantName))
          || (ref.expect.size !== undefined && ref.expect.size !== fact.size)
          || (ref.expect.sizeUnit !== undefined && norm(ref.expect.sizeUnit) !== norm(fact.sizeUnit ?? ''));
        if (wrong) { fail('WRONG_VARIANT', `${fact.skuCode} is «${fact.variantName}»${fact.size ? ` ${fact.size} ${fact.sizeUnit ?? ''}` : ''}, which is not the expected variant`); return null; }
      }
      const state = views.get(result.skuId)!.state;
      if (state === 'UNPUBLISHED') warn(ref.path, 'PRODUCT_UNPUBLISHED', `${fact.skuCode} is not published; the routine cannot be published until it is`);
      if (state === 'UNAVAILABLE') warn(ref.path, 'PRODUCT_UNAVAILABLE', `${fact.skuCode} cannot be ordered right now (no listing or price)`);
      return { skuId: result.skuId, productId: result.productId };
    };

    const steps: ResolvedStep[] = [];
    input.steps.forEach((step, index) => {
      const base = `$.steps[${index}]`;
      const claim = findUnsupportedClaim(step.instructions) ?? findUnsupportedClaim(step.title);
      if (claim) error(`${base}.usage`, 'UNSUPPORTED_CLAIM', `Remove the unsupported claim «${claim}»`);
      const main = check(step.product, 'default');
      const seen = new Set<string>(main ? [main.skuId] : []);
      const alternatives: Array<{ skuId: string; productId: string }> = [];
      for (const alt of step.alternatives) {
        const found = check(alt, 'alternative');
        if (!found) continue;
        if (seen.has(found.skuId)) { warn(alt.path, 'DUPLICATE_ALTERNATIVE', 'Already used in this step'); skipped.push({ path: alt.path, reason: 'Duplicate of another product in the same step' }); continue; }
        seen.add(found.skuId);
        alternatives.push(found);
      }
      if (main) steps.push({ title: step.title, timing: step.timing, instructions: step.instructions, reason: null, isOptional: step.isOptional, product: main, alternatives, source: 'manual' });
    });
    return { steps, issues, skipped, views };
  }

  private fromDto(dto: StudioRoutineDto): RoutineInput {
    const ref = (value: { skuId?: string; sku?: string; barcode?: string }, path: string): ProductInput => ({
      path, ref: { ...(value.skuId ? { skuId: value.skuId } : {}), ...(value.sku ? { skuCode: value.sku } : {}), ...(value.barcode ? { barcode: value.barcode } : {}) },
    });
    return {
      title: dto.title.trim(), titleEn: dto.titleEn?.trim() || null, description: dto.description?.trim() || null, careArea: dto.careArea, concernSlug: dto.concernSlug,
      references: (dto.references ?? []).map(r => ({ title: r.title.trim(), url: r.url.trim() })),
      steps: dto.steps.map((step, index) => ({
        title: step.title.trim(), timing: step.timing, instructions: step.instructions?.trim() || null, isOptional: step.isOptional === true,
        product: ref(step.product, `$.steps[${index}].product`),
        alternatives: (step.alternatives ?? []).map((alt, altIndex) => ref(alt, `$.steps[${index}].alternatives[${altIndex}]`)),
      })),
    };
  }

  private fromParsed(parsed: ParsedRoutine): RoutineInput {
    return {
      title: parsed.title, titleEn: parsed.titleEn, description: parsed.description, careArea: parsed.careArea, concernSlug: parsed.concern, references: parsed.references,
      steps: parsed.steps.map(step => ({
        title: step.title, timing: step.timing, instructions: step.usage, isOptional: step.optional,
        product: { path: step.product.path, ref: step.product.ref, expect: step.product.expect },
        alternatives: step.alternatives.map(alt => ({ path: alt.path, ref: alt.ref, expect: alt.expect })),
      })),
    };
  }

  private refuse(issues: ImportIssue[]): never {
    throw new UnprocessableEntityException({ code: 'ROUTINE_INVALID', message: 'The routine has problems that must be fixed first', issues });
  }

  // ---- draft CRUD ------------------------------------------------------------------------------

  async createDraft(dto: StudioRoutineDto, actorId: string): Promise<RoutineView> {
    return this.persistDraft(this.fromDto(dto), actorId);
  }

  private async persistDraft(input: RoutineInput, actorId: string, fingerprint?: string): Promise<RoutineView> {
    const { steps, issues } = await this.resolve(input);
    if (issues.some(issue => issue.severity === 'error') || !steps.length) this.refuse(issues);
    const id = await this.prisma.$transaction(async tx => {
      const routine = await tx.routine.create({ data: {
        title: input.title, titleEn: input.titleEn, description: input.description, careArea: input.careArea, concernSlug: input.concernSlug,
        references: input.references as unknown as Prisma.InputJsonValue, isTemplate: true, isActive: true, status: 'DRAFT', origin: 'TEMPLATE',
        importFingerprint: fingerprint ?? null,
      } });
      await this.content.writeSteps(tx, routine.id, steps);
      await this.content.revise(tx, routine.id, fingerprint ? 'imported' : 'created', actorId);
      return routine.id;
    }, { timeout: 30000 });
    return (await this.content.present(id))!;
  }

  async updateDraft(id: string, dto: StudioRoutineDto, actorId: string): Promise<RoutineView> {
    const routine = await this.template(id);
    if (routine.status === 'PUBLISHED') throw new ConflictException({ code: 'UNPUBLISH_FIRST', message: 'A published routine is not edited in place; unpublish it first' });
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== routine.version) {
      throw new ConflictException({ code: 'STALE_VERSION', message: 'The routine changed since you opened it; reload and apply your edit again', currentVersion: routine.version });
    }
    const input = this.fromDto(dto);
    const { steps, issues } = await this.resolve(input);
    if (issues.some(issue => issue.severity === 'error') || !steps.length) this.refuse(issues);
    await this.prisma.$transaction(async tx => {
      const updated = await tx.routine.updateMany({ where: { id, version: routine.version }, data: {
        title: input.title, titleEn: input.titleEn, description: input.description, careArea: input.careArea, concernSlug: input.concernSlug,
        references: input.references as unknown as Prisma.InputJsonValue, version: { increment: 1 },
      } });
      if (updated.count !== 1) throw new ConflictException({ code: 'STALE_VERSION', message: 'The routine changed at the same time; reload and try again' });
      await this.content.writeSteps(tx, id, steps);
      await this.content.revise(tx, id, 'edited', actorId);
    }, { timeout: 30000 });
    return (await this.content.present(id))!;
  }

  // ---- publish gate ----------------------------------------------------------------------------

  async publish(id: string, actorId: string): Promise<RoutineView> {
    const routine = await this.template(id);
    if (routine.status === 'PUBLISHED') return (await this.content.present(id))!;
    const view = (await this.content.present(id))!;
    const problems: ImportIssue[] = [];
    const error = (path: string, code: string, message: string) => problems.push({ path, code, message, severity: 'error' });
    if (view.title.trim().length < 3) error('$.title', 'REQUIRED', 'A title is required');
    if (!view.description?.trim()) error('$.description', 'REQUIRED', 'A short, evidence-grounded description is required');
    if (!view.concernSlug) error('$.concern', 'REQUIRED', 'A concern is required');
    if (!view.references.length) error('$.references', 'REQUIRED', 'Publishing needs at least one reference the content is grounded in');
    if (!view.steps.length) error('$.steps', 'REQUIRED', 'At least one step is required');
    for (const claim of [findUnsupportedClaim(view.description), ...view.steps.map(step => findUnsupportedClaim(step.instructions))]) {
      if (claim) error('$.text', 'UNSUPPORTED_CLAIM', `Remove the unsupported claim «${claim}»`);
    }
    view.steps.forEach((step, index) => {
      // Readiness is checked now, against the live catalog and commerce state: a stale draft cannot publish an unsellable product.
      if (!step.product) error(`$.steps[${index}]`, 'MISSING_PRODUCT', `${step.title}: the step has no product`);
      else if (step.product.state !== 'AVAILABLE') error(`$.steps[${index}].product`, `PRODUCT_${step.product.state}`, `${step.title}: ${step.product.skuCode ?? 'the product'} is ${step.product.state.toLowerCase()} and cannot be recommended`);
      step.alternatives.filter(alt => alt.state === 'MISSING' || alt.state === 'INACTIVE').forEach((alt, altIndex) =>
        error(`$.steps[${index}].alternatives[${altIndex}]`, `PRODUCT_${alt.state}`, `${step.title}: an alternative is ${alt.state.toLowerCase()}`));
    });
    if (problems.length) this.refuse(problems);
    await this.prisma.$transaction(async tx => {
      const updated = await tx.routine.updateMany({ where: { id, version: routine.version, status: { not: 'PUBLISHED' } },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: actorId, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException({ code: 'STALE_VERSION', message: 'The routine changed at the same time; reload and publish again' });
      await this.content.revise(tx, id, 'published', actorId);
    });
    return (await this.content.present(id))!;
  }

  async unpublish(id: string, actorId: string): Promise<RoutineView> {
    const routine = await this.template(id);
    if (routine.status !== 'PUBLISHED') return (await this.content.present(id))!;
    await this.prisma.$transaction(async tx => {
      await tx.routine.update({ where: { id }, data: { status: 'UNPUBLISHED', version: { increment: 1 } } });
      await this.content.revise(tx, id, 'unpublished', actorId);
    });
    return (await this.content.present(id))!;
  }

  // ---- JSON import -----------------------------------------------------------------------------

  /** Validates and resolves a document without persisting anything. */
  async previewImport(document: unknown): Promise<ImportPreview> {
    const size = Buffer.byteLength(JSON.stringify(document ?? null));
    if (size > IMPORT_LIMITS.bytes) {
      return { valid: false, issues: [{ path: '$', code: 'TOO_LARGE', message: `The document is larger than ${IMPORT_LIMITS.bytes / 1024} KB`, severity: 'error' }], skipped: [], fingerprint: null, duplicateOf: null, preview: null };
    }
    const { parsed, issues } = parseRoutineDocument(document);
    if (!parsed) return { valid: false, issues, skipped: [], fingerprint: null, duplicateOf: null, preview: null };
    const input = this.fromParsed(parsed);
    const resolution = await this.resolve(input);
    const fingerprint = fingerprintOf(parsed);
    const duplicate = await this.prisma.routine.findUnique({ where: { importFingerprint: fingerprint }, select: { id: true } });
    const all = [...issues, ...resolution.issues];
    if (duplicate) all.push({ path: '$', code: 'DUPLICATE_IMPORT', message: 'This exact routine was already imported', severity: 'error' });
    const resolvedByPath = new Map<string, ProductView>();
    // Preview product cards in document order (resolved SKUs only).
    for (const step of input.steps) for (const ref of [step.product, ...step.alternatives]) {
      const result = await this.content.resolveReference(ref.ref);
      if (result.status === 'resolved') resolvedByPath.set(ref.path, resolution.views.get(result.skuId)!);
    }
    return {
      valid: !all.some(issue => issue.severity === 'error'), issues: all, skipped: resolution.skipped, fingerprint, duplicateOf: duplicate?.id ?? null,
      preview: { title: input.title, titleEn: input.titleEn, concernSlug: input.concernSlug, careArea: input.careArea, description: input.description,
        steps: input.steps.map((step, index) => ({ index, timing: step.timing, title: step.title, usage: step.instructions, optional: step.isOptional,
          product: resolvedByPath.get(step.product.path) ?? null, alternatives: step.alternatives.flatMap(alt => resolvedByPath.get(alt.path) ?? []) })) },
    };
  }

  /** Creates a DRAFT after the Admin confirms. Never publishes; a failure rolls back completely. */
  async importDraft(document: unknown, actorId: string): Promise<RoutineView> {
    const preview = await this.previewImport(document);
    if (!preview.valid || !preview.fingerprint) {
      if (preview.duplicateOf) throw new ConflictException({ code: 'DUPLICATE_IMPORT', message: 'This exact routine was already imported', routineId: preview.duplicateOf });
      this.refuse(preview.issues);
    }
    const { parsed } = parseRoutineDocument(document);
    try {
      return await this.persistDraft(this.fromParsed(parsed!), actorId, preview.fingerprint);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.routine.findUnique({ where: { importFingerprint: preview.fingerprint }, select: { id: true } });
        throw new ConflictException({ code: 'DUPLICATE_IMPORT', message: 'This exact routine was already imported', routineId: existing?.id });
      }
      throw error;
    }
  }
}
