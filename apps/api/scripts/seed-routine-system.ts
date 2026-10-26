/**
 * Seeds the routine system's starting content (docs/project/ROUTINE_SYSTEM.md §8-أ, §13). Idempotent: upserts by key.
 *
 * - The 8 launch concerns (care.concerns), the routine actives in the ingredient ontology (catalog, via its own service).
 * - Safety rules (care.ingredient_rules), each with its source. SHINACARE_POLICY marks a conservative product rule.
 * - Blueprints, all as DRAFT. Nothing is published here: an admin publishes from /care/admin/routines after the
 *   readiness gate passes. Blueprints whose rules have no verified source yet carry no sources, so publishing them is
 *   refused (SOURCES_REQUIRED) until the content team adds them.
 *
 * Run: npm run seed:routine   (refuses NODE_ENV=production)
 */
import { PrismaClient, CareArea, IngredientRuleKind, IngredientRuleSubject, RoutineKind } from '@prisma/client';
import { IngredientService } from '../src/modules/catalog/services/ingredient.service';
import type { PrismaService } from '../src/platform/database/prisma.service';

const AAD_ACNE_TIMELINE = { title: 'AAD — If your acne won\'t clear', url: 'https://www.aad.org/public/diseases/acne/DIY/wont-clear' };
const AAD_SUNSCREEN = { title: 'AAD — How to apply sunscreen', url: 'https://www.aad.org/sun-protection/how-to-apply-sunscreen' };
const AAD_PREGNANCY = { title: 'AAD — Is any acne treatment safe to use during pregnancy?', url: 'https://www.aad.org/media/news-releases/acne-can-put-a-damper-on-hopes-of-glowing-skin-during-pregnancy' };
const NHS_ISOTRETINOIN = { title: 'Royal Berkshire NHS — Skincare routine while on isotretinoin', url: 'https://royalberkshire.nhs.uk/media/mqlnuujf/skincare-routine-while-on-isotretinoin_may24.pdf' };
const BPO_RETINOID_STABILITY = { title: 'Br J Dermatol 1998 — Adapalene vs tretinoin stability with benzoyl peroxide', url: 'https://pubmed.ncbi.nlm.nih.gov/9990414/' };

const CONCERNS: Array<{ slug: string; name: string; careArea: CareArea }> = [
  { slug: 'blackheads-pimples', name: 'الحبوب والرؤوس السوداء', careArea: CareArea.skin },
  { slug: 'acne', name: 'حب الشباب (الأكني)', careArea: CareArea.skin },
  { slug: 'dark-spots', name: 'البقع الداكنة وآثار الحبوب', careArea: CareArea.skin },
  { slug: 'brightening', name: 'التفتيح وتوحيد اللون', careArea: CareArea.skin },
  { slug: 'sun-tan', name: 'الاسمرار وتصبغات الشمس', careArea: CareArea.skin },
  { slug: 'dryness', name: 'الجفاف والترطيب', careArea: CareArea.skin },
  { slug: 'sun-protection', name: 'الحماية من الشمس', careArea: CareArea.skin },
  { slug: 'hair-loss', name: 'تساقط الشعر', careArea: CareArea.hair },
];

type RuleSeed = {
  key: string; kind: IngredientRuleKind; subjectType: IngredientRuleSubject; subject: string;
  otherType?: IngredientRuleSubject; other?: string; condition?: string; noteAr?: string;
  source: { title: string; url?: string }; sourceType: 'PUBLISHED_GUIDANCE' | 'STUDY' | 'SHINACARE_POLICY';
};
const F = IngredientRuleSubject.FAMILY;
const I = IngredientRuleSubject.INGREDIENT;
const RULES: RuleSeed[] = [
  { key: 'retinoids-pregnancy', kind: 'EXCLUDE_CONDITION', subjectType: F, subject: 'retinoids', condition: 'PREGNANT',
    noteAr: 'الريتينويدات مش بتتقترح أثناء الحمل.', source: AAD_PREGNANCY, sourceType: 'PUBLISHED_GUIDANCE' },
  { key: 'retinoids-breastfeeding', kind: 'EXCLUDE_CONDITION', subjectType: F, subject: 'retinoids', condition: 'BREASTFEEDING',
    noteAr: 'تحفّظ: نفس قاعدة الحمل أثناء الرضاعة.', source: { title: 'ShinaCare conservative policy (mirrors the pregnancy rule)' }, sourceType: 'SHINACARE_POLICY' },
  { key: 'benzoyl-peroxide-pregnancy', kind: 'EXCLUDE_CONDITION', subjectType: F, subject: 'benzoyl-peroxide', condition: 'PREGNANT',
    noteAr: 'الإرشاد بيقول تكلمي الدكتور الأول، فمش بنقترحه من غيره.', source: AAD_PREGNANCY, sourceType: 'PUBLISHED_GUIDANCE' },
  { key: 'benzoyl-peroxide-breastfeeding', kind: 'EXCLUDE_CONDITION', subjectType: F, subject: 'benzoyl-peroxide', condition: 'BREASTFEEDING',
    noteAr: 'تحفّظ: نفس قاعدة الحمل أثناء الرضاعة.', source: { title: 'ShinaCare conservative policy (mirrors the pregnancy rule)' }, sourceType: 'SHINACARE_POLICY' },
  { key: 'oral-isotretinoin-retinoids', kind: 'EXCLUDE_CONDITION', subjectType: F, subject: 'retinoids', condition: 'ORAL_RETINOID',
    source: NHS_ISOTRETINOIN, sourceType: 'PUBLISHED_GUIDANCE' },
  { key: 'oral-isotretinoin-hydroxy-acids', kind: 'EXCLUDE_CONDITION', subjectType: F, subject: 'hydroxy-acids', condition: 'ORAL_RETINOID',
    source: NHS_ISOTRETINOIN, sourceType: 'PUBLISHED_GUIDANCE' },
  { key: 'oral-isotretinoin-benzoyl-peroxide', kind: 'EXCLUDE_CONDITION', subjectType: F, subject: 'benzoyl-peroxide', condition: 'ORAL_RETINOID',
    source: NHS_ISOTRETINOIN, sourceType: 'PUBLISHED_GUIDANCE' },
  { key: 'benzoyl-peroxide-tretinoin', kind: 'SEPARATE_TIMES', subjectType: I, subject: 'benzoyl-peroxide', otherType: I, other: 'tretinoin',
    noteAr: 'البنزويل بيروكسايد بيكسّر التريتينوين: واحد الصبح والتاني بالليل.', source: BPO_RETINOID_STABILITY, sourceType: 'STUDY' },
  { key: 'benzoyl-peroxide-adapalene', kind: 'COMPATIBLE', subjectType: I, subject: 'benzoyl-peroxide', otherType: I, other: 'adapalene',
    source: BPO_RETINOID_STABILITY, sourceType: 'STUDY' },
  { key: 'max-one-retinoid-per-area', kind: 'MAX_ONE_PER_AREA', subjectType: F, subject: 'retinoids',
    noteAr: 'ريتينويد واحد بس على نفس المنطقة.', source: { title: 'ShinaCare conservative policy' }, sourceType: 'SHINACARE_POLICY' },
  { key: 'max-one-hydroxy-acid-per-area', kind: 'MAX_ONE_PER_AREA', subjectType: F, subject: 'hydroxy-acids',
    noteAr: 'مقشّر أحماض واحد بس على نفس المنطقة.', source: { title: 'ShinaCare conservative policy' }, sourceType: 'SHINACARE_POLICY' },
];

type RoleSeed = { roleKey: string; titleAr: string; isEssential?: boolean; startWeek?: number; requiredActives?: string[]; usageNoteAr?: string };
type BlueprintSeed = {
  key: string; concernSlug: string; careArea: CareArea; kind: RoutineKind; severityMin: number; severityMax: number;
  titleAr: string; titleEn: string; goalAr: string; timelineAr: string; safetyNotesAr: string[];
  sources: Array<{ title: string; url: string }>; roles: RoleSeed[];
};

const CLEANSER: RoleSeed = { roleKey: 'cleanser', titleAr: 'غسول' };
const MOISTURIZER: RoleSeed = { roleKey: 'moisturizer', titleAr: 'مرطب' };
const SUNSCREEN: RoleSeed = { roleKey: 'sunscreen', titleAr: 'واقي شمس',
  usageNoteAr: 'كل يوم الصبح، وكل ساعتين وانت برا، وبعد العرق أو المية. واسع الطيف وSPF 30 أو أعلى.' };
const ACNE_TIMELINE = 'ممكن تبدأ تلاحظ تحسن خلال ٤–٦ أسابيع، وهنقيّم النتيجة في الأسبوع ٨، والصفاء ممكن ياخد ٢–٣ شهور أو أكتر.';
const GENTLE_START = 'ابدأ العلاج يوم ويوم أول أسبوعين، وجرّب على جزء صغير الأول. مش بديل عن الدكتور.';

const BLUEPRINTS: BlueprintSeed[] = [
  { key: 'blackheads-pimples-mild', concernSlug: 'blackheads-pimples', careArea: CareArea.skin, kind: RoutineKind.TREATMENT,
    severityMin: 1, severityMax: 2, titleAr: 'روتين الحبوب والرؤوس السوداء', titleEn: 'Blackheads and pimples',
    goalAr: 'تنضيف المسام وتقليل الحبوب الجديدة', timelineAr: ACNE_TIMELINE, safetyNotesAr: [GENTLE_START],
    sources: [AAD_ACNE_TIMELINE, AAD_SUNSCREEN],
    roles: [CLEANSER, { roleKey: 'treatment', titleAr: 'علاج', startWeek: 2, requiredActives: ['salicylic-acid', 'adapalene'] }, MOISTURIZER, SUNSCREEN] },
  { key: 'acne-inflammatory', concernSlug: 'acne', careArea: CareArea.skin, kind: RoutineKind.TREATMENT,
    severityMin: 1, severityMax: 2, titleAr: 'روتين حب الشباب', titleEn: 'Acne',
    goalAr: 'تقليل الحبوب الملتهبة وتهدئة البشرة', timelineAr: ACNE_TIMELINE, safetyNotesAr: [GENTLE_START],
    sources: [AAD_ACNE_TIMELINE, AAD_SUNSCREEN, AAD_PREGNANCY],
    roles: [CLEANSER, { roleKey: 'treatment', titleAr: 'علاج', startWeek: 2, requiredActives: ['benzoyl-peroxide', 'adapalene', 'azelaic-acid'] },
      MOISTURIZER, SUNSCREEN, { roleKey: 'spot-treatment', titleAr: 'علاج موضعي للحبة', isEssential: false, startWeek: 2, requiredActives: ['benzoyl-peroxide'] }] },
  // The four below have no verified source for their actives yet: they stay unpublishable until content adds them.
  { key: 'dark-spots', concernSlug: 'dark-spots', careArea: CareArea.skin, kind: RoutineKind.TREATMENT, severityMin: 1, severityMax: 2,
    titleAr: 'روتين البقع الداكنة وآثار الحبوب', titleEn: 'Dark spots', goalAr: 'تفتيح البقع وتوحيد اللون', timelineAr: '', safetyNotesAr: [GENTLE_START],
    sources: [], roles: [CLEANSER, { roleKey: 'treatment', titleAr: 'علاج', startWeek: 2, requiredActives: ['azelaic-acid', 'niacinamide', 'tranexamic-acid', 'vitamin-c'] }, MOISTURIZER, SUNSCREEN] },
  { key: 'brightening', concernSlug: 'brightening', careArea: CareArea.skin, kind: RoutineKind.TREATMENT, severityMin: 1, severityMax: 2,
    titleAr: 'روتين التفتيح وتوحيد اللون', titleEn: 'Brightening', goalAr: 'إشراق وتوحيد لون، مش تغيير لون البشرة الطبيعي', timelineAr: '',
    safetyNotesAr: [GENTLE_START], sources: [],
    roles: [CLEANSER, { roleKey: 'treatment', titleAr: 'علاج', startWeek: 2, requiredActives: ['vitamin-c', 'niacinamide', 'arbutin'] }, MOISTURIZER, SUNSCREEN] },
  { key: 'sun-tan', concernSlug: 'sun-tan', careArea: CareArea.skin, kind: RoutineKind.TREATMENT, severityMin: 1, severityMax: 2,
    titleAr: 'روتين الاسمرار وتصبغات الشمس', titleEn: 'Tan and sun pigmentation', goalAr: 'توحيد اللون وحماية من اسمرار جديد', timelineAr: '',
    safetyNotesAr: [GENTLE_START], sources: [],
    roles: [CLEANSER, { roleKey: 'treatment', titleAr: 'علاج', startWeek: 2, requiredActives: ['vitamin-c', 'niacinamide'] }, MOISTURIZER, SUNSCREEN,
      { roleKey: 'exfoliant', titleAr: 'مقشّر', isEssential: false, startWeek: 3, requiredActives: ['glycolic-acid', 'lactic-acid'] }] },
  { key: 'dryness', concernSlug: 'dryness', careArea: CareArea.skin, kind: RoutineKind.SUPPORT, severityMin: 1, severityMax: 3,
    titleAr: 'روتين الجفاف والترطيب', titleEn: 'Dryness', goalAr: 'ترطيب وحماية حاجز البشرة', timelineAr: '', safetyNotesAr: [], sources: [],
    roles: [CLEANSER, MOISTURIZER, SUNSCREEN] },
  { key: 'sun-protection', concernSlug: 'sun-protection', careArea: CareArea.skin, kind: RoutineKind.SUPPORT, severityMin: 1, severityMax: 3,
    titleAr: 'روتين الحماية من الشمس', titleEn: 'Sun protection', goalAr: 'حماية يومية من الشمس للوش والجسم', timelineAr: '', safetyNotesAr: [],
    sources: [AAD_SUNSCREEN],
    roles: [SUNSCREEN, { roleKey: 'sunscreen-body', titleAr: 'واقي للجسم', isEssential: false }, { roleKey: 'lip-spf', titleAr: 'مرطب شفايف بواقي', isEssential: false }] },
  { key: 'hair-loss', concernSlug: 'hair-loss', careArea: CareArea.hair, kind: RoutineKind.TREATMENT, severityMin: 1, severityMax: 2,
    titleAr: 'روتين تساقط الشعر', titleEn: 'Hair loss', goalAr: 'العناية بفروة الشعر وتقليل التكسر', timelineAr: '',
    safetyNotesAr: ['التساقط المفاجئ أو على شكل بقع محتاج دكتور قبل أي روتين.'], sources: [],
    roles: [{ roleKey: 'shampoo', titleAr: 'شامبو' }, { roleKey: 'conditioner', titleAr: 'بلسم' }, { roleKey: 'scalp-treatment', titleAr: 'علاج فروة', isEssential: false }] },
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed routine content with NODE_ENV=production');
  const prisma = new PrismaClient();
  try {
    const ontology = await new IngredientService(prisma as unknown as PrismaService).seedStandardOntology();

    for (const c of CONCERNS) {
      await prisma.concern.upsert({ where: { slug: c.slug }, update: { name: c.name, careArea: c.careArea },
        create: { slug: c.slug, name: c.name, careArea: c.careArea } });
    }

    for (const r of RULES) {
      const data = { kind: r.kind, subjectType: r.subjectType, subject: r.subject, otherType: r.otherType ?? null, other: r.other ?? null,
        condition: r.condition ?? null, noteAr: r.noteAr ?? null, sourceTitle: r.source.title, sourceUrl: r.source.url ?? null,
        sourceType: r.sourceType };
      await prisma.ingredientRule.upsert({ where: { key: r.key }, update: data, create: { key: r.key, ...data } });
    }

    for (const b of BLUEPRINTS) {
      const existing = await prisma.routineBlueprint.findUnique({ where: { key: b.key } });
      if (existing && existing.status !== 'DRAFT') {
        console.log(`skip ${b.key}: ${existing.status} (published content is changed from admin, not by the seed)`);
        continue;
      }
      const data = { concernSlug: b.concernSlug, careArea: b.careArea, kind: b.kind, severityMin: b.severityMin, severityMax: b.severityMax,
        titleAr: b.titleAr, titleEn: b.titleEn, goalAr: b.goalAr, timelineAr: b.timelineAr || null, safetyNotesAr: b.safetyNotesAr,
        sources: b.sources };
      const bp = await prisma.routineBlueprint.upsert({ where: { key: b.key }, update: data, create: { key: b.key, ...data } });
      await prisma.blueprintRole.deleteMany({ where: { blueprintId: bp.id } });
      await prisma.blueprintRole.createMany({ data: b.roles.map((r, i) => ({
        blueprintId: bp.id, roleKey: r.roleKey, sortOrder: i + 1, titleAr: r.titleAr, isEssential: r.isEssential ?? true,
        startWeek: r.roleKey === 'sunscreen' ? 1 : r.startWeek ?? 1, requiredActives: r.requiredActives ?? [], usageNoteAr: r.usageNoteAr ?? null,
      })) });
    }
    console.log(`routine seed: ${ontology} ontology entries, ${CONCERNS.length} concerns, ${RULES.length} rules, ${BLUEPRINTS.length} draft blueprints`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
