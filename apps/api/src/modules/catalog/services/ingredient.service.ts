import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import {
  CanonicalIngredientData,
  EvidenceLevel,
  VisualStatus,
} from '../../ingestion/contracts/ingredient-ontology.contract';
import { slugify } from '../utils/slug.util';

@Injectable()
export class IngredientService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or updates a canonical ingredient entity.
   */
  async createOrUpdateIngredient(data: CanonicalIngredientData) {
    const slug = data.slug || slugify(data.name);
    const existing = await this.prisma.ingredient.findFirst({
      where: {
        OR: [{ slug }, { name: { equals: data.name, mode: 'insensitive' } }],
      },
    });

    const createPayload: Prisma.IngredientCreateInput = {
      name: data.name,
      nameAr: data.nameAr || null,
      slug,
      inciName: data.inciName.toUpperCase().trim(),
      aliases: data.aliases || [],
      family: data.family || null,
      familySlug: data.familySlug || (data.family ? slugify(data.family) : null),
      chemicalForm: data.chemicalForm || null,
      primaryFunction: data.primaryFunction,
      functions: data.functions || [],
      isActiveIngredient: data.isActiveIngredient ?? false,
      rating: data.rating || null,
      descriptionEn: data.descriptionEn || null,
      descriptionAr: data.descriptionAr || null,
      benefits: (data.benefits as unknown as Prisma.InputJsonValue) || Prisma.JsonNull,
      cautions: data.cautions || [],
      contraindications: data.contraindications || [],
      visualStatus: data.visualStatus || VisualStatus.NOT_GENERATED,
      visualUrl: data.visualUrl || null,
      status: 'APPROVED',
    };

    if (existing) {
      return this.prisma.ingredient.update({
        where: { id: existing.id },
        data: {
          nameAr: data.nameAr ?? existing.nameAr,
          inciName: data.inciName.toUpperCase().trim(),
          aliases: Array.from(new Set([...existing.aliases, ...(data.aliases || [])])),
          family: data.family ?? existing.family,
          familySlug: data.familySlug ?? existing.familySlug,
          chemicalForm: data.chemicalForm ?? existing.chemicalForm,
          primaryFunction: data.primaryFunction ?? existing.primaryFunction,
          functions: data.functions ?? existing.functions,
          isActiveIngredient: data.isActiveIngredient ?? existing.isActiveIngredient,
          rating: data.rating ?? existing.rating,
          descriptionEn: data.descriptionEn ?? existing.descriptionEn,
          descriptionAr: data.descriptionAr ?? existing.descriptionAr,
          benefits: (data.benefits as unknown as Prisma.InputJsonValue) ?? (existing.benefits as any),
          cautions: Array.from(new Set([...existing.cautions, ...(data.cautions || [])])),
          contraindications: Array.from(
            new Set([...existing.contraindications, ...(data.contraindications || [])]),
          ),
          visualStatus: data.visualStatus ?? existing.visualStatus,
          visualUrl: data.visualUrl ?? existing.visualUrl,
        },
      });
    }

    return this.prisma.ingredient.create({
      data: createPayload,
    });
  }

  async getIngredient(id: string) {
    const item = await this.prisma.ingredient.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Ingredient with ID ${id} not found`);
    return item;
  }

  async getIngredientBySlug(slug: string) {
    return this.prisma.ingredient.findUnique({ where: { slug } });
  }

  /**
   * Fast resolution against canonical name, slug, INCI name, or aliases.
   */
  async findByInciOrAlias(term: string) {
    const cleaned = term.trim().replace(/[()]/g, '');
    const upper = cleaned.toUpperCase();
    const slug = slugify(cleaned);

    return this.prisma.ingredient.findFirst({
      where: {
        OR: [
          { inciName: upper },
          { name: { equals: cleaned, mode: 'insensitive' } },
          { nameAr: { equals: cleaned, mode: 'insensitive' } },
          { slug },
          { aliases: { has: cleaned } },
          { aliases: { has: upper } },
        ],
      },
    });
  }

  /**
   * List all distinct chemical derivatives belonging to a family (e.g. "vitamin-c").
   */
  async listByFamily(familySlug: string) {
    return this.prisma.ingredient.findMany({
      where: { familySlug },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * List all canonical ingredients with optional filter.
   */
  async listAll(filter?: { isActive?: boolean; familySlug?: string }) {
    return this.prisma.ingredient.findMany({
      where: {
        ...(filter?.isActive !== undefined && { isActiveIngredient: filter.isActive }),
        ...(filter?.familySlug && { familySlug: filter.familySlug }),
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Seeds the standard ShinaCare dermatological ingredient knowledge ontology.
   * Guarantees that chemical derivatives within families are distinct and non-conflated.
   */
  async seedStandardOntology(): Promise<number> {
    const standardActives: CanonicalIngredientData[] = [
      // ─── Vitamin C Family (distinct chemical derivatives) ───────────────────
      {
        name: 'Ascorbic Acid',
        nameAr: 'حمض الأسكوربيك (فيتامين سي النقي)',
        slug: 'ascorbic-acid',
        inciName: 'ASCORBIC ACID',
        aliases: ['L-Ascorbic Acid', 'Pure Vitamin C', 'فيتامين سي النقي', 'L-ascorbic acid'],
        family: 'Vitamin C',
        familySlug: 'vitamin-c',
        chemicalForm: 'Pure L-Ascorbic Acid',
        primaryFunction: 'Antioxidant',
        functions: ['Collagen Synthesis', 'Skin Brightening', 'Photoprotection'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Pure, biologically active form of Vitamin C. Powerful antioxidant that neutralizes free radicals, boosts collagen synthesis, and fades hyperpigmentation at low pH levels (pH < 3.5). Highly prone to oxidation.',
        descriptionAr:
          'الشكل النقي والفعال بيولوجياً لفيتامين سي. مضاد أكسدة قوي يحفز إنتاج الكولاجين ويفتح التصبغات، ولكنه سريع التأكسد ويتطلب صياغة بدرجة حموضة منخفضة.',
        benefits: [
          {
            concern: 'hyperpigmentation',
            description: 'Inhibits tyrosinase activity to reduce melanin formation and lighten dark spots',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 1540004',
          },
          {
            concern: 'anti_aging',
            description: 'Essential cofactor for prolyl and lysyl hydroxylase in enzymatic collagen synthesis',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 18505499',
          },
        ],
        cautions: [
          'Can cause stinging or erythema on sensitive skin due to low formulation pH',
          'Oxidizes rapidly when exposed to air and light (turns amber/brown)',
        ],
        contraindications: ['COMPROMISED_BARRIER', 'ACTIVE_ECZEMA_FLARE'],
      },
      {
        name: 'Sodium Ascorbyl Phosphate',
        nameAr: 'فوسفات أسكوربيل الصوديوم',
        slug: 'sodium-ascorbyl-phosphate',
        inciName: 'SODIUM ASCORBYL PHOSPHATE',
        aliases: ['SAP', 'Vitamin C Phosphate Salt', 'فوسفات أسكوربيل الصوديوم'],
        family: 'Vitamin C',
        familySlug: 'vitamin-c',
        chemicalForm: 'Water-Soluble Monophosphate Salt',
        primaryFunction: 'Antioxidant',
        functions: ['Antimicrobial', 'Acne Care', 'Brightening'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Stable, water-soluble salt derivative of Vitamin C. Cleaved to ascorbic acid enzymatically in the skin. Demonstrates proven antimicrobial and lipid peroxidation inhibitory activity against Cutibacterium acnes.',
        descriptionAr:
          'مشتق ملحي مستقر وقابل للذوبان في الماء لفيتامين سي، يتحول إنزيمياً إلى فيتامين سي في الجلد، وله فعالية مثبتة مضادة للميكروبات لعلاج حب الشباب.',
        benefits: [
          {
            concern: 'acne',
            description: 'Prevents squalene peroxidation and inhibits Cutibacterium acnes proliferation at 1-5% concentrations',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 19134124',
          },
          {
            concern: 'hyperpigmentation',
            description: 'Gentle tyrosinase inhibition suitable for acne-prone and reactive skin types',
            evidenceLevel: EvidenceLevel.MODERATE_EVIDENCE,
          },
        ],
        cautions: ['Significantly more stable and gentler than L-ascorbic acid, but converts at lower efficiency'],
        contraindications: [],
      },
      {
        name: 'Ascorbyl Glucoside',
        nameAr: 'أسكوربيل جلوكوزيد',
        slug: 'ascorbyl-glucoside',
        inciName: 'ASCORBYL GLUCOSIDE',
        aliases: ['AA-2G', 'Vitamin C Glucoside', 'أسكوربيل جلوكوزيد'],
        family: 'Vitamin C',
        familySlug: 'vitamin-c',
        chemicalForm: 'Glucose-Conjugated Ester',
        primaryFunction: 'Antioxidant',
        functions: ['Skin Brightening', 'Even Tone'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Vitamin C stabilized with glucose. Converted to ascorbic acid gradually via alpha-glucosidase enzyme in skin, offering sustained brightening with minimal irritation.',
        descriptionAr:
          'فيتامين سي مستقر مع الجلوكوز يتحول تدريجياً في البشرة بواسطة إنزيم ألفا جلوكوزيداز ليمنح تفتيحاً تدريجياً بدون تهيج.',
        benefits: [
          {
            concern: 'hyperpigmentation',
            description: 'Sustained release tyrosinase suppression for even skin tone',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: [],
        contraindications: [],
      },
      {
        name: '3-O-Ethyl Ascorbic Acid',
        nameAr: '3-أو-إيثيل حمض الأسكوربيك',
        slug: '3-o-ethyl-ascorbic-acid',
        inciName: 'ETHYL ASCORBIC ACID',
        aliases: ['Ethyl Ascorbic Acid', '3-O-Ethyl-L-ascorbic acid', 'إيثيل فيتامين سي'],
        family: 'Vitamin C',
        familySlug: 'vitamin-c',
        chemicalForm: 'Ether Derivative (Amphiphilic)',
        primaryFunction: 'Antioxidant',
        functions: ['Brightening', 'Collagen Booster'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Next-generation amphiphilic Vitamin C ether. Highly stable against light and temperature, penetrates both lipid and aqueous skin layers.',
        descriptionAr: 'مشتق إيثر حديث لفيتامين سي عالي الاستقرار ضد الضوء والحرارة ويخترق طبقات الجلد المائية والدهنية.',
        benefits: [
          {
            concern: 'hyperpigmentation',
            description: 'Direct inhibition of tyrosinase and TRP-2 without requiring enzymatic cleavage',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: [],
        contraindications: [],
      },

      // ─── Retinoids Family (distinct derivatives) ───────────────────────────
      {
        name: 'Retinol',
        nameAr: 'ريتينول',
        slug: 'retinol',
        inciName: 'RETINOL',
        aliases: ['Vitamin A', 'Pure Retinol', 'فيتامين أ'],
        family: 'Retinoids',
        familySlug: 'retinoids',
        chemicalForm: 'Alcohol Form (2-Step Oxidation)',
        primaryFunction: 'Skin Restoring',
        functions: ['Cellular Turnover', 'Collagen Booster', 'Fine Line Smoothing'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Gold standard cosmetic retinoid. Undergoes 2-step intracellular oxidation (Retinol -> Retinal -> Retinoic Acid) to bind retinoic acid receptors (RAR/RXR), upregulating procollagen and normalizing keratinization.',
        descriptionAr:
          'المعيار الذهبي لمشتقات فيتامين أ التجميلية. يتحول داخل الخلايا بخطوتين إلى حمض الريتينويك لتحفيز تجديد الخلايا وإنتاج الكولاجين.',
        benefits: [
          {
            concern: 'anti_aging',
            description: 'Increases dermal extracellular matrix synthesis and reduces matrix metalloproteinases (MMP)',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 17515510',
          },
          {
            concern: 'pores',
            description: 'Normalizes follicular desquamation preventing microcomedone formation',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: [
          'Sun sensitivity — mandatory broad-spectrum sunscreen application during daytime',
          'May cause retinization symptoms: dryness, flaking, redness during initial 2-4 weeks',
          'Introduce gradually (1-2 nights per week initially)',
        ],
        contraindications: ['PREGNANCY', 'BREASTFEEDING', 'ACTIVE_ROSACEA_FLARE'],
      },
      {
        name: 'Retinal',
        nameAr: 'ريتينال (ريتينالدهيد)',
        slug: 'retinal',
        inciName: 'RETINAL',
        aliases: ['Retinaldehyde', 'Vitamin A Aldehyde', 'ريتينالدهيد'],
        family: 'Retinoids',
        familySlug: 'retinoids',
        chemicalForm: 'Aldehyde Form (1-Step Oxidation)',
        primaryFunction: 'Skin Restoring',
        functions: ['Antibacterial', 'Cellular Turnover', 'Collagen Booster'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Direct precursor to retinoic acid requiring only a single conversion step. Works up to 11x faster than retinol while demonstrating direct antibacterial properties against C. acnes.',
        descriptionAr:
          'المقدمة المباشرة لحمض الريتينويك يحتاج خطوة واحدة فقط للتحول، ويعمل أسرع من الريتينول وله خصائص مضادة للبكتيريا.',
        benefits: [
          {
            concern: 'anti_aging',
            description: 'One-step oxidation to retinoic acid delivers rapid cellular regeneration with high dermal tolerance',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 9843009',
          },
          {
            concern: 'acne',
            description: 'Direct bactericidal activity against Cutibacterium acnes in sebaceous ducts',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: ['Daily SPF required', 'Introduce gradually'],
        contraindications: ['PREGNANCY', 'BREASTFEEDING'],
      },
      {
        name: 'Hydroxypinacolone Retinoate',
        nameAr: 'هيدروكسي بيناكولون ريتينوات (جراناكتيف ريتينويد)',
        slug: 'hydroxypinacolone-retinoate',
        inciName: 'HYDROXYPINACOLONE RETINOATE',
        aliases: ['HPR', 'Granactive Retinoid', 'جراناكتيف ريتينويد'],
        family: 'Retinoids',
        familySlug: 'retinoids',
        chemicalForm: 'Direct Retinoic Acid Ester',
        primaryFunction: 'Skin Restoring',
        functions: ['Cellular Turnover', 'Low Irritation'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Next-generation cosmetic retinoate that directly binds retinoic acid receptors without requiring metabolic conversion, providing high efficacy with minimal cutaneous irritation.',
        descriptionAr:
          'مشتق ريتينويد متطور يرتبط مباشرة بمستقبلات حمض الريتينويك دون الحاجة لتحول، مما يعطي فعالية عالية مع تهيج منخفض جداً.',
        benefits: [
          {
            concern: 'anti_aging',
            description: 'Direct receptor transcription with dramatically lower transepidermal water loss and erythema',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: ['Daily SPF recommended'],
        contraindications: ['PREGNANCY'],
      },

      // ─── Hydroxy Acids Family (AHA / BHA / PHA) ───────────────────────────
      {
        name: 'Glycolic Acid',
        nameAr: 'حمض الجليكوليك',
        slug: 'glycolic-acid',
        inciName: 'GLYCOLIC ACID',
        aliases: ['AHA', 'Alpha Hydroxy Acid', 'حمض ألفا هيدروكسي'],
        family: 'Hydroxy Acids',
        familySlug: 'hydroxy-acids',
        chemicalForm: 'Small-Chain Alpha Hydroxy Acid',
        primaryFunction: 'Exfoliant',
        functions: ['Keratolytic', 'Skin Texture', 'Cell Renewal'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Smallest molecular weight AHA (76 Da), allowing deep penetration into stratum corneum to dissolve desmosomes connecting corneocytes. Promotes shedding and cell renewal.',
        descriptionAr:
          'أصغر حمض ألفا هيدروكسي حجماً جزيئياً، يخترق طبقة الجلد السطحية بعمق ليذيب الروابط بين الخلايا الميتة ويجدد البشرة.',
        benefits: [
          {
            concern: 'hyperpigmentation',
            description: 'Accelerates epidermopoiesis to disperse accumulated basal epidermal melanin',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: ['Increases skin photosensitivity to UV radiation; daytime sunscreen mandatory'],
        contraindications: ['COMPROMISED_BARRIER', 'SUNBURNED_SKIN'],
      },
      {
        name: 'Salicylic Acid',
        nameAr: 'حمض الساليسيليك',
        slug: 'salicylic-acid',
        inciName: 'SALICYLIC ACID',
        aliases: ['BHA', 'Beta Hydroxy Acid', 'حمض بيتا هيدروكسي'],
        family: 'Hydroxy Acids',
        familySlug: 'hydroxy-acids',
        chemicalForm: 'Lipophilic Beta Hydroxy Acid',
        primaryFunction: 'Exfoliant',
        functions: ['Pore Decongesting', 'Anti-Inflammatory', 'Sebum Clearing'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Lipid-soluble BHA capable of penetrating through sebum into the pilosebaceous unit. Exfoliates pore linings, dissolves oxidized sebum, and possesses intrinsic anti-inflammatory properties.',
        descriptionAr:
          'حمض بيتا هيدروكسي محب للدهون يخترق المسام وينظف الزهم المتراكم وله خواص مضادة للالتهاب.',
        benefits: [
          {
            concern: 'acne',
            description: 'Penetrates sebaceous follicles to clear microcomedones and suppress inflammation',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 1535287',
          },
          {
            concern: 'pores',
            description: 'Reduces apparent pore diameter by clearing follicular debris',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: ['May cause dryness if overused or combined with multiple direct acids'],
        contraindications: ['ASPIRIN_ALLERGY'],
      },
      {
        name: 'Lactic Acid',
        nameAr: 'حمض اللاكتيك',
        slug: 'lactic-acid',
        inciName: 'LACTIC ACID',
        aliases: ['AHA Lactic', 'حمض اللبن'],
        family: 'Hydroxy Acids',
        familySlug: 'hydroxy-acids',
        chemicalForm: 'Humectant Alpha Hydroxy Acid',
        primaryFunction: 'Exfoliant',
        functions: ['Humectant', 'Gentle Exfoliation'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Larger molecular weight AHA with intrinsic humectant properties as a natural component of NMF (Natural Moisturizing Factor). Exfoliates gently while boosting hydration.',
        descriptionAr: 'حمض ألفا هيدروكسي ذو حجم جزيئي أكبر مع ترطيب طبيعي مدمج يناسب البشرة الجافة والحساسة.',
        benefits: [
          {
            concern: 'hydration',
            description: 'Component of Natural Moisturizing Factor that increases stratum corneum ceramides',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: ['Increases sun sensitivity; daily SPF recommended'],
        contraindications: [],
      },

      // ─── Niacinamide Family ────────────────────────────────────────────────
      {
        name: 'Niacinamide',
        nameAr: 'نياسيناميد (فيتامين ب3)',
        slug: 'niacinamide',
        inciName: 'NIACINAMIDE',
        aliases: ['Vitamin B3', 'Nicotinamide', 'فيتامين ب3', 'نياسيناميد', 'nicotinamide'],
        family: 'Niacinamide',
        familySlug: 'niacinamide',
        chemicalForm: 'Active Amide of Nicotinic Acid',
        primaryFunction: 'Barrier Support',
        functions: ['Sebum Regulation', 'Brightening', 'Soothing', 'Pore Refinement'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Biologically active amide of Vitamin B3. Precursor to coenzymes NAD+/NADP+. Clinically proven to stimulate ceramide and free fatty acid synthesis, inhibit melanosome transfer, downregulate sebum, and reduce redness.',
        descriptionAr:
          'الشكل الفعال لفيتامين ب3، يحفز إنتاج السيراميد الطبيعي في الحاجز الواقي، وينظم إفراز الدهون، ويمنع انتقال الميلانين لتفتيح التصبغات، ويهدئ الاحمرار.',
        benefits: [
          {
            concern: 'barrier_repair',
            description: 'Upregulates synthesis of epidermal ceramides and glucosylceramides by up to 5-fold',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 10971324',
          },
          {
            concern: 'hyperpigmentation',
            description: 'Reversibly inhibits 35-68% of melanosome transfer from melanocytes to keratinocytes',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 12100180',
          },
          {
            concern: 'pores',
            description: 'Downregulates sebaceous gland lipogenesis, reducing sebum output and pore congestion',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: [
          'High concentrations (>10%) may cause transient flushing or irritation in sensitive individuals',
        ],
        contraindications: [],
      },

      // ─── Hyaluronic Acid Family (distinct forms) ───────────────────────────
      {
        name: 'Sodium Hyaluronate',
        nameAr: 'هيالورونات الصوديوم',
        slug: 'sodium-hyaluronate',
        inciName: 'SODIUM HYALURONATE',
        aliases: ['Hyaluronic Acid Salt', 'هيالورونات الصوديوم'],
        family: 'Hyaluronic Acid',
        familySlug: 'hyaluronic-acid',
        chemicalForm: 'Sodium Salt of Hyaluronic Acid',
        primaryFunction: 'Humectant',
        functions: ['Moisture Binding', 'Plumping'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Salt form of hyaluronic acid with smaller molecular size than native HA. Holds up to 1000 times its weight in water, binding moisture within superficial epidermis.',
        descriptionAr: 'الملح المستقر لحمض الهيالورونيك، يرتبط بما يصل إلى 1000 ضعف وزنه من الماء لترطيب ملحوظ.',
        benefits: [
          {
            concern: 'hydration',
            description: 'High water-binding capacity enhances epidermal hydration and smooths dry fine lines',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: [],
        contraindications: [],
      },
      {
        name: 'Hydrolyzed Hyaluronic Acid',
        nameAr: 'حمض الهيالورونيك المتحلل',
        slug: 'hydrolyzed-hyaluronic-acid',
        inciName: 'HYDROLYZED HYALURONIC ACID',
        aliases: ['Low Molecular Weight HA', 'حمض الهيالورونيك منخفض الوزن الجزيئي'],
        family: 'Hyaluronic Acid',
        familySlug: 'hyaluronic-acid',
        chemicalForm: 'Low Molecular Weight Oligosaccharide',
        primaryFunction: 'Humectant',
        functions: ['Deep Hydration', 'Barrier Support'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Low molecular weight fraction of hyaluronic acid capable of traversing deeper strata of the epidermis to stimulate endogenous HA production.',
        descriptionAr: 'حمض هيالورونيك منخفض الوزن الجزيئي يخترق طبقات أعمق من البشرة ويحفز الترطيب الداخلي.',
        benefits: [
          {
            concern: 'hydration',
            description: 'Deep epidermic penetration supporting cellular hydration',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: [],
        contraindications: [],
      },

      // ─── Ceramides Family ──────────────────────────────────────────────────
      {
        name: 'Ceramide NP',
        nameAr: 'سيراميد إن بي (سيراميد 3)',
        slug: 'ceramide-np',
        inciName: 'CERAMIDE NP',
        aliases: ['Ceramide 3', 'سيراميد 3', 'سيراميد إن بي'],
        family: 'Ceramides',
        familySlug: 'ceramides',
        chemicalForm: 'Phytosphingosine-Based Ceramide',
        primaryFunction: 'Barrier Support',
        functions: ['Lipid Barrier Restoration', 'Moisture Retention'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Identical to human epidermal lipid. Forms the lamellar sheet structure of intercellular lipid bilayers in stratum corneum, preventing transepidermal water loss (TEWL).',
        descriptionAr: 'مطابق لدهون حاجز البشرة الطبيعية، يرمم الطبقة الدهنية الواقية ويمنع فقدان الرطوبة عبر الجلد.',
        benefits: [
          {
            concern: 'barrier_repair',
            description: 'Restores defective stratum corneum lipid matrix and reduces transepidermal water loss',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 12553851',
          },
        ],
        cautions: [],
        contraindications: [],
      },

      // ─── Soothing & Targeted Actives ────────────────────────────────────────
      {
        name: 'Azelaic Acid',
        nameAr: 'حمض الأزيليك',
        slug: 'azelaic-acid',
        inciName: 'AZELAIC ACID',
        aliases: ['حمض الأزيليك', 'Dicarboxylic Acid'],
        family: 'Azelaic Acid',
        familySlug: 'azelaic-acid',
        chemicalForm: 'Saturated Dicarboxylic Acid',
        primaryFunction: 'Soothing',
        functions: ['Anti-Inflammatory', 'Tyrosinase Inhibition', 'Anti-Redness', 'Acne Care'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Naturally occurring dicarboxylic acid. Inhibits tyrosinase, reduces reactive oxygen species, downregulates kallikrein-5 and cathelicidin in rosacea, and possesses bacteriostatic activity against C. acnes.',
        descriptionAr:
          'حمض طبيعي مضاد للالتهاب والتصبغات، يقلل احمرار الوردية ويحارب بكتيريا حب الشباب بدون التسبب في حساسية للضوء.',
        benefits: [
          {
            concern: 'redness',
            description: 'Suppresses inflammatory serine protease cascades in rosacea-prone skin',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 17111473',
          },
          {
            concern: 'hyperpigmentation',
            description: 'Selectively targets hyperactive melanocytes with minimal effect on normally pigmented skin',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: ['May cause mild tingling during first few applications'],
        contraindications: [],
      },
      {
        name: 'Centella Asiatica Extract',
        nameAr: 'مستخلص سيكا (سينتيلا أسياتيكا)',
        slug: 'centella-asiatica-extract',
        inciName: 'CENTELLA ASIATICA EXTRACT',
        aliases: ['Cica', 'Gotu Kola', 'سيكا', 'سينتيلا'],
        family: 'Centella',
        familySlug: 'centella',
        chemicalForm: 'Triterpenoid Botanical Extract',
        primaryFunction: 'Soothing',
        functions: ['Wound Healing', 'Anti-Inflammatory', 'Barrier Calming'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Rich in bioactive triterpenic saponins (madecassoside, asiaticoside, madecassic acid, asiatic acid). Accelerates wound re-epithelialization and soothes compromised skin.',
        descriptionAr: 'غني بالمركبات المهدئة الفعالة (ماديكاسوسيد)، يسارع التئام الجلد ويهدئ الاحمرار والحروق والتهيج.',
        benefits: [
          {
            concern: 'redness',
            description: 'Inhibits inflammatory cytokines (IL-1beta, TNF-alpha) and accelerates collagen type I deposition',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
            pubmedRef: 'PMID: 23447474',
          },
        ],
        cautions: [],
        contraindications: [],
      },
      {
        name: 'Zinc PCA',
        nameAr: 'زنك بي سي إيه',
        slug: 'zinc-pca',
        inciName: 'ZINC PCA',
        aliases: ['Zinc Salt of Pyrrolidone Carboxylic Acid', 'زنك بي سي ايه'],
        family: 'Zinc',
        familySlug: 'zinc',
        chemicalForm: 'Physiological Zinc Salt',
        primaryFunction: 'Sebum Regulation',
        functions: ['Antimicrobial', 'Matte Finish'],
        isActiveIngredient: true,
        rating: 'BEST',
        descriptionEn:
          'Physiological zinc salt of L-pyrrolidone carboxylic acid. Inhibits 5-alpha reductase to regulate cutaneous sebum production and controls bacterial flora.',
        descriptionAr: 'مركب زنك فسيولوجي يقلل إفراز الدهون وينقي المسام من البكتيريا المسببة للبثور.',
        benefits: [
          {
            concern: 'acne',
            description: 'Suppresses AP-1 transcription and reduces sebaceous lipid secretion',
            evidenceLevel: EvidenceLevel.MODERATE_EVIDENCE,
          },
        ],
        cautions: [],
        contraindications: [],
      },

      // ─── Common Cosmetic Formulation Vehicles & Excipients ─────────────────
      {
        name: 'Water',
        nameAr: 'ماء نقي',
        slug: 'water',
        inciName: 'AQUA',
        aliases: ['Aqua', 'Eau', 'Water', 'Purified Water', 'ماء'],
        family: 'Vehicles',
        familySlug: 'vehicles',
        chemicalForm: 'Solvent Base',
        primaryFunction: 'Vehicle',
        functions: ['Solvent', 'Base'],
        isActiveIngredient: false,
        rating: 'AVERAGE',
        descriptionEn: 'Universal cosmetic solvent and carrier vehicle.',
        benefits: [],
        cautions: [],
        contraindications: [],
      },
      {
        name: 'Glycerin',
        nameAr: 'جلسرين',
        slug: 'glycerin',
        inciName: 'GLYCERIN',
        aliases: ['Glycerol', 'جلسرين'],
        family: 'Vehicles',
        familySlug: 'vehicles',
        chemicalForm: 'Polyol Humectant / Solvent',
        primaryFunction: 'Humectant',
        functions: ['Vehicle', 'Moisture Retention'],
        isActiveIngredient: false, // Standard base humectant/vehicle, not priority targeted active
        rating: 'BEST',
        descriptionEn: 'Standard polyol cosmetic humectant and solvent.',
        benefits: [
          {
            concern: 'hydration',
            description: 'Hydrates the stratum corneum and maintains lipid crystal structures',
            evidenceLevel: EvidenceLevel.STRONG_CLINICAL,
          },
        ],
        cautions: [],
        contraindications: [],
      },
      {
        name: 'Phenoxyethanol',
        nameAr: 'فينوكسي إيثانول',
        slug: 'phenoxyethanol',
        inciName: 'PHENOXYETHANOL',
        aliases: ['فينوكسي إيثانول'],
        family: 'Preservatives',
        familySlug: 'preservatives',
        chemicalForm: 'Glycol Ether Preservative',
        primaryFunction: 'Preservative',
        functions: ['Microbial Control'],
        isActiveIngredient: false,
        descriptionEn: 'Broad-spectrum antimicrobial cosmetic preservative.',
        benefits: [],
        cautions: [],
        contraindications: [],
      },
      {
        name: 'Ethylhexylglycerin',
        nameAr: 'إيثيل هكسيل جلسرين',
        slug: 'ethylhexylglycerin',
        inciName: 'ETHYLHEXYLGLYCERIN',
        aliases: ['إيثيل هكسيل جلسرين'],
        family: 'Preservatives',
        familySlug: 'preservatives',
        chemicalForm: 'Alkyl Glyceryl Ether',
        primaryFunction: 'Preservative',
        functions: ['Preservative Booster', 'Skin Conditioning'],
        isActiveIngredient: false,
        benefits: [],
        cautions: [],
        contraindications: [],
      },
      {
        name: 'Carbomer',
        nameAr: 'كاربومير',
        slug: 'carbomer',
        inciName: 'CARBOMER',
        aliases: ['كاربومير'],
        family: 'Thickeners',
        familySlug: 'thickeners',
        chemicalForm: 'Crosslinked Polyacrylate Polymer',
        primaryFunction: 'Thickener',
        functions: ['Viscosity Controlling', 'Emulsion Stabilizing'],
        isActiveIngredient: false,
        benefits: [],
        cautions: [],
        contraindications: [],
      },
    ];

    let count = 0;
    for (const data of standardActives) {
      await this.createOrUpdateIngredient(data);
      count++;
    }
    return count;
  }
}
