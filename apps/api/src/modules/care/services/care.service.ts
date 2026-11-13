import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../../catalog/public';
import { CreateConcernDto, CreateRoutineDto, CreateRoutineStepDto } from '../dto/care.dto';

/** A concern as the public taxonomy exposes it (`GET /care/concerns`). */
export interface PublicConcern {
  id: string;
  name: string;
  slug: string;
  careArea: 'skin' | 'hair';
  description: string | null;
  isActive: boolean;
}

@Injectable()
export class CareService {
  async addReviewedProductStep(productId: string, stepId: string): Promise<void> {
    const step = await this.prisma.routineStep.findUnique({ where: { id: stepId }, include: { routine: true } });
    if (!step?.routine.isActive) throw new NotFoundException('Active routine step not found');
    await this.prisma.routineStepRecommendation.upsert({
      where: { stepId_productId: { stepId, productId } },
      create: { stepId, productId, source: 'manual' },
      update: {},
    });
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
  ) {}

  /** Public templates only. Customer profiles and generated recommendations never enter this projection. */
  async getPublicProductPlacements(productId: string) {
    const recommendations = await this.prisma.routineStepRecommendation.findMany({
      where: { productId, source: { in: ['manual', 'expert'] }, step: { routine: { isActive: true, isTemplate: true, status: 'PUBLISHED', ownerCustomerId: null } } },
      orderBy: [{ step: { routineId: 'asc' } }, { step: { stepOrder: 'asc' } }, { id: 'asc' }],
      select: { source: true, step: { select: { title: true, instructions: true, stepOrder: true, timing: true, isOptional: true,
        routine: { select: { id: true, title: true, careArea: true } } } } },
    });
    return recommendations.map(({ source, step }) => ({ routine: step.routine, source,
      step: { title: step.title, instructions: step.instructions, order: step.stepOrder, timing: step.timing, isOptional: step.isOptional } }));
  }

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  // ---------------------------------------------------------------------------
  // Concerns
  // ---------------------------------------------------------------------------

  async createConcern(dto: CreateConcernDto) {
    const slug = dto.slug || dto.name.toLowerCase().replace(/\s+/g, '-');
    const existing = await this.prisma.concern.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException(`Concern with slug '${slug}' already exists`);
    }

    return this.prisma.concern.create({
      data: {
        name: dto.name,
        slug,
        careArea: dto.careArea,
        description: dto.description,
        isActive: dto.isActive ?? true,
      },
    });
  }

  /**
   * Public concern taxonomy for discovery (guests included): active concerns only, in a fixed projection.
   * It is reference data, so nothing customer-specific (profiles, profile links) is ever selected.
   */
  async getPublicConcerns(): Promise<PublicConcern[]> {
    return this.prisma.concern.findMany({
      where: { isActive: true },
      orderBy: [{ careArea: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, slug: true, careArea: true, description: true, isActive: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Routines
  // ---------------------------------------------------------------------------

  async createRoutine(dto: CreateRoutineDto) {
    return this.prisma.routine.create({
      data: {
        title: dto.title,
        description: dto.description,
        careArea: dto.careArea,
        isTemplate: dto.isTemplate ?? true,
        isActive: dto.isActive ?? true,
        // Legacy admin endpoint: its routines have always been live. New curated templates go through the Routine Studio (draft → publish).
        status: 'PUBLISHED',
      },
    });
  }

  /**
   * A routine by id, only if the viewer may see it: staff see every template; anyone else sees published templates and their own
   * personal routines. A draft or someone else's routine is indistinguishable from a missing one.
   */
  async getRoutine(id: string, viewer: { isAdmin: boolean; customerId?: string } = { isAdmin: false }) {
    if (!this.isUuid(id)) return null;
    const visible: Prisma.RoutineWhereInput = viewer.isAdmin
      ? { isTemplate: true }
      : { OR: [{ isTemplate: true, status: 'PUBLISHED', ownerCustomerId: null }, ...(viewer.customerId ? [{ ownerCustomerId: viewer.customerId }] : [])] };
    const routine = await this.prisma.routine.findFirst({
      where: { id, ...visible },
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
          include: { recommendations: true },
        },
      },
    });
    return routine;
  }

  // ---------------------------------------------------------------------------
  // Routine Steps & Recommendations
  // ---------------------------------------------------------------------------

  async addRoutineStep(routineId: string, dto: CreateRoutineStepDto) {
    if (!this.isUuid(routineId)) throw new BadRequestException('Invalid routine ID');

    const routine = await this.prisma.routine.findUnique({ where: { id: routineId } });
    if (!routine) throw new NotFoundException('Routine not found');

    const existingStepOrder = await this.prisma.routineStep.findUnique({
      where: { routineId_stepOrder: { routineId, stepOrder: dto.stepOrder } },
    });

    if (existingStepOrder) {
      throw new ConflictException(`Step order ${dto.stepOrder} already exists for this routine`);
    }

    // Validate products exist in catalog
    if (dto.recommendations && dto.recommendations.length > 0) {
      for (const rec of dto.recommendations) {
        if (!this.isUuid(rec.productId)) {
          throw new BadRequestException(`Invalid product ID: ${rec.productId}`);
        }
        const product = await this.catalogService.getProduct(rec.productId);
        if (!product) {
          throw new NotFoundException(`Product not found in catalog: ${rec.productId}`);
        }
      }
    }

    return this.prisma.routineStep.create({
      data: {
        routineId,
        title: dto.title,
        instructions: dto.instructions,
        stepOrder: dto.stepOrder,
        timing: dto.timing,
        isOptional: dto.isOptional ?? false,
        recommendations: {
          create: dto.recommendations?.map(rec => ({
            productId: rec.productId,
            source: rec.source || 'manual',
          })) || [],
        },
      },
      include: { recommendations: true },
    });
  }
}
