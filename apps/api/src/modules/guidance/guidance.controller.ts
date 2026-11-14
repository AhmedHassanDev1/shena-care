import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { OptionalAuthGuard } from '../accounts/guards/optional-auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { Roles } from '../accounts/decorators/roles.decorator';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { CareService, RoutineCompatibilityService } from '../care/public';
import { ConsultationService } from './consultation/consultation.service';
import { CreateGuidanceSessionDto, RecommendationRequestDto, SendGuidanceMessageDto } from './dto/guidance.dto';
import { KnowledgeService } from './knowledge/knowledge.service';
import { RecommendationService } from './recommendation/recommendation.service';

const locale = (value?: string): 'ar' | 'en' => (value === 'en' ? 'en' : 'ar');

/**
 * The care consultation. Signed-in customers only: a session belongs to one customer and every call spends model budget.
 * A customer can only ever read or write their own session (checked in the service on every call).
 */
@Controller('guidance')
@UseGuards(AuthGuard)
export class GuidanceController {
  constructor(private readonly consultation: ConsultationService) {}

  @Post('sessions')
  createSession(@CurrentUser() customer: { id: string }, @Body() dto: CreateGuidanceSessionDto) {
    return this.consultation.createSession(customer.id, dto.page ?? null);
  }

  @Get('sessions/:sessionId')
  getSession(@CurrentUser() customer: { id: string }, @Param('sessionId') sessionId: string) {
    return this.consultation.getSession(customer.id, sessionId);
  }

  /** Re-runs the last turn when its answer failed (the customer's message is already saved). */
  @Post('sessions/:sessionId/retry')
  retry(@CurrentUser() customer: { id: string }, @Param('sessionId') sessionId: string) {
    return this.consultation.retryLast(customer.id, sessionId);
  }

  @Post('sessions/:sessionId/messages')
  sendMessage(@CurrentUser() customer: { id: string }, @Param('sessionId') sessionId: string, @Body() dto: SendGuidanceMessageDto) {
    return this.consultation.sendMessage(customer.id, sessionId, dto.content, dto.locale);
  }
}

/**
 * Deterministic care intelligence for discovery surfaces: recommendations and the sourced knowledge behind them.
 * Public and read-only (guests shop too), no model involved, so it keeps working when the AI provider is down.
 */
@Controller('guidance')
export class CareIntelligenceController {
  constructor(
    private readonly recommendations: RecommendationService,
    private readonly knowledge: KnowledgeService,
    private readonly compatibility: RoutineCompatibilityService,
    private readonly care: CareService,
  ) {}

  /** Concerns with how many orderable products are linked to each (the Corner index). */
  @Get('concerns')
  async concerns() {
    const concerns = (await this.care.getPublicConcerns()).map(c => ({ slug: c.slug, name: c.name, careArea: c.careArea as 'skin' | 'hair' }));
    return this.recommendations.concernShelf(concerns);
  }

  @Post('recommendations')
  @UseGuards(OptionalAuthGuard)
  async recommend(@CurrentUser() customer: { id: string } | undefined, @Body() dto: RecommendationRequestDto) {
    // A signed-in customer's saved safety answers apply unless this request states its own.
    const saved = await this.compatibility.savedSafety(customer?.id);
    const { locale: requested, safety, ...query } = dto;
    return this.recommendations.recommend({ ...query, safety: { ...saved, ...(safety ?? {}) } }, locale(requested));
  }

  @Get('knowledge/concerns/:slug')
  concernGuide(@Param('slug') slug: string, @Query('locale') requested?: string) {
    return this.knowledge.concernGuide(slug.toLowerCase().slice(0, 80), locale(requested));
  }

  @Get('knowledge/ingredients/:slug')
  ingredientGuide(@Param('slug') slug: string, @Query('locale') requested?: string) {
    return this.knowledge.ingredientGuide(slug.toLowerCase().slice(0, 80), locale(requested));
  }
}

/** Staff visibility into the AI spend and the review state of the knowledge base. */
@Controller('guidance/admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class GuidanceAdminController {
  constructor(private readonly consultation: ConsultationService, private readonly knowledge: KnowledgeService) {}

  @Get('usage')
  usage(@Query('days') days?: string) {
    return this.consultation.usageSummary(Number(days) || 7);
  }

  @Get('knowledge/coverage')
  coverage() {
    return this.knowledge.coverage();
  }
}
