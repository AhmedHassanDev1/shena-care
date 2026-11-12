import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import {
  CatalogPolicyService,
  CatalogSnapshotService,
  EvaluatePolicyDto,
  UpdateCatalogPolicyDto,
} from '../../../modules/catalog/public';
import {
  BrandDetector,
  BrandHit,
  EXCLUDED_CLASSES,
  ScopeGate,
  excludedClassesIn,
} from '../../../modules/intake/public';

type RequestUser = { id: string };

const SYSTEM_EXCLUDED_CLASSES = Object.entries(EXCLUDED_CLASSES).map(([key, phrases]) => ({
  key,
  phraseCount: phrases.length,
  samplePhrases: phrases.slice(0, 8),
}));

@Controller('catalog/policy')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class CatalogPolicyController {
  constructor(
    private readonly policyService: CatalogPolicyService,
    private readonly snapshotService: CatalogSnapshotService,
  ) {}

  @Get()
  async getPolicy() {
    const state = await this.policyService.getPolicyState();
    return {
      ...state,
      systemExcludedClasses: SYSTEM_EXCLUDED_CLASSES,
    };
  }

  @Put()
  async updatePolicy(@Body() dto: UpdateCatalogPolicyDto, @CurrentUser() user: RequestUser) {
    const state = await this.policyService.updatePolicy(dto, user.id);
    return {
      saved: true,
      ...state,
      systemExcludedClasses: SYSTEM_EXCLUDED_CLASSES,
    };
  }

  @Post('evaluate')
  async evaluate(@Body() dto: EvaluatePolicyDto) {
    const snapshot = await this.snapshotService.identitySnapshot();
    const detector = new BrandDetector(snapshot.brands);
    const gate = new ScopeGate(snapshot);

    const evaluationText =
      dto.brandName &&
      !dto.title.toLowerCase().includes(dto.brandName.trim().toLowerCase())
        ? `${dto.brandName.trim()} ${dto.title.trim()}`
        : dto.title.trim();

    const detectedHits = detector.detect(evaluationText);
    const catalogBrands: BrandHit[] = [...detectedHits];

    if (dto.brandId && !catalogBrands.some((hit) => hit.brandId === dto.brandId)) {
      const explicitBrand = snapshot.brands.find((b) => b.id === dto.brandId);
      if (explicitBrand) {
        catalogBrands.unshift({
          brandId: explicitBrand.id,
          label: explicitBrand.name,
          basis: 'EXACT',
          start: 0,
          end: 0,
        });
      }
    }

    const hardIdentifier = Boolean(dto.hasHardIdentifier || dto.barcode?.trim());
    const verdict = gate.decide({
      name: evaluationText,
      catalogBrands,
      categoryId: dto.categoryId ?? null,
      hardIdentifier,
    });

    const outcome: 'ALLOW' | 'SKIP' | 'REVIEW' =
      verdict.decision === 'SKIP'
        ? 'SKIP'
        : verdict.reasonCode === 'UNKNOWN_SCOPE'
          ? 'REVIEW'
          : 'ALLOW';

    return {
      outcome,
      decision: verdict.decision,
      reasonCode: verdict.reasonCode,
      detail: verdict.detail ?? null,
      mode: snapshot.policyMode ?? 'OPEN',
      policyVersion: snapshot.policyVersion,
      matchedBrands: catalogBrands.map((hit) => ({
        brandId: hit.brandId,
        label: hit.label,
        basis: hit.basis,
      })),
      excludedClassesDetected: excludedClassesIn(evaluationText),
    };
  }
}
