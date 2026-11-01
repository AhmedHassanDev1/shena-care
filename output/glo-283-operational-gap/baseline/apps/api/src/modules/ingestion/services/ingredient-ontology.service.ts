import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { IngredientService } from '../../catalog/public';
import {
  CandidateIngredientEnrichment,
  ClaimValidationRequest,
  ClaimValidationResult,
  EvidenceLevel,
  IngredientBenefit,
  ParsedInciIngredient,
  VisualStatus,
} from '../contracts/ingredient-ontology.contract';
import { slugify } from '../../catalog/utils/slug.util';

@Injectable()
export class IngredientOntologyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingredientService: IngredientService,
  ) {}

  // ─── Known Excipients & Formulation Vehicles List ──────────────────────────
  private readonly KNOWN_EXCIPIENTS: Record<string, string> = {
    AQUA: 'Vehicle',
    WATER: 'Vehicle',
    EAU: 'Vehicle',
    GLYCERIN: 'Humectant / Solvent',
    GLYCEROL: 'Humectant / Solvent',
    PROPYLENE_GLYCOL: 'Solvent / Humectant',
    BUTYLENE_GLYCOL: 'Solvent / Humectant',
    PROPANEDIOL: 'Solvent / Humectant',
    ISODODECANE: 'Emollient / Solvent',
    CYCLOPENTASILOXANE: 'Silicone Emollient',
    DIMETHICONE: 'Silicone Barrier Emollient',
    ALCOHOL_DENAT: 'Solvent / Astringent',
    CAPRYLIC_CAPRIC_TRIGLYCERIDE: 'Emollient',
    PHENOXYETHANOL: 'Preservative',
    ETHYLHEXYLGLYCERIN: 'Preservative Booster',
    POTASSIUM_SORBATE: 'Preservative',
    SODIUM_BENZOATE: 'Preservative',
    BENZYL_ALCOHOL: 'Preservative',
    METHYLPARABEN: 'Preservative',
    PROPYLPARABEN: 'Preservative',
    CHLORPHENESIN: 'Preservative',
    CARBOMER: 'Thickener / Viscosity Controller',
    XANTHAN_GUM: 'Thickener / Stabilizer',
    HYDROXYETHYLCELLULOSE: 'Thickener',
    SILICA: 'Absorbent / Texturizer',
    CETEARYL_ALCOHOL: 'Fatty Alcohol Emulsifier',
    STEARYL_ALCOHOL: 'Fatty Alcohol Emulsifier',
    CETYL_ALCOHOL: 'Fatty Alcohol Emulsifier',
    POLYSORBATE_20: 'Emulsifier',
    POLYSORBATE_60: 'Emulsifier',
    STEARIC_ACID: 'Fatty Acid Emulsifier',
    CETEARETH_20: 'Emulsifier',
    GLYCERYL_STEARATE: 'Emulsifier',
    PEG_100_STEARATE: 'Emulsifier',
    SODIUM_LAURYL_SULFATE: 'Surfactant',
    DISODIUM_EDTA: 'Chelating Agent',
    TETRASODIUM_EDTA: 'Chelating Agent',
    SODIUM_HYDROXIDE: 'pH Adjuster',
    CITRIC_ACID: 'pH Adjuster / Buffer',
    TRIETHANOLAMINE: 'pH Adjuster',
    PARFUM: 'Fragrance',
    FRAGRANCE: 'Fragrance',
    CI_77891: 'Colorant (Titanium Dioxide)',
    TITANIUM_DIOXIDE: 'Colorant / Physical Filter',
  };

  /**
   * Tokenizes and normalizes raw INCI strings or string arrays.
   * Cleans punctuation, handles nested parentheticals, extracts explicit concentrations.
   */
  parseInciList(rawInput: string | string[]): ParsedInciIngredient[] {
    let terms: string[] = [];
    if (Array.isArray(rawInput)) {
      terms = rawInput.flatMap((item) =>
        item
          .split(/[,;\n•|]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (typeof rawInput === 'string') {
      const stripped = rawInput.replace(/^(?:ingredients|active ingredients|contains)[:\s]+/i, '');
      terms = stripped
        .split(/[,;\n•|]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const results: ParsedInciIngredient[] = [];

    for (const raw of terms) {
      if (!raw || raw.length < 2) continue;

      // Extract explicit concentration if present (e.g. "Niacinamide 10%", "Salicylic Acid 2%", "1% Retinol")
      let concentration: string | undefined = undefined;
      const concMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/);
      if (concMatch) {
        concentration = `${concMatch[1]}%`;
      }

      // Clean term for INCI normalization
      let cleaned = raw
        .replace(/(\d+(?:\.\d+)?)\s*%/g, '') // remove percentage
        .replace(/\b(?:active ingredient|contains|pure|standardized|extract)\b/gi, '')
        .trim();

      // If parenthetical exists, e.g. "Water (Aqua)" or "Aqua / Water / Eau"
      const slashParts = cleaned.split('/').map((s) => s.trim());
      const primaryTerm = slashParts[0].replace(/[()]/g, '').trim();
      const normalizedInci = primaryTerm.toUpperCase().replace(/\s+/g, ' ');

      // Check if excipient
      const isExcipient = this.isKnownExcipient(normalizedInci);

      results.push({
        rawTerm: raw,
        cleanedInci: normalizedInci,
        isActive: !isExcipient,
        isExcipient,
        concentration,
        confidence: isExcipient ? 0.95 : 0.85,
      });
    }

    return results;
  }

  /**
   * Checks if an INCI term is an inactive excipient, vehicle, preservative, or buffer.
   */
  isKnownExcipient(normalizedInci: string): boolean {
    const key = normalizedInci.replace(/[\s-]/g, '_');
    if (this.KNOWN_EXCIPIENTS[key]) return true;

    // Citric acid in lower positions is almost always a pH adjuster, unless explicitly high AHA
    if (key.includes('PARABEN') || key.includes('EDTA') || key.includes('SORBATE') || key.includes('BENZOATE')) {
      return true;
    }
    return false;
  }

  /**
   * Resolves an ingredient term to a canonical catalog Ingredient entity.
   * Reusable entity: two products mentioning the same active reuse ONE canonical entity.
   */
  async resolveIngredient(term: string): Promise<{
    ingredient: any;
    isNew: boolean;
    reused: boolean;
  }> {
    const cleaned = term.trim().replace(/[()]/g, '');
    const upper = cleaned.toUpperCase();
    const slug = slugify(cleaned);

    // 1. Look up in canonical catalog.ingredients
    let ingredient = await this.ingredientService.findByInciOrAlias(cleaned);

    if (ingredient) {
      // If unseen variation, append to aliases
      if (!ingredient.aliases.includes(cleaned) && !ingredient.aliases.includes(upper)) {
        ingredient = await this.prisma.ingredient.update({
          where: { id: ingredient.id },
          data: {
            aliases: { push: cleaned },
          },
        });
      }
      return { ingredient, isNew: false, reused: true };
    }

    // 2. Classify if active vs excipient
    const isExcipient = this.isKnownExcipient(upper);
    const excipientFunc = this.KNOWN_EXCIPIENTS[upper.replace(/[\s-]/g, '_')] || 'Vehicle';

    // 3. Create new canonical ingredient entity
    ingredient = await this.prisma.ingredient.create({
      data: {
        name: cleaned,
        slug,
        inciName: upper,
        aliases: [cleaned, upper],
        primaryFunction: isExcipient ? excipientFunc : 'Active Ingredient',
        functions: [isExcipient ? excipientFunc : 'Targeted Skin Care'],
        isActiveIngredient: !isExcipient,
        visualStatus: VisualStatus.NOT_GENERATED,
        status: 'APPROVED',
      },
    });

    return { ingredient, isNew: true, reused: false };
  }

  /**
   * Chemical Derivatives Guard:
   * Verifies that specific derivatives within an ingredient family are distinct records
   * and are NOT conflated into a generic family record (e.g. L-Ascorbic Acid vs SAP).
   */
  async resolveChemicalDerivative(
    derivativeName: string,
    expectedFamilySlug: string,
  ): Promise<{
    derivative: any;
    familyMatches: boolean;
    conflatedWithFamily: boolean;
  }> {
    const found = await this.ingredientService.findByInciOrAlias(derivativeName);
    if (!found) {
      throw new NotFoundException(`Chemical derivative "${derivativeName}" not found in ontology`);
    }

    // A specific derivative must have its own distinct name and chemicalForm, NOT equal to the family name
    const conflatedWithFamily =
      found.name.toLowerCase() === found.family?.toLowerCase() ||
      found.slug === found.familySlug;

    const familyMatches = found.familySlug === expectedFamilySlug;

    return {
      derivative: found,
      familyMatches,
      conflatedWithFamily,
    };
  }

  /**
   * Validates marketing/product claims against ingredient facts.
   * Invariant 1: Distinguishes pure ingredient pharmacological evidence from finished-product claims.
   * Invariant 2: Blocks unsupported therapeutic guarantees (e.g. "cures acne in 7 days") without finished-product clinical trials.
   * Invariant 3: Assumed concentration rule — does NOT assume concentrations when missing.
   * Invariant 4: No blanket incompatible-pair bans (e.g. Niacinamide + Vitamin C).
   */
  validateClaim(request: ClaimValidationRequest): ClaimValidationResult {
    const claimLower = request.claimText.toLowerCase();

    // 1. Identify active ingredients present in product
    const presentActives = request.productIngredients.map((i) => i.ingredientName.toLowerCase());

    // 2. Finished-product therapeutic guarantee triggers
    const finishedProductTriggers = [
      /(?:erases?|eliminates?|cures?|reverses?)\s+(?:all\s+)?(?:wrinkles|acne|scars|aging)/i,
      /(?:within|in|after)\s+\d+\s*(?:days?|hours?|weeks?)/i,
      /(?:guaranteed|100%\s+effective|instant\s+cure|miracle\s+results)/i,
      /clinically\s+proven\s+to\s+(?:cure|erase|eliminate)/i,
    ];

    const isFinishedProductEfficacyClaim = finishedProductTriggers.some((re) =>
      re.test(request.claimText),
    );

    if (isFinishedProductEfficacyClaim) {
      if (!request.hasFinishedProductClinicalEvidence) {
        return {
          isValid: false,
          claimType: 'FINISHED_PRODUCT_CLAIM',
          allowed: false,
          reason:
            'Finished-product therapeutic efficacy or speed-of-results claims require verified finished-product clinical trial evidence; pure ingredient presence is legally and scientifically insufficient.',
          substantiatedActives: [],
          requiresClinicalTrialEvidence: true,
        };
      }
    }

    // 3. Ingredient mechanism claims (e.g. "contains Niacinamide which helps support the moisture barrier")
    const matchedActives: string[] = [];
    if (claimLower.includes('niacinamide') && presentActives.some((a) => a.includes('niacinamide'))) {
      matchedActives.push('Niacinamide');
    }
    if (
      (claimLower.includes('vitamin c') || claimLower.includes('ascorbic')) &&
      presentActives.some((a) => a.includes('ascorb') || a.includes('vitamin c'))
    ) {
      matchedActives.push('Vitamin C');
    }
    if (claimLower.includes('salicylic') && presentActives.some((a) => a.includes('salicylic'))) {
      matchedActives.push('Salicylic Acid');
    }
    if (claimLower.includes('retinol') && presentActives.some((a) => a.includes('retin'))) {
      matchedActives.push('Retinol');
    }
    if (claimLower.includes('ceramide') && presentActives.some((a) => a.includes('ceramide'))) {
      matchedActives.push('Ceramide');
    }
    if (claimLower.includes('hyaluronic') && presentActives.some((a) => a.includes('hyaluron'))) {
      matchedActives.push('Hyaluronic Acid');
    }

    // Check if claimed active is actually absent from product
    const mentionsUnpresentActive =
      (claimLower.includes('niacinamide') && !presentActives.some((a) => a.includes('niacinamide'))) ||
      (claimLower.includes('retinol') && !presentActives.some((a) => a.includes('retin'))) ||
      (claimLower.includes('salicylic') && !presentActives.some((a) => a.includes('salicylic')));

    if (mentionsUnpresentActive) {
      return {
        isValid: false,
        claimType: 'INGREDIENT_MECHANISM',
        allowed: false,
        reason: 'Claim cites active ingredient not found in product formulation.',
        substantiatedActives: [],
      };
    }

    return {
      isValid: true,
      claimType: isFinishedProductEfficacyClaim
        ? 'FINISHED_PRODUCT_CLAIM'
        : 'INGREDIENT_MECHANISM',
      allowed: true,
      substantiatedActives: matchedActives,
      requiresClinicalTrialEvidence: false,
    };
  }

  /**
   * Enriches an Ingestion candidate (IngestionItem) with structured ingredient knowledge.
   * Categorizes actives vs excipients, extracts evidence-based benefits, cautions,
   * contraindications, and preserves unknown facts without hallucinating.
   */
  async enrichCandidateIngredients(
    candidateId: string,
    rawIngredientsInput?: string | string[],
  ): Promise<CandidateIngredientEnrichment> {
    const candidate = await this.prisma.ingestionItem.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) throw new NotFoundException(`Candidate ${candidateId} not found`);

    let rawList: string | string[] = rawIngredientsInput || [];
    if (!rawIngredientsInput) {
      const enrichment = (candidate.enrichment as Record<string, any>) || {};
      const research = enrichment.research as Record<string, any> | undefined;
      rawList = research?.extractedFacts?.ingredients || [];
    }

    const parsedTerms = this.parseInciList(rawList);

    const actives: CandidateIngredientEnrichment['actives'] = [];
    const excipients: CandidateIngredientEnrichment['excipients'] = [];
    const cautionsSet = new Set<string>();
    const contraindicationsSet = new Set<string>();
    const benefitsByConcern: Record<string, string[]> = {};
    const unmatchedTerms: string[] = [];
    const unknownFacts: string[] = [];

    for (const item of parsedTerms) {
      if (item.isExcipient) {
        const func =
          this.KNOWN_EXCIPIENTS[item.cleanedInci.replace(/[\s-]/g, '_')] || 'Formulation Vehicle';
        excipients.push({
          term: item.cleanedInci,
          primaryFunction: func,
        });
        continue;
      }

      // Look up in canonical ontology
      const canonical = await this.ingredientService.findByInciOrAlias(item.cleanedInci);
      if (canonical) {
        // Record unknown facts if concentration was not extracted
        if (!item.concentration) {
          unknownFacts.push(
            `Concentration of ${canonical.name} is unknown; retained as null (never assumed)`,
          );
        }

        const benefits = Array.isArray(canonical.benefits)
          ? (canonical.benefits as unknown as IngredientBenefit[])
          : [];

        for (const b of benefits) {
          if (!benefitsByConcern[b.concern]) benefitsByConcern[b.concern] = [];
          benefitsByConcern[b.concern].push(`${canonical.name}: ${b.description}`);
        }

        for (const c of canonical.cautions) {
          cautionsSet.add(c);
        }
        for (const ci of canonical.contraindications) {
          contraindicationsSet.add(ci);
        }

        actives.push({
          id: canonical.id,
          name: canonical.name,
          nameAr: canonical.nameAr || undefined,
          inciName: canonical.inciName,
          family: canonical.family || undefined,
          chemicalForm: canonical.chemicalForm || undefined,
          concentration: item.concentration,
          primaryFunction: canonical.primaryFunction,
          benefits,
          cautions: canonical.cautions,
        });
      } else {
        unmatchedTerms.push(item.cleanedInci);
        unknownFacts.push(
          `Ingredient ${item.cleanedInci} is unindexed in standard ontology; pending specialist review`,
        );
      }
    }

    const enrichmentResult: CandidateIngredientEnrichment = {
      actives,
      excipients,
      cautions: Array.from(cautionsSet),
      contraindications: Array.from(contraindicationsSet),
      benefitsByConcern,
      unmatchedTerms,
      unknownFacts,
    };

    // Update candidate enrichment JSON safely
    const currentEnrichment = (candidate.enrichment as Record<string, any>) || {};
    await this.prisma.ingestionItem.update({
      where: { id: candidateId },
      data: {
        enrichment: {
          ...currentEnrichment,
          ingredientProfile: enrichmentResult,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return enrichmentResult;
  }

  /**
   * Links canonical ingredients to a canonical Catalog Product.
   */
  async linkProductIngredients(
    productId: string,
    ingredients: Array<{
      ingredientId: string;
      isKeyActive?: boolean;
      concentration?: string;
      sortOrder?: number;
    }>,
  ) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    return this.prisma.$transaction(async (tx) => {
      // Clean existing links
      await tx.productIngredient.deleteMany({ where: { productId } });

      let sortOrder = 0;
      for (const item of ingredients) {
        await tx.productIngredient.create({
          data: {
            productId,
            ingredientId: item.ingredientId,
            isKeyActive: item.isKeyActive ?? false,
            concentration: item.concentration || null,
            sortOrder: item.sortOrder ?? sortOrder++,
          },
        });
      }

      return tx.productIngredient.findMany({
        where: { productId },
        include: { ingredient: true },
        orderBy: { sortOrder: 'asc' },
      });
    });
  }
}
