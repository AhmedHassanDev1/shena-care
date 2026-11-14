/**
 * Starting content of the care knowledge base. Every statement is worded from a page that was fetched and read on
 * RETRIEVED_AT (scripts/seed-care-knowledge.ts re-checks that each source still resolves). Nothing here is a product fact.
 *
 * Review policy:
 *  - AUTO_ACCEPTED: low-risk everyday care (how to wash, apply sunscreen, use a conditioner) taken from a professional body.
 *  - PENDING_PROFESSIONAL_REVIEW: anything about a condition, an active ingredient, pregnancy or when to see a doctor.
 *    The consultation presents these as general published guidance, never as clinically validated ShinaCare advice,
 *    until a qualified professional marks them PROFESSIONALLY_REVIEWED.
 */
export const RETRIEVED_AT = '2026-11-14T00:00:00.000Z';

type SourceType = 'PROFESSIONAL_BODY' | 'CLINICAL_GUIDELINE' | 'REGULATOR' | 'PEER_REVIEWED' | 'SHINACARE_POLICY';
interface Source { title: string; url: string | null; type: SourceType; mustMention: string[] }

export const SOURCES = {
  aadFaceWash: { title: 'American Academy of Dermatology — Face washing 101', url: 'https://www.aad.org/public/everyday-care/skin-care-basics/care/face-washing-101', type: 'PROFESSIONAL_BODY', mustMention: ['non-abrasive', 'lukewarm', 'twice a day'] },
  aadSelectSunscreen: { title: 'American Academy of Dermatology — How to select a sunscreen', url: 'https://www.aad.org/public/everyday-care/sun-protection/shade-clothing-sunscreen/how-to-select-sunscreen', type: 'PROFESSIONAL_BODY', mustMention: ['SPF 30', 'broad spectrum', 'water resistant'] },
  aadApplySunscreen: { title: 'American Academy of Dermatology — How to apply sunscreen', url: 'https://www.aad.org/sun-protection/how-to-apply-sunscreen', type: 'PROFESSIONAL_BODY', mustMention: ['two hours', '15 minutes'] },
  aadAcneTreat: { title: 'American Academy of Dermatology — Acne: Diagnosis and treatment', url: 'https://www.aad.org/public/diseases/acne/derm-treat/treat', type: 'PROFESSIONAL_BODY', mustMention: ['benzoyl peroxide', 'salicylic acid', 'azelaic acid'] },
  aadAcneTips: { title: 'American Academy of Dermatology — Acne: Tips for managing', url: 'https://www.aad.org/public/diseases/acne/skin-care/tips', type: 'PROFESSIONAL_BODY', mustMention: ['non-comedogenic', 'gentle'] },
  aadAcneWontClear: { title: 'American Academy of Dermatology — 9 things to try when acne won’t clear', url: 'https://www.aad.org/public/diseases/acne/DIY/wont-clear', type: 'PROFESSIONAL_BODY', mustMention: ['4 weeks'] },
  aadDrySkin: { title: 'American Academy of Dermatology — Dermatologists’ top tips for relieving dry skin', url: 'https://www.aad.org/public/everyday-care/skin-care-basics/dry/dermatologists-tips-relieve-dry-skin', type: 'PROFESSIONAL_BODY', mustMention: ['hyaluronic acid', 'glycerin', 'fragrance-free'] },
  aadDarkSpots: { title: 'American Academy of Dermatology — How to fade dark spots in darker skin tones', url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/routine/fade-dark-spots', type: 'PROFESSIONAL_BODY', mustMention: ['azelaic acid', 'glycolic acid', 'vitamin C'] },
  aadHairShedding: { title: 'American Academy of Dermatology — Do you have hair loss or hair shedding?', url: 'https://www.aad.org/public/diseases/hair-loss/insider/shedding', type: 'PROFESSIONAL_BODY', mustMention: ['50 and 100'] },
  aadDandruff: { title: 'American Academy of Dermatology — How to treat dandruff', url: 'https://www.aad.org/public/everyday-care/hair-scalp-care/scalp/treat-dandruff', type: 'PROFESSIONAL_BODY', mustMention: ['zinc pyrithione', 'salicylic acid', 'ketoconazole'] },
  aadHealthyHair: { title: 'American Academy of Dermatology — Tips for healthy hair', url: 'https://www.aad.org/public/everyday-care/hair-scalp-care/hair/healthy-hair-tips', type: 'PROFESSIONAL_BODY', mustMention: ['conditioner', 'scalp'] },
  aadRetinoid: { title: 'American Academy of Dermatology — Retinoid or retinol?', url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/anti-aging/retinoid-retinol', type: 'PROFESSIONAL_BODY', mustMention: ['pregnancy', 'every other night'] },
  aadOilySkin: { title: 'American Academy of Dermatology — How to control oily skin', url: 'https://www.aad.org/public/everyday-care/skin-care-basics/dry/oily-skin', type: 'PROFESSIONAL_BODY', mustMention: ['noncomedogenic', 'moisturizer', 'salicylic acid'] },
  aadPregnancyAcne: { title: 'American Academy of Dermatology — Is any acne treatment safe to use during pregnancy?', url: 'https://www.aad.org/public/diseases/acne/derm-treat/pregnancy', type: 'PROFESSIONAL_BODY', mustMention: ['benzoyl peroxide', 'azelaic acid', 'salicylic acid'] },
  nhsAcne: { title: 'NHS — Acne', url: 'https://www.nhs.uk/conditions/acne/', type: 'CLINICAL_GUIDELINE', mustMention: ['see a gp', 'painful'] },
  nhsDandruff: { title: 'NHS — Dandruff', url: 'https://www.nhs.uk/conditions/dandruff/', type: 'CLINICAL_GUIDELINE', mustMention: ['ketoconazole', 'salicylic acid', 'a month'] },
  nhsHairLoss: { title: 'NHS — Hair loss', url: 'https://www.nhs.uk/conditions/hair-loss/', type: 'CLINICAL_GUIDELINE', mustMention: ['50 and 100', 'see a gp'] },
  fdaSunscreen: { title: 'U.S. FDA — Sunscreen: How to Help Protect Your Skin from the Sun', url: 'https://www.fda.gov/drugs/understanding-over-counter-medicines/sunscreen-how-help-protect-your-skin-sun', type: 'REGULATOR', mustMention: ['broad spectrum', 'two hours', 'water resistant'] },
  fdaAha: { title: 'U.S. FDA — Alpha Hydroxy Acids', url: 'https://www.fda.gov/cosmetics/cosmetic-ingredients/alpha-hydroxy-acids', type: 'REGULATOR', mustMention: ['glycolic acid', 'sunscreen'] },
  dermnetNicotinamide: { title: 'DermNet — Nicotinamide', url: 'https://dermnetnz.org/topics/nicotinamide', type: 'PROFESSIONAL_BODY', mustMention: ['sebum', 'acne'] },
  dermnetSalicylic: { title: 'DermNet — Salicylic acid', url: 'https://dermnetnz.org/topics/salicylic-acid', type: 'PROFESSIONAL_BODY', mustMention: ['keratolytic'] },
  dermnetBenzoyl: { title: 'DermNet — Benzoyl peroxide', url: 'https://dermnetnz.org/topics/benzoyl-peroxide', type: 'PROFESSIONAL_BODY', mustMention: ['bleach'] },
  dermnetAzelaic: { title: 'DermNet — Azelaic acid', url: 'https://dermnetnz.org/topics/azelaic-acid', type: 'PROFESSIONAL_BODY', mustMention: ['pigmentation', 'acne'] },
  dermnetVitaminC: { title: 'DermNet — Vitamin C cream', url: 'https://dermnetnz.org/topics/topical-vitamin-c', type: 'PROFESSIONAL_BODY', mustMention: ['antioxidant', 'concentration'] },
  dermnetEmollients: { title: 'DermNet — Emollients and moisturisers', url: 'https://dermnetnz.org/topics/emollients-and-moisturisers', type: 'PROFESSIONAL_BODY', mustMention: ['humectant', 'occlusive'] },
  shinacarePolicy: { title: 'ShinaCare conservative policy', url: null, type: 'SHINACARE_POLICY', mustMention: [] },
} as const satisfies Record<string, Source>;

export type SourceKey = keyof typeof SOURCES;

/** Concerns this knowledge base adds to the launch taxonomy (the routine seed owns the first eight). */
export const EXTRA_CONCERNS = [
  { slug: 'oily-skin', name: 'البشرة الدهنية واللمعان', careArea: 'skin' as const },
  { slug: 'dandruff', name: 'القشرة', careArea: 'hair' as const },
  { slug: 'dry-damaged-hair', name: 'الشعر الجاف والتالف', careArea: 'hair' as const },
];

export interface KnowledgeSeed {
  key: string;
  subjectType: 'INGREDIENT' | 'INGREDIENT_FAMILY' | 'PRODUCT_TYPE' | 'CONCERN' | 'GENERAL';
  subjectKey: string;
  topic: 'FUNCTION' | 'CONCERN_RELEVANCE' | 'USAGE' | 'PRECAUTION' | 'COMPATIBILITY' | 'LIMITATION' | 'ESCALATION' | 'OVERVIEW';
  concernSlug?: string;
  careArea?: 'skin' | 'hair';
  strength?: 'PRIMARY' | 'SUPPORTIVE';
  en: string;
  ar: string;
  source: SourceKey;
  evidenceClass?: 'VERIFIED_FACT' | 'EVIDENCE_SUPPORTED' | 'INFERENCE';
  /** Low-risk everyday care only. */
  autoAccept?: boolean;
  confidence?: number;
}

const usage = (key: string, productType: string, careArea: 'skin' | 'hair', source: SourceKey, en: string, ar: string): KnowledgeSeed =>
  ({ key, subjectType: 'PRODUCT_TYPE', subjectKey: productType, topic: 'USAGE', careArea, en, ar, source, autoAccept: true, confidence: 0.9 });

const typeFor = (concern: string, productType: string, careArea: 'skin' | 'hair', strength: 'PRIMARY' | 'SUPPORTIVE', source: SourceKey, en: string, ar: string): KnowledgeSeed =>
  ({ key: `type.${productType}.for.${concern}`, subjectType: 'PRODUCT_TYPE', subjectKey: productType, topic: 'CONCERN_RELEVANCE', concernSlug: concern, careArea, strength, en, ar, source, confidence: 0.8 });

const activeFor = (concern: string, subjectType: 'INGREDIENT' | 'INGREDIENT_FAMILY', subject: string, careArea: 'skin' | 'hair', strength: 'PRIMARY' | 'SUPPORTIVE', source: SourceKey, en: string, ar: string): KnowledgeSeed =>
  ({ key: `active.${subject}.for.${concern}`, subjectType, subjectKey: subject, topic: 'CONCERN_RELEVANCE', concernSlug: concern, careArea, strength, en, ar, source, confidence: 0.8 });

export const KNOWLEDGE: KnowledgeSeed[] = [
  // ── How each product type is used (everyday care) ─────────────────────────────────────────────
  usage('usage.cleanser.face', 'cleanser', 'skin', 'aadFaceWash',
    'Use a gentle, non-abrasive cleanser without alcohol, with lukewarm water and your fingertips. Limit washing to twice a day and after sweating.',
    'استخدمي غسول لطيف غير كاشط ومن غير كحول، بمية فاترة وبأطراف الأصابع. كفاية مرتين في اليوم وبعد العرق.'),
  usage('usage.sunscreen.select', 'sunscreen', 'skin', 'aadSelectSunscreen',
    'Choose a sunscreen that is broad spectrum, SPF 30 or higher and water resistant.',
    'اختاري واقي شمس واسع الطيف، بمعامل حماية SPF 30 أو أعلى، ومقاوم للمية.'),
  usage('usage.sunscreen.apply', 'sunscreen', 'skin', 'aadApplySunscreen',
    'Apply sunscreen about 15 minutes before going outdoors and reapply every two hours, and right after swimming or sweating.',
    'حطي واقي الشمس قبل الخروج بحوالي ١٥ دقيقة، وجدّديه كل ساعتين وبعد السباحة أو العرق مباشرة.'),
  usage('usage.moisturizer', 'moisturizer', 'skin', 'aadDrySkin',
    'Apply moisturizer right after washing, while the skin is still damp. For dry skin a cream or ointment is more effective than a lotion.',
    'حطي المرطب بعد الغسيل على طول والبشرة لسه رطبة. للبشرة الجافة الكريم أو المرهم أقوى من اللوشن.'),
  usage('usage.shampoo', 'shampoo', 'hair', 'aadHealthyHair',
    'Apply shampoo to the scalp rather than the full length of the hair, and wash as often as your hair gets dirty or oily.',
    'حطي الشامبو على فروة الراس مش على طول الشعر كله، واغسلي على حسب ما شعرك بيتوسخ أو بيزيّت.'),
  usage('usage.conditioner', 'conditioner', 'hair', 'aadHealthyHair',
    'Use conditioner after washing. For fine or straight hair apply it to the ends; for dry or curly hair apply it along the entire length.',
    'استخدمي البلسم بعد الغسيل. للشعر الناعم أو الخفيف على الأطراف، وللشعر الجاف أو الكيرلي على طول الشعر كله.'),

  // ── Which product types belong in the care of each concern ─────────────────────────────────────
  typeFor('sun-protection', 'sunscreen', 'skin', 'PRIMARY', 'aadSelectSunscreen',
    'Daily sun protection relies on a broad-spectrum sunscreen of SPF 30 or higher.',
    'الحماية اليومية من الشمس أساسها واقي شمس واسع الطيف SPF 30 أو أعلى.'),
  typeFor('sun-tan', 'sunscreen', 'skin', 'PRIMARY', 'fdaSunscreen',
    'Using a broad spectrum sunscreen regularly, and reapplying it at least every two hours, helps protect the skin from the sun.',
    'استخدام واقي شمس واسع الطيف بانتظام وتجديده كل ساعتين على الأقل بيساعد على حماية البشرة من الشمس.'),
  typeFor('dryness', 'moisturizer', 'skin', 'PRIMARY', 'aadDrySkin',
    'Moisturizer plays a key role in relieving dry skin; apply it several times a day.',
    'المرطب له دور أساسي في تهدئة جفاف البشرة، ويتحط أكتر من مرة في اليوم.'),
  typeFor('dryness', 'cleanser', 'skin', 'SUPPORTIVE', 'aadDrySkin',
    'For dry skin, dermatologists recommend gentle, fragrance-free skin care products.',
    'للبشرة الجافة أطباء الجلدية بيرشحوا منتجات عناية لطيفة ومن غير عطر.'),
  typeFor('dryness', 'sunscreen', 'skin', 'SUPPORTIVE', 'aadDrySkin',
    'Dry skin still needs sun protection: a broad-spectrum, water-resistant sunscreen with SPF 30 or higher.',
    'البشرة الجافة برضه محتاجة حماية من الشمس: واقي واسع الطيف مقاوم للمية SPF 30 أو أعلى.'),
  typeFor('oily-skin', 'cleanser', 'skin', 'PRIMARY', 'aadOilySkin',
    'For oily skin use a mild, gentle foaming face wash; a harsh wash can irritate the skin and trigger more oil.',
    'للبشرة الدهنية استخدمي غسول رغوي لطيف؛ الغسول القاسي ممكن يهيّج البشرة ويزوّد إفراز الدهون.'),
  typeFor('oily-skin', 'moisturizer', 'skin', 'SUPPORTIVE', 'aadOilySkin',
    'Oily skin still needs a moisturizer after cleansing to stay hydrated; look for “oil free” and “noncomedogenic” on the label.',
    'البشرة الدهنية برضه محتاجة مرطب بعد الغسيل؛ دوّري على «خالي من الزيوت» و«لا يسد المسام» على العبوة.'),
  typeFor('oily-skin', 'sunscreen', 'skin', 'SUPPORTIVE', 'aadOilySkin',
    'Wear sunscreen outdoors; for breakout-prone oily skin look for zinc oxide or titanium dioxide and avoid sunscreens with fragrance or oils.',
    'استخدمي واقي شمس برّه البيت؛ للبشرة الدهنية المعرّضة للحبوب دوّري على أكسيد الزنك أو ثاني أكسيد التيتانيوم وابعدي عن العطور والزيوت.'),
  typeFor('acne', 'cleanser', 'skin', 'SUPPORTIVE', 'aadAcneTips',
    'Acne-prone skin does best with gentle products that do not irritate it and are labelled non-comedogenic.',
    'البشرة المعرّضة لحب الشباب بيناسبها المنتجات اللطيفة اللي مش بتهيّج والمكتوب عليها «لا تسد المسام».'),
  typeFor('acne', 'sunscreen', 'skin', 'SUPPORTIVE', 'aadAcneTips',
    'With acne, use a water-resistant sunscreen of SPF 30 or higher that says “non-comedogenic” or “won’t clog pores”.',
    'مع حب الشباب استخدمي واقي شمس مقاوم للمية SPF 30 أو أعلى ومكتوب عليه «لا يسد المسام».'),
  typeFor('blackheads-pimples', 'cleanser', 'skin', 'SUPPORTIVE', 'aadAcneTips',
    'Skin with pimples and blackheads does best with gentle, non-comedogenic products.',
    'البشرة اللي فيها حبوب ورؤوس سوداء بيناسبها المنتجات اللطيفة اللي مش بتسد المسام.'),
  typeFor('blackheads-pimples', 'sunscreen', 'skin', 'SUPPORTIVE', 'aadAcneTips',
    'Choose a sunscreen that says “non-comedogenic” or “won’t clog pores”.',
    'اختاري واقي شمس مكتوب عليه «لا يسد المسام».'),
  typeFor('dark-spots', 'sunscreen', 'skin', 'SUPPORTIVE', 'fdaSunscreen',
    'Regular use of a broad spectrum sunscreen helps protect the skin from the sun.',
    'الانتظام على واقي شمس واسع الطيف بيساعد على حماية البشرة من الشمس.'),
  typeFor('dandruff', 'shampoo', 'hair', 'PRIMARY', 'aadDandruff',
    'Dandruff is managed with a dandruff shampoo containing an ingredient such as zinc pyrithione, salicylic acid, selenium sulfide, ketoconazole or coal tar.',
    'القشرة بيتم التعامل معاها بشامبو للقشرة فيه مادة زي زنك بيريثيون أو حمض الساليسيليك أو سيلينيوم سلفايد أو كيتوكونازول أو قطران الفحم.'),
  typeFor('dry-damaged-hair', 'conditioner', 'hair', 'PRIMARY', 'aadHealthyHair',
    'Conditioner moisturizes and detangles the hair and makes it easier to manage.',
    'البلسم بيرطّب الشعر ويفك تشابكه ويخليه أسهل في التصفيف.'),
  typeFor('dry-damaged-hair', 'shampoo', 'hair', 'SUPPORTIVE', 'aadHealthyHair',
    'Shampooing the scalp rather than the lengths cleans without drying the hair too much.',
    'غسل فروة الراس بالشامبو بدل طول الشعر بينضّف من غير ما ينشّف الشعر زيادة.'),
  typeFor('hair-loss', 'shampoo', 'hair', 'SUPPORTIVE', 'aadHealthyHair',
    'Gentle hair care (shampoo on the scalp, conditioner after washing) keeps hair easier to manage; it is care, not a treatment for hair loss.',
    'العناية اللطيفة بالشعر (شامبو على الفروة وبلسم بعد الغسيل) بتخلي الشعر أسهل في التعامل؛ دي عناية مش علاج للتساقط.'),
  typeFor('hair-loss', 'conditioner', 'hair', 'SUPPORTIVE', 'aadHealthyHair',
    'Conditioner detangles hair so it is handled more gently; it is care, not a treatment for hair loss.',
    'البلسم بيفك تشابك الشعر فبيتسرّح بلطف؛ ده عناية مش علاج للتساقط.'),

  // ── Which ingredients the published guidance names for each concern ───────────────────────────
  activeFor('acne', 'INGREDIENT_FAMILY', 'benzoyl-peroxide', 'skin', 'PRIMARY', 'aadAcneTreat',
    'Benzoyl peroxide reduces acne-causing bacteria on the skin and works best alongside another acne treatment.',
    'البنزويل بيروكسايد بيقلل البكتيريا المسببة لحب الشباب على البشرة، وبيشتغل أحسن مع علاج تاني للحبوب.'),
  activeFor('acne', 'INGREDIENT', 'salicylic-acid', 'skin', 'PRIMARY', 'aadAcneTreat',
    'Salicylic acid opens clogged pores and exfoliates the skin; it is used for whiteheads and pimples.',
    'حمض الساليسيليك بيفتح المسام المسدودة وبيقشّر البشرة، وبيتستخدم للرؤوس البيضاء والحبوب.'),
  activeFor('blackheads-pimples', 'INGREDIENT', 'salicylic-acid', 'skin', 'PRIMARY', 'aadAcneTreat',
    'Salicylic acid opens clogged pores and exfoliates the skin; it is used for whiteheads and pimples.',
    'حمض الساليسيليك بيفتح المسام المسدودة وبيقشّر البشرة، وبيتستخدم للرؤوس البيضاء والحبوب.'),
  activeFor('acne', 'INGREDIENT_FAMILY', 'azelaic-acid', 'skin', 'PRIMARY', 'aadAcneTreat',
    'Azelaic acid helps keep pores open, works on acne-causing bacteria and reduces inflammation due to acne.',
    'حمض الأزيليك بيساعد على فتح المسام، وبيشتغل على البكتيريا المسببة للحبوب وبيقلل الالتهاب.'),
  activeFor('acne', 'INGREDIENT_FAMILY', 'retinoids', 'skin', 'PRIMARY', 'aadRetinoid',
    'A product that contains a retinoid is an option for mild acne; start slowly and use sun protection.',
    'المنتج اللي فيه ريتينويد اختيار لحب الشباب الخفيف؛ البداية بالتدريج ومع حماية من الشمس.'),
  activeFor('acne', 'INGREDIENT_FAMILY', 'niacinamide', 'skin', 'SUPPORTIVE', 'dermnetNicotinamide',
    'Nicotinamide (niacinamide) may improve acne through its anti-inflammatory action and by reducing sebum.',
    'النياسيناميد ممكن يحسّن حب الشباب بتأثيره المضاد للالتهاب وبتقليل الدهون.'),
  activeFor('oily-skin', 'INGREDIENT_FAMILY', 'niacinamide', 'skin', 'SUPPORTIVE', 'dermnetNicotinamide',
    'Nicotinamide (niacinamide) is reported to reduce sebum and improve skin barrier function.',
    'النياسيناميد مذكور إنه بيقلل إفراز الدهون وبيحسّن حاجز البشرة.'),
  activeFor('oily-skin', 'INGREDIENT_FAMILY', 'hydroxy-acids', 'skin', 'SUPPORTIVE', 'aadOilySkin',
    'Salicylic, glycolic and lactic acid can help reduce oiliness but may be too harsh for some skin; use less often or stop if irritated.',
    'أحماض الساليسيليك والجليكوليك واللاكتيك ممكن تساعد على تقليل الدهون، بس ممكن تكون قوية على بعض البشرات؛ قللي الاستخدام أو وقّفي لو حصل تهيّج.'),
  activeFor('dark-spots', 'INGREDIENT_FAMILY', 'azelaic-acid', 'skin', 'PRIMARY', 'aadDarkSpots',
    'Azelaic acid is one of the non-prescription ingredients that can fade existing dark spots.',
    'حمض الأزيليك من المكونات المتاحة من غير روشتة اللي ممكن تفتّح البقع الداكنة الموجودة.'),
  activeFor('dark-spots', 'INGREDIENT', 'glycolic-acid', 'skin', 'PRIMARY', 'aadDarkSpots',
    'Glycolic acid is one of the non-prescription ingredients that can fade existing dark spots.',
    'حمض الجليكوليك من المكونات المتاحة من غير روشتة اللي ممكن تفتّح البقع الداكنة الموجودة.'),
  activeFor('dark-spots', 'INGREDIENT_FAMILY', 'vitamin-c', 'skin', 'PRIMARY', 'aadDarkSpots',
    'Vitamin C is one of the non-prescription ingredients that can fade existing dark spots.',
    'فيتامين سي من المكونات المتاحة من غير روشتة اللي ممكن تفتّح البقع الداكنة الموجودة.'),
  activeFor('dark-spots', 'INGREDIENT_FAMILY', 'retinoids', 'skin', 'PRIMARY', 'aadDarkSpots',
    'A retinoid (retinol, adapalene) is one of the ingredients that can fade existing dark spots.',
    'الريتينويد (ريتينول، أدابالين) من المكونات اللي ممكن تفتّح البقع الداكنة الموجودة.'),
  activeFor('brightening', 'INGREDIENT_FAMILY', 'vitamin-c', 'skin', 'SUPPORTIVE', 'aadDarkSpots',
    'Vitamin C is named among ingredients that can fade dark spots and so even out tone.',
    'فيتامين سي مذكور ضمن المكونات اللي ممكن تفتّح البقع الداكنة وبالتالي توحّد اللون.'),
  activeFor('brightening', 'INGREDIENT_FAMILY', 'niacinamide', 'skin', 'SUPPORTIVE', 'dermnetNicotinamide',
    'Nicotinamide (niacinamide) is reported to improve pigmentation and blotchiness of the complexion.',
    'النياسيناميد مذكور إنه بيحسّن التصبغات وعدم توحّد لون البشرة.'),
  activeFor('dryness', 'INGREDIENT_FAMILY', 'hyaluronic-acid', 'skin', 'PRIMARY', 'aadDrySkin',
    'For dry skin, look for a cream or ointment containing ingredients such as hyaluronic acid, glycerin, shea butter or petrolatum.',
    'للبشرة الجافة دوّري على كريم أو مرهم فيه مكونات زي حمض الهيالورونيك أو الجلسرين أو زبدة الشيا أو الفازلين.'),
  activeFor('dandruff', 'INGREDIENT', 'salicylic-acid', 'hair', 'PRIMARY', 'aadDandruff',
    'Salicylic acid is one of the active ingredients to look for in a dandruff shampoo.',
    'حمض الساليسيليك من المواد الفعالة اللي بندوّر عليها في شامبو القشرة.'),

  // ── What an ingredient does ───────────────────────────────────────────────────────────────────
  { key: 'function.niacinamide', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'niacinamide', topic: 'FUNCTION', careArea: 'skin', source: 'dermnetNicotinamide',
    en: 'Niacinamide (nicotinamide) is a form of vitamin B3. On the skin it is reported to reduce sebum, support the skin barrier by reducing water loss, and improve uneven pigmentation.',
    ar: 'النياسيناميد صورة من فيتامين ب٣. على البشرة مذكور إنه بيقلل الدهون، وبيدعم حاجز البشرة بتقليل فقدان المية، وبيحسّن عدم توحّد اللون.' },
  { key: 'function.salicylic-acid', subjectType: 'INGREDIENT', subjectKey: 'salicylic-acid', topic: 'FUNCTION', careArea: 'skin', source: 'dermnetSalicylic',
    en: 'Salicylic acid is a keratolytic: it loosens thickened, scaly skin. In acne care it opens clogged pores.',
    ar: 'حمض الساليسيليك مادة مقشّرة (كيراتوليتيك): بيفكك الجلد السميك والمتقشّر، وفي العناية بالحبوب بيفتح المسام المسدودة.' },
  { key: 'function.benzoyl-peroxide', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'benzoyl-peroxide', topic: 'FUNCTION', careArea: 'skin', source: 'aadAcneTreat',
    en: 'Benzoyl peroxide reduces acne-causing bacteria on the skin.',
    ar: 'البنزويل بيروكسايد بيقلل البكتيريا المسببة لحب الشباب على البشرة.' },
  { key: 'function.azelaic-acid', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'azelaic-acid', topic: 'FUNCTION', careArea: 'skin', source: 'dermnetAzelaic',
    en: 'Azelaic acid is used for comedonal and inflammatory acne and also helps reduce pigmentation, which makes it useful when acne spots leave brown marks.',
    ar: 'حمض الأزيليك بيتستخدم مع حبوب الشباب بأنواعها وبيساعد كمان على تقليل التصبغ، فمفيد لما الحبوب تسيب آثار بنية.' },
  { key: 'function.retinoids', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'retinoids', topic: 'FUNCTION', careArea: 'skin', source: 'aadRetinoid',
    en: 'Retinoids (including retinol) are vitamin A derivatives used for mild acne, uneven pigmentation and fine lines.',
    ar: 'الريتينويدات (ومنها الريتينول) مشتقات فيتامين أ بتتستخدم مع حب الشباب الخفيف وعدم توحّد اللون والخطوط الرفيعة.' },
  { key: 'function.hyaluronic-acid', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'hyaluronic-acid', topic: 'FUNCTION', careArea: 'skin', source: 'aadDrySkin',
    en: 'Hyaluronic acid is one of the moisturizing ingredients dermatologists suggest looking for in a cream for dry skin.',
    ar: 'حمض الهيالورونيك من المكونات المرطبة اللي أطباء الجلدية بينصحوا بيها في كريم البشرة الجافة.' },
  { key: 'function.glycerin', subjectType: 'INGREDIENT', subjectKey: 'glycerin', topic: 'FUNCTION', careArea: 'skin', source: 'dermnetEmollients',
    en: 'Glycerin is a humectant: it attracts and holds water in the outer layer of the skin.',
    ar: 'الجلسرين مادة جاذبة للرطوبة: بيشد المية ويحتفظ بيها في الطبقة الخارجية من البشرة.' },
  { key: 'function.vitamin-c', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'vitamin-c', topic: 'FUNCTION', careArea: 'skin', source: 'dermnetVitaminC',
    en: 'Vitamin C (ascorbic acid and its derivatives) is an antioxidant used in skin care.',
    ar: 'فيتامين سي (حمض الأسكوربيك ومشتقاته) مضاد أكسدة بيتستخدم في منتجات العناية بالبشرة.' },
  { key: 'limitation.vitamin-c', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'vitamin-c', topic: 'LIMITATION', careArea: 'skin', source: 'dermnetVitaminC',
    en: 'Many vitamin C formulations contain low concentrations that are not well absorbed, so results depend on the formulation.',
    ar: 'تركيبات كتير من فيتامين سي تركيزها قليل وامتصاصها ضعيف، فالنتيجة بتعتمد على التركيبة نفسها.' },

  // ── Precautions ───────────────────────────────────────────────────────────────────────────────
  { key: 'precaution.retinoids.pregnancy', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'retinoids', topic: 'PRECAUTION', careArea: 'skin', source: 'aadRetinoid',
    en: 'Retinoids should not be used during pregnancy.',
    ar: 'الريتينويدات مش بتتستخدم أثناء الحمل.', confidence: 0.9 },
  { key: 'precaution.retinoids.start', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'retinoids', topic: 'PRECAUTION', careArea: 'skin', source: 'aadRetinoid',
    en: 'Retinoids can irritate and make skin more sensitive to the sun: start with a mild formula every other night, use it at night, and use sun protection during the day.',
    ar: 'الريتينويدات ممكن تهيّج وتخلي البشرة أكتر حساسية للشمس: ابدئي بتركيبة خفيفة يوم ويوم، بالليل بس، ومع حماية من الشمس بالنهار.' },
  { key: 'precaution.hydroxy-acids.sun', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'hydroxy-acids', topic: 'PRECAUTION', careArea: 'skin', source: 'fdaAha',
    en: 'Alpha hydroxy acids such as glycolic and lactic acid may increase the skin’s sensitivity to the sun: use a sunscreen and limit sun exposure while using them and for a week afterwards.',
    ar: 'أحماض ألفا هيدروكسي زي الجليكوليك واللاكتيك ممكن تزوّد حساسية البشرة للشمس: استخدمي واقي شمس وقللي التعرّض للشمس طول فترة الاستخدام ولأسبوع بعدها.', confidence: 0.9 },
  { key: 'precaution.benzoyl-peroxide.bleach', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'benzoyl-peroxide', topic: 'PRECAUTION', careArea: 'skin', source: 'dermnetBenzoyl',
    en: 'Benzoyl peroxide can bleach clothing, towels and bedding; let it dry completely before the skin touches fabric.',
    ar: 'البنزويل بيروكسايد ممكن يبهّت لون الهدوم والفوط والمفارش؛ سيبيه ينشف خالص قبل ما البشرة تلمس القماش.' },
  { key: 'precaution.benzoyl-peroxide.pregnancy', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'benzoyl-peroxide', topic: 'PRECAUTION', careArea: 'skin', source: 'aadPregnancyAcne',
    en: 'During pregnancy, benzoyl peroxide is said to be safe in limited amounts, and the advice is to talk with your obstetrician or dermatologist before using it.',
    ar: 'أثناء الحمل البنزويل بيروكسايد مذكور إنه آمن بكميات محدودة، والنصيحة إنك تكلمي دكتور النسا أو الجلدية قبل استخدامه.' },
  { key: 'precaution.salicylic-acid.pregnancy', subjectType: 'INGREDIENT', subjectKey: 'salicylic-acid', topic: 'PRECAUTION', careArea: 'skin', source: 'aadPregnancyAcne',
    en: 'During pregnancy, salicylic acid is generally considered safe when used for a limited time, and the advice is to talk with your obstetrician or dermatologist first.',
    ar: 'أثناء الحمل حمض الساليسيليك بيعتبر آمن في العموم لفترة محدودة، والنصيحة إنك تكلمي دكتور النسا أو الجلدية الأول.' },
  { key: 'precaution.azelaic-acid.pregnancy', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'azelaic-acid', topic: 'PRECAUTION', careArea: 'skin', source: 'aadPregnancyAcne',
    en: 'Azelaic acid is thought to be safe to use during pregnancy; check with your doctor.',
    ar: 'حمض الأزيليك مذكور إنه آمن أثناء الحمل؛ راجعي دكتورك.' },
  { key: 'precaution.fragrance.dry-skin', subjectType: 'INGREDIENT_FAMILY', subjectKey: 'fragrance', topic: 'PRECAUTION', careArea: 'skin', source: 'aadDrySkin',
    en: 'For dry or sensitive skin, dermatologists recommend products labelled “fragrance-free”; “unscented” products can still contain chemicals that mask odors.',
    ar: 'للبشرة الجافة أو الحساسة أطباء الجلدية بيرشحوا المنتجات المكتوب عليها «خالي من العطر»؛ منتجات «بدون رائحة» ممكن يبقى فيها مواد بتخفي الريحة.' },
  { key: 'general.acne.timeline', subjectType: 'CONCERN', subjectKey: 'acne', topic: 'LIMITATION', concernSlug: 'acne', careArea: 'skin', source: 'aadAcneWontClear',
    en: 'Give an acne treatment at least 4 weeks to work; switching products every few days can irritate the skin and worsen acne.',
    ar: 'ادّي علاج الحبوب ٤ أسابيع على الأقل عشان يبان مفعوله؛ تغيير المنتجات كل كام يوم ممكن يهيّج البشرة ويزوّد الحبوب.' },
  { key: 'general.hair-loss.policy', subjectType: 'CONCERN', subjectKey: 'hair-loss', topic: 'LIMITATION', concernSlug: 'hair-loss', careArea: 'hair', source: 'shinacarePolicy', evidenceClass: 'INFERENCE',
    en: 'Shampoos and conditioners care for the hair and scalp. ShinaCare does not present a cosmetic hair product as a treatment for hair loss.',
    ar: 'الشامبو والبلسم عناية بالشعر والفروة. شينا كير مش بتقدّم أي منتج تجميلي للشعر على إنه علاج للتساقط.', confidence: 1 },

  // ── When a store is not enough ────────────────────────────────────────────────────────────────
  { key: 'escalation.acne', subjectType: 'CONCERN', subjectKey: 'acne', topic: 'ESCALATION', concernSlug: 'acne', careArea: 'skin', source: 'nhsAcne',
    en: 'See a doctor if you have lots of spots, if they are deep, painful or leaving scars, if there are signs of infection, or if treating it yourself is not helping.',
    ar: 'شوفي دكتور لو الحبوب كتير، أو عميقة ومؤلمة أو بتسيب ندبات، أو فيه علامات عدوى، أو لو العناية في البيت مش جايبة نتيجة.', confidence: 0.9 },
  { key: 'escalation.blackheads-pimples', subjectType: 'CONCERN', subjectKey: 'blackheads-pimples', topic: 'ESCALATION', concernSlug: 'blackheads-pimples', careArea: 'skin', source: 'nhsAcne',
    en: 'See a doctor if spots are deep, painful or leaving scars, or if treating them yourself is not helping.',
    ar: 'شوفي دكتور لو الحبوب عميقة ومؤلمة أو بتسيب ندبات، أو لو العناية في البيت مش جايبة نتيجة.', confidence: 0.9 },
  { key: 'escalation.dandruff', subjectType: 'CONCERN', subjectKey: 'dandruff', topic: 'ESCALATION', concernSlug: 'dandruff', careArea: 'hair', source: 'nhsDandruff',
    en: 'Use a dandruff shampoo for up to 4 weeks; see a doctor if it does not get better in a month.',
    ar: 'استخدمي شامبو القشرة لحد ٤ أسابيع؛ ولو مفيش تحسّن خلال شهر شوفي دكتور.', confidence: 0.9 },
  { key: 'escalation.hair-loss', subjectType: 'CONCERN', subjectKey: 'hair-loss', topic: 'ESCALATION', concernSlug: 'hair-loss', careArea: 'hair', source: 'nhsHairLoss',
    en: 'Losing 50 to 100 hairs a day is normal. If you are worried about hair loss, see a doctor to find the cause before trying treatments.',
    ar: 'طبيعي نفقد من ٥٠ لـ١٠٠ شعرة في اليوم. لو قلقانة من التساقط شوفي دكتور يعرف السبب قبل ما تجربي علاجات.', confidence: 0.9 },
  { key: 'escalation.dryness', subjectType: 'CONCERN', subjectKey: 'dryness', topic: 'ESCALATION', concernSlug: 'dryness', careArea: 'skin', source: 'aadDrySkin',
    en: 'If skin stays dry after following the care tips, see a dermatologist: very dry skin can come from an underlying condition.',
    ar: 'لو الجفاف مستمر بعد الالتزام بالعناية شوفي دكتور جلدية: الجفاف الشديد ممكن يكون وراه سبب صحي.', confidence: 0.9 },

  // ── One-paragraph overview per concern (what the Corner page says) ───────────────────────────────
  { key: 'overview.acne', subjectType: 'CONCERN', subjectKey: 'acne', topic: 'OVERVIEW', concernSlug: 'acne', careArea: 'skin', source: 'aadAcneTips',
    en: 'Acne care is gentle and patient: non-comedogenic products, a gentle cleanser, daily sunscreen, and time for each product to work.',
    ar: 'العناية بحب الشباب محتاجة لُطف وصبر: منتجات مش بتسد المسام، غسول لطيف، واقي شمس يومي، ووقت كفاية لكل منتج.' },
  { key: 'overview.blackheads-pimples', subjectType: 'CONCERN', subjectKey: 'blackheads-pimples', topic: 'OVERVIEW', concernSlug: 'blackheads-pimples', careArea: 'skin', source: 'aadAcneTreat',
    en: 'Pimples and blackheads start in clogged pores; care focuses on gentle cleansing and ingredients that keep pores open.',
    ar: 'الحبوب والرؤوس السوداء بتبدأ من مسام مسدودة؛ العناية بتركّز على تنضيف لطيف ومكونات بتفتح المسام.' },
  { key: 'overview.dryness', subjectType: 'CONCERN', subjectKey: 'dryness', topic: 'OVERVIEW', concernSlug: 'dryness', careArea: 'skin', source: 'aadDrySkin',
    en: 'Dry skin is relieved by moisturizing often, right after washing, with gentle fragrance-free products.',
    ar: 'جفاف البشرة بيهدى بالترطيب المتكرر، بعد الغسيل على طول، وبمنتجات لطيفة من غير عطر.' },
  { key: 'overview.oily-skin', subjectType: 'CONCERN', subjectKey: 'oily-skin', topic: 'OVERVIEW', concernSlug: 'oily-skin', careArea: 'skin', source: 'aadOilySkin',
    en: 'Oily skin does best with a gentle foaming wash, an oil-free moisturizer and sunscreen; harsh products can trigger more oil.',
    ar: 'البشرة الدهنية بيناسبها غسول رغوي لطيف ومرطب خالي من الزيوت وواقي شمس؛ المنتجات القاسية ممكن تزوّد الدهون.' },
  { key: 'overview.sun-protection', subjectType: 'CONCERN', subjectKey: 'sun-protection', topic: 'OVERVIEW', concernSlug: 'sun-protection', careArea: 'skin', source: 'aadSelectSunscreen',
    en: 'Everyday sun protection means a broad-spectrum, water-resistant sunscreen of SPF 30 or higher, reapplied outdoors.',
    ar: 'الحماية اليومية من الشمس معناها واقي واسع الطيف مقاوم للمية SPF 30 أو أعلى، وبيتجدد برّه البيت.' },
  { key: 'overview.sun-tan', subjectType: 'CONCERN', subjectKey: 'sun-tan', topic: 'OVERVIEW', concernSlug: 'sun-tan', careArea: 'skin', source: 'fdaSunscreen',
    en: 'Limiting sun exposure and using a broad spectrum sunscreen regularly is the base of protecting skin from the sun.',
    ar: 'تقليل التعرّض للشمس والانتظام على واقي واسع الطيف هو أساس حماية البشرة من الشمس.' },
  { key: 'overview.dark-spots', subjectType: 'CONCERN', subjectKey: 'dark-spots', topic: 'OVERVIEW', concernSlug: 'dark-spots', careArea: 'skin', source: 'aadDarkSpots',
    en: 'Dark spots can fade with time and the right ingredients, such as azelaic acid, glycolic acid, vitamin C or a retinoid.',
    ar: 'البقع الداكنة ممكن تفتح مع الوقت والمكونات المناسبة زي حمض الأزيليك أو الجليكوليك أو فيتامين سي أو الريتينويد.' },
  { key: 'overview.brightening', subjectType: 'CONCERN', subjectKey: 'brightening', topic: 'OVERVIEW', concernSlug: 'brightening', careArea: 'skin', source: 'aadDarkSpots',
    en: 'An even tone comes from fading dark spots with ingredients such as vitamin C, not from changing your natural skin color.',
    ar: 'توحيد اللون بييجي من تفتيح البقع الداكنة بمكونات زي فيتامين سي، مش من تغيير لون بشرتك الطبيعي.', evidenceClass: 'INFERENCE' },
  { key: 'overview.dandruff', subjectType: 'CONCERN', subjectKey: 'dandruff', topic: 'OVERVIEW', concernSlug: 'dandruff', careArea: 'hair', source: 'aadDandruff',
    en: 'Dandruff is managed with a dandruff shampoo used as its label says; alternating active ingredients can help.',
    ar: 'القشرة بيتم التعامل معاها بشامبو للقشرة بيتستخدم زي ما مكتوب على عبوته، والتبديل بين المواد الفعالة ممكن يساعد.' },
  { key: 'overview.hair-loss', subjectType: 'CONCERN', subjectKey: 'hair-loss', topic: 'OVERVIEW', concernSlug: 'hair-loss', careArea: 'hair', source: 'aadHairShedding',
    en: 'It is normal to shed between 50 and 100 hairs a day; shedding more than that after stress or illness often stops on its own.',
    ar: 'طبيعي نفقد من ٥٠ لـ١٠٠ شعرة في اليوم؛ التساقط الزايد بعد ضغط أو تعب في أغلب الأحيان بيقف لوحده.' },
  { key: 'overview.dry-damaged-hair', subjectType: 'CONCERN', subjectKey: 'dry-damaged-hair', topic: 'OVERVIEW', concernSlug: 'dry-damaged-hair', careArea: 'hair', source: 'aadHealthyHair',
    en: 'Dry hair does best when shampoo goes on the scalp, conditioner follows every wash, and the hair is handled gently.',
    ar: 'الشعر الجاف بيناسبه إن الشامبو يبقى على الفروة، والبلسم بعد كل غسلة، والتعامل معاه بلُطف.' },
];
