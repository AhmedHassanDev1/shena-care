import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../../catalog/public';
import { CreateConcernDto, CreateRoutineDto, CreateRoutineStepDto } from '../dto/care.dto';

@Injectable()
export class CareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
  ) {}

  /** Public templates only. Customer profiles and generated recommendations never enter this projection. */
  async getPublicProductPlacements(productId: string) {
    const recommendations = await this.prisma.routineStepRecommendation.findMany({
      where: { productId, source: { in: ['manual', 'expert'] }, step: { routine: { isActive: true, isTemplate: true } } },
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

  async getConcerns() {
    return this.prisma.concern.findMany({
      orderBy: { createdAt: 'desc' },
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
      },
    });
  }

  async getRoutine(id: string) {
    if (!this.isUuid(id)) return null;
    const routine = await this.prisma.routine.findUnique({
      where: { id },
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
