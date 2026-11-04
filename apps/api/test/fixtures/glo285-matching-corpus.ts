// GLO-285 matching benchmark corpus. SYNTHETIC: invented SKUs, invented GTINs (restricted prefix 29) and rule-derived labels.
// Brand names are the allowlist's, the products under them are not real. It measures regressions, never production accuracy.

export const gtin = (payload: string) => payload + (10 - [...payload].reverse().reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 1 : 3), 0) % 10) % 10;

export interface CorpusBrand { name: string; arabic: string; misspellings: string[]; formatting?: string[] }
export const BRANDS: CorpusBrand[] = [
  { name: 'CeraVe', arabic: 'سيرافي', misspellings: ['Ceravee', 'Cera Vee', 'سيرافيي', 'سرافى', 'سيراڤي'] },
  { name: 'Bioderma', arabic: 'بيوديرما', misspellings: ['Bioderm', 'Biodermaa', 'بيودرما', 'بايوديرما'] },
  { name: 'La Roche-Posay', arabic: 'لاروش بوزيه', misspellings: ['La Roche Posey', 'LRP', 'لاروش', 'لا روش بوزي'] },
  { name: 'Vichy', arabic: 'فيشي', misspellings: ['Vichi', 'Vishy', 'ڤيشي'], formatting: ['فيشى'] },
  { name: 'Eva', arabic: 'ايفا', misspellings: ['Evaa', 'إيڤا'] },
  { name: 'StarVille', arabic: 'ستارفيل', misspellings: ['Star Vill', 'Starvile', 'ستارڤيل'], formatting: ['ستار فيل'] },
  { name: 'Shaan', arabic: 'شان', misspellings: ['Shan', 'Shaann'] },
  { name: 'Strongville', arabic: 'سترونجفيل', misspellings: ['Strongvile', 'سترونغفيل'], formatting: ['Strong Ville', 'سترونج فيل'] },
  { name: 'Bobai', arabic: 'بوباي', misspellings: ['Bobay', 'Boobai', 'بوبااي'] },
  { name: 'Dermactive', arabic: 'ديرماكتيف', misspellings: ['Dermaactive', 'ديرما اكتيف'], formatting: ['Derm Active', 'ديرم اكتيف'] },
];

export interface Family {
  key: string; english: string; arabic: string; phonetic: string;
  packs: Array<{ size: number; unit: 'ml' | 'g'; pack?: number }>;
  /** Sibling whose wording contradicts this family at the same packaging. */
  contradicts?: string;
}
export const FAMILIES: Family[] = [
  { key: 'hydra-cleanser', english: 'Hydrating Facial Cleanser', arabic: 'غسول مرطب للوجه', phonetic: 'هيدراتينج فيشيال كلينزر', packs: [{ size: 88, unit: 'ml' }, { size: 236, unit: 'ml' }, { size: 473, unit: 'ml' }], contradicts: 'foam-cleanser' },
  { key: 'foam-cleanser', english: 'Foaming Facial Cleanser', arabic: 'غسول رغوي للوجه', phonetic: 'فومينج فيشيال كلينزر', packs: [{ size: 236, unit: 'ml' }, { size: 473, unit: 'ml' }], contradicts: 'gel-cleanser' },
  { key: 'gel-cleanser', english: 'Purifying Gel Cleanser For Oily Skin', arabic: 'غسول جل منقي للبشرة الدهنية', phonetic: 'بيوريفاينج جيل كلينزر للبشرة الدهنية', packs: [{ size: 236, unit: 'ml' }] },
  { key: 'moist-cream', english: 'Moisturizing Cream', arabic: 'كريم مرطب', phonetic: 'مويسترايزينج كريم', packs: [{ size: 50, unit: 'g' }, { size: 340, unit: 'g' }], contradicts: 'night-cream' },
  { key: 'daily-lotion', english: 'Daily Moisturizing Lotion', arabic: 'لوشن مرطب يومي', phonetic: 'ديلي مويسترايزينج لوشن', packs: [{ size: 236, unit: 'ml' }, { size: 236, unit: 'ml', pack: 2 }] },
  { key: 'retinol-03', english: 'Retinol Serum 0.3%', arabic: 'سيروم ريتينول ٠٫٣٪', phonetic: 'ريتينول سيروم ٠٫٣٪', packs: [{ size: 30, unit: 'ml' }], contradicts: 'retinol-1' },
  { key: 'retinol-1', english: 'Retinol Serum 1%', arabic: 'سيروم ريتينول ١٪', phonetic: 'ريتينول سيروم ١٪', packs: [{ size: 30, unit: 'ml' }], contradicts: 'niacinamide' },
  { key: 'niacinamide', english: 'Niacinamide Serum 10%', arabic: 'سيروم نياسيناميد ١٠٪', phonetic: 'نياسيناميد سيروم ١٠٪', packs: [{ size: 30, unit: 'ml' }], contradicts: 'vitamin-c' },
  { key: 'vitamin-c', english: 'Vitamin C Serum', arabic: 'سيروم فيتامين سي', phonetic: 'فيتامين سي سيروم', packs: [{ size: 30, unit: 'ml' }], contradicts: 'hyaluronic' },
  { key: 'hyaluronic', english: 'Hyaluronic Acid Serum', arabic: 'سيروم هيالورونيك اسيد', phonetic: 'هيالورونيك اسيد سيروم', packs: [{ size: 30, unit: 'ml' }] },
  { key: 'sun-30', english: 'Sunscreen SPF 30', arabic: 'واقي شمس SPF 30', phonetic: 'صن سكرين اس بي اف 30', packs: [{ size: 50, unit: 'ml' }], contradicts: 'sun-50' },
  { key: 'sun-50', english: 'Sunscreen SPF 50', arabic: 'واقي شمس عامل حماية ٥٠', phonetic: 'صن سكرين اس بي اف 50', packs: [{ size: 50, unit: 'ml' }] },
  { key: 'dandruff', english: 'Anti Dandruff Shampoo', arabic: 'شامبو ضد القشرة', phonetic: 'انتي داندرف شامبو', packs: [{ size: 200, unit: 'ml' }, { size: 400, unit: 'ml' }], contradicts: 'hair-fall' },
  { key: 'hair-fall', english: 'Anti Hair Fall Shampoo', arabic: 'شامبو ضد التساقط', phonetic: 'انتي هير فول شامبو', packs: [{ size: 200, unit: 'ml' }, { size: 400, unit: 'ml' }] },
  { key: 'repair-cond', english: 'Repair Conditioner', arabic: 'بلسم ريباير', phonetic: 'ريباير كوندشنر', packs: [{ size: 200, unit: 'ml' }] },
  { key: 'hair-mask', english: 'Nourishing Hair Mask', arabic: 'ماسك مغذي للشعر', phonetic: 'نوريشينج هير ماسك', packs: [{ size: 200, unit: 'ml' }] },
  { key: 'night-cream', english: 'Night Cream', arabic: 'كريم ليلي', phonetic: 'نايت كريم', packs: [{ size: 50, unit: 'g' }], contradicts: 'day-cream' },
  { key: 'day-cream', english: 'Day Cream', arabic: 'كريم نهاري', phonetic: 'داي كريم', packs: [{ size: 50, unit: 'g' }] },
  { key: 'bright-toner', english: 'Brightening Toner', arabic: 'تونر تفتيح', phonetic: 'برايتنينج تونر', packs: [{ size: 200, unit: 'ml' }] },
  { key: 'micellar', english: 'Micellar Water', arabic: 'ماء ميسيلار', phonetic: 'ميسيلار ووتر', packs: [{ size: 400, unit: 'ml' }] },
];
/**
 * Written once and never tuned against: product wording largely outside the matcher's vocabulary (botanicals, slang
 * descriptors, words with no phonetic twin). This is the honest estimate of how the rules generalise to unseen wording.
 */
export const HELD_OUT_FAMILIES: Family[] = [
  { key: 'aloe-gel', english: 'Aloe Vera Soothing Gel', arabic: 'جل الصبار المهدئ', phonetic: 'الو فيرا سوذينج جيل', packs: [{ size: 150, unit: 'ml' }, { size: 300, unit: 'ml' }] },
  { key: 'tea-tree-wash', english: 'Tea Tree Face Wash', arabic: 'غسول شجرة الشاي للوجه', phonetic: 'تي تري فيس واش', packs: [{ size: 150, unit: 'ml' }], contradicts: 'charcoal-wash' },
  { key: 'charcoal-wash', english: 'Charcoal Deep Clean Face Wash', arabic: 'غسول الفحم للتنظيف العميق', phonetic: 'شاركول ديب كلين فيس واش', packs: [{ size: 150, unit: 'ml' }] },
  { key: 'rosehip-oil', english: 'Rosehip Glow Oil', arabic: 'زيت ثمر الورد للنضارة', phonetic: 'روزهيب جلو اويل', packs: [{ size: 30, unit: 'ml' }] },
  { key: 'snail-cream', english: 'Snail Mucin Recovery Cream', arabic: 'كريم مخاط الحلزون', phonetic: 'سنيل ميوسين ريكفري كريم', packs: [{ size: 50, unit: 'g' }] },
  { key: 'centella-toner', english: 'Centella Calm Toner', arabic: 'تونر السنتيلا المهدئ', phonetic: 'سنتيلا كالم تونر', packs: [{ size: 200, unit: 'ml' }] },
  { key: 'coconut-shampoo', english: 'Coconut Milk Shampoo', arabic: 'شامبو حليب جوز الهند', phonetic: 'كوكونت ميلك شامبو', packs: [{ size: 400, unit: 'ml' }], contradicts: 'blackseed-shampoo' },
  { key: 'blackseed-shampoo', english: 'Black Seed Strength Shampoo', arabic: 'شامبو حبة البركة للتقوية', phonetic: 'بلاك سيد سترينث شامبو', packs: [{ size: 400, unit: 'ml' }] },
  { key: 'keratin-mask', english: 'Keratin Smooth Hair Mask', arabic: 'ماسك كيراتين لفرد الشعر', phonetic: 'كيراتين سموث هير ماسك', packs: [{ size: 300, unit: 'g' }] },
  { key: 'mineral-sun', english: 'Mineral Sun Fluid SPF 50', arabic: 'واقي شمس معدني سائل عامل حماية ٥٠', phonetic: 'مينرال صن فلويد اس بي اف 50', packs: [{ size: 40, unit: 'ml' }] },
];
export const HELD_OUT_LINES: Array<[string, string]> = [['Orvane', 'اورفان'], ['Teravia', 'تيرافيا'], ['Bellessa', 'بيليسا'], ['Quintara', 'كوينتارا'], ['Ravenna', 'رافينا'],
  ['Elmora', 'المورا'], ['Sunara', 'سونارا'], ['Fiora', 'فيورا'], ['Marisol', 'ماريسول'], ['Nokara', 'نوكارا']];

// Each brand's invented line word, so that a brand's products do not differ only by vocabulary the matcher already knows.
const LINES: Array<[string, string]> = [['Velora', 'فيلورا'], ['Lumina', 'لومينا'], ['Aquaris', 'اكواريس'], ['Solera', 'سوليرا'], ['Nivara', 'نيفارا'],
  ['Mirelle', 'ميريل'], ['Zerina', 'زيرينا'], ['Dalmora', 'دالمورا'], ['Kalina', 'كالينا'], ['Sentara', 'سينتارا']];

const NEW_PRODUCTS: Array<[string, string]> = [['Rose Water Face Mist', 'بخاخ ماء الورد للوجه'], ['Kids Sun Stick SPF 50', 'ستيك شمس للاطفال عامل حماية ٥٠'],
  ['Tea Tree Spot Gel', 'جل شجرة الشاي للحبوب'], ['Charcoal Peel Mask', 'ماسك فحم مقشر'], ['Beard Growth Oil', 'زيت نمو اللحية'], ['Lip Repair Balm', 'بالم اصلاح الشفايف']];

export interface CatalogSku { key: string; brand: string; product: string; productKey: string; size: number; unit: string; pack: number | null; barcode: string; spf: number | null; lineArabic: string; line: string; family: Family }

/** Deterministic catalog: every family for every brand, one SKU per packaging. */
export function buildCatalog(families: Family[] = FAMILIES, lines: Array<[string, string]> = LINES): CatalogSku[] {
  const skus: CatalogSku[] = [];
  let serial = 0;
  BRANDS.forEach((brand, b) => families.forEach(family => family.packs.forEach(pack => {
    const [line, lineArabic] = lines[b];
    serial++;
    skus.push({ key: `${brand.name}|${family.key}|${pack.size}${pack.unit}${pack.pack ? `x${pack.pack}` : ''}`, brand: brand.name,
      product: `${line} ${family.english}`, productKey: `${brand.name}|${family.key}`, size: pack.size, unit: pack.unit, pack: pack.pack ?? null,
      barcode: gtin(`29${String(serial).padStart(10, '0')}`), spf: null, line, lineArabic, family });
  })));
  return skus;
}

export interface CorpusRow {
  id: string; kind: string; supplier: 'A' | 'B'; code: string; brand: string; name: string; barcode?: string;
  /** Reviewed SupplierSkuAlias the row's code already has (the key of the SKU it points to). */
  alias?: string;
  /** The SKU the row actually describes; null when it is not in the catalog or the row cannot be identified. */
  knownSku: string | null;
  /** The only SKU a correct system may automatically link this row to. */
  autoSku: string | null;
  allowed: Array<'VERIFIED' | 'CONFLICT' | 'AMBIGUOUS' | 'NEW' | 'INVALID'>;
}

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const toArabicDigits = (value: number | string) => String(value).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
const UNITS_AR: Record<string, string> = { ml: 'مل', g: 'جم' };

/** Common Egyptian keyboard and spelling slips on one non-brand word. */
function arabicTypo(text: string, random: () => number): string {
  const words = text.split(' ');
  const options = words.map((w, i) => [w, i] as const).filter(([w]) => w.length >= 4 && /^[ء-ي]+$/.test(w));
  if (!options.length) return text;
  const [word, index] = options[Math.floor(random() * options.length)];
  const at = 1 + Math.floor(random() * (word.length - 2));
  const ops = [
    () => word.slice(0, at) + word.slice(at + 1),
    () => word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2),
    () => word.slice(0, at) + word[at] + word.slice(at),
    () => word.replace(/ي$/, 'ى').replace(/ة$/, 'ه').replace(/^ا/, 'أ') === word ? word.slice(0, at) + word.slice(at + 1) : word.replace(/ي$/, 'ى').replace(/ة$/, 'ه').replace(/^ا/, 'أ'),
  ];
  words[index] = ops[Math.floor(random() * ops.length)]();
  return words.join(' ');
}
function latinTypo(text: string, random: () => number): string {
  const words = text.split(' ');
  const options = words.map((w, i) => [w, i] as const).filter(([w]) => w.length >= 5 && /^[A-Za-z]+$/.test(w));
  if (!options.length) return text;
  const [word, index] = options[Math.floor(random() * options.length)];
  const at = 1 + Math.floor(random() * (word.length - 2));
  words[index] = random() < 0.5 ? word.slice(0, at) + word.slice(at + 1) : word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2);
  return words.join(' ');
}

/** Labeled rows for one seed. Seed 1 was used while tuning; every other seed is held out from tuning. */
export function buildRows(catalog: CatalogSku[], seed: number, perFamily = 6): CorpusRow[] {
  const random = prng(seed);
  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
  const sample = (where: (sku: CatalogSku) => boolean = () => true) => {
    const pool = catalog.filter(where);
    return pool.length ? Array.from({ length: perFamily }, () => pick(pool)) : [];
  };
  const rows: CorpusRow[] = [];
  let serial = 0;
  const add = (row: Omit<CorpusRow, 'id' | 'code'> & { code?: string }) => rows.push({ ...row, id: `${seed}-${row.kind}-${++serial}`, code: row.code ?? `S${seed}-${serial}` });
  const arabicBrand = (sku: CatalogSku) => BRANDS.find(b => b.name === sku.brand)!.arabic;
  const measure = (sku: CatalogSku) => `${sku.size} ${UNITS_AR[sku.unit]}`;
  const measureAr = (sku: CatalogSku) => `${toArabicDigits(sku.size)} ${UNITS_AR[sku.unit]}`;
  const single = (sku: CatalogSku) => sku.pack === null;
  const ambiguous: CorpusRow['allowed'] = ['AMBIGUOUS'];
  const refuse: CorpusRow['allowed'] = ['CONFLICT', 'AMBIGUOUS'];

  // Known SKUs, no identifier: a reviewer must see the right candidate, and nothing may link automatically.
  for (const sku of sample(single)) add({ kind: 'en_exact', supplier: 'A', brand: sku.brand, name: `${sku.product} ${sku.size}${sku.unit}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });
  for (const sku of sample(single)) add({ kind: 'en_typo', supplier: 'A', brand: sku.brand, name: `${latinTypo(sku.product, random)} ${sku.size}${sku.unit}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });
  for (const sku of sample(single)) add({ kind: 'ar_translation', supplier: 'A', brand: sku.brand, name: `${arabicBrand(sku)} ${sku.lineArabic} ${sku.family.arabic} ${measureAr(sku)}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });
  for (const sku of sample(single)) add({ kind: 'ar_typo', supplier: 'A', brand: sku.brand, name: `${arabicBrand(sku)} ${arabicTypo(`${sku.lineArabic} ${sku.family.arabic}`, random)} ${measure(sku)}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });
  for (const sku of sample(single)) add({ kind: 'transliteration', supplier: 'A', brand: sku.brand, name: `${arabicBrand(sku)} ${sku.lineArabic} ${sku.family.phonetic} ${measure(sku)}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });
  for (const sku of sample(single)) add({ kind: 'mixed_script', supplier: 'A', brand: sku.brand, name: `${sku.brand} ${sku.line} ${sku.family.arabic} ${sku.size}${sku.unit}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });
  for (const sku of sample(single)) add({ kind: 'formatting', supplier: 'A', brand: sku.brand, name: `${arabicBrand(sku).split('').join('ـ')} (${sku.lineArabic.replace(/ا/g, 'أ')})‌ ${sku.family.arabic}  - ${measureAr(sku).replace(' ', '')}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });
  for (const sku of sample(single)) add({ kind: 'short_wording', supplier: 'A', brand: sku.brand, name: `${sku.family.arabic} ${sku.lineArabic} ${measure(sku)}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });
  for (const sku of sample(single)) add({ kind: 'missing_size', supplier: 'A', brand: sku.brand, name: `${arabicBrand(sku)} ${sku.lineArabic} ${sku.family.arabic}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });
  for (const sku of sample(s => s.pack !== null)) add({ kind: 'multipack_notation', supplier: 'A', brand: sku.brand, name: `${sku.product} ${sku.pack} x ${sku.size}${sku.unit}`, knownSku: sku.key, autoSku: null, allowed: ambiguous });

  // Verified mappings: these rows should need no review at all.
  for (const sku of sample(single)) add({ kind: 'gtin_exact', supplier: 'A', brand: sku.brand, name: `${sku.product} ${sku.size}${sku.unit}`, barcode: sku.barcode, knownSku: sku.key, autoSku: sku.key, allowed: ['VERIFIED'] });
  for (const sku of sample(single)) add({ kind: 'gtin_arabic', supplier: 'A', brand: sku.brand, name: `${arabicBrand(sku)} ${sku.lineArabic} ${sku.family.arabic} ${measureAr(sku)}`, barcode: sku.barcode, knownSku: sku.key, autoSku: sku.key, allowed: ['VERIFIED'] });
  for (const sku of sample(single)) add({ kind: 'gtin_digits_ar', supplier: 'B', brand: sku.brand, name: `${sku.product} ${sku.size}${sku.unit}`, barcode: toArabicDigits(sku.barcode), knownSku: sku.key, autoSku: sku.key, allowed: ['VERIFIED'] });
  for (const sku of sample(single)) add({ kind: 'alias_exact', supplier: 'A', alias: sku.key, brand: sku.brand, name: `${sku.product} ${sku.size}${sku.unit}`, knownSku: sku.key, autoSku: sku.key, allowed: ['VERIFIED'] });
  for (const sku of sample(single)) add({ kind: 'alias_arabic', supplier: 'A', alias: sku.key, brand: sku.brand, name: `${arabicBrand(sku)} ${sku.lineArabic} ${sku.family.arabic} ${measure(sku)}`, knownSku: sku.key, autoSku: sku.key, allowed: ['VERIFIED'] });
  for (const sku of sample(single)) {
    // Two suppliers share one canonical SKU through their own reviewed codes.
    const code = `MS${seed}-${++serial}`;
    add({ kind: 'multi_supplier', supplier: 'A', code, alias: sku.key, brand: sku.brand, name: `${sku.product} ${sku.size}${sku.unit}`, knownSku: sku.key, autoSku: sku.key, allowed: ['VERIFIED'] });
    add({ kind: 'multi_supplier', supplier: 'B', code, alias: sku.key, brand: sku.brand, name: `${arabicBrand(sku)} ${sku.lineArabic} ${sku.family.arabic} ${measure(sku)}`, knownSku: sku.key, autoSku: sku.key, allowed: ['VERIFIED'] });
  }

  // Unsafe by construction: a reused code or a GTIN claims one SKU while the row states another.
  const sibling = (sku: CatalogSku) => catalog.find(other => other.brand === sku.brand && other.family.key === sku.family.contradicts &&
    other.size === sku.size && other.unit === sku.unit) ?? null;
  const contradicting = catalog.filter(sku => sibling(sku));
  const pickContradicting = () => contradicting.length ? Array.from({ length: perFamily }, () => pick(contradicting)) : [];
  for (const sku of pickContradicting()) { const other = sibling(sku)!; add({ kind: 'reused_code_formula', supplier: 'A', alias: sku.key, brand: sku.brand, name: `${other.product} ${other.size}${other.unit}`, knownSku: null, autoSku: null, allowed: refuse }); }
  for (const sku of pickContradicting()) { const other = sibling(sku)!; add({ kind: 'reused_code_arabic', supplier: 'A', alias: sku.key, brand: sku.brand, name: `${arabicBrand(sku)} ${other.lineArabic} ${other.family.arabic} ${measure(other)}`, knownSku: null, autoSku: null, allowed: refuse }); }
  for (const sku of pickContradicting()) { const other = sibling(sku)!; add({ kind: 'gtin_formula_conflict', supplier: 'A', barcode: sku.barcode, brand: sku.brand, name: `${other.product} ${other.size}${other.unit}`, knownSku: null, autoSku: null, allowed: refuse }); }
  for (const sku of pickContradicting()) { const other = sibling(sku)!; add({ kind: 'gtin_arabic_conflict', supplier: 'A', barcode: sku.barcode, brand: sku.brand, name: `${arabicBrand(sku)} ${other.lineArabic} ${other.family.arabic} ${measure(other)}`, knownSku: null, autoSku: null, allowed: refuse }); }
  for (const sku of sample(single)) add({ kind: 'alias_size_conflict', supplier: 'A', alias: sku.key, brand: sku.brand, name: `${sku.product} ${sku.size + 7}${sku.unit}`, knownSku: null, autoSku: null, allowed: ['CONFLICT'] });
  for (const sku of sample(single)) add({ kind: 'alias_pack_conflict', supplier: 'A', alias: sku.key, brand: sku.brand, name: `${sku.product} ${sku.size}${sku.unit} Pack of 3`, knownSku: null, autoSku: null, allowed: ['CONFLICT'] });
  for (const sku of sample(single)) add({ kind: 'alias_unit_conflict', supplier: 'A', alias: sku.key, brand: sku.brand, name: `${sku.product} ${sku.size}${sku.unit === 'ml' ? 'g' : 'ml'}`, knownSku: null, autoSku: null, allowed: ['CONFLICT'] });
  for (const sku of sample(single)) add({ kind: 'gtin_size_conflict', supplier: 'A', barcode: sku.barcode, brand: sku.brand, name: `${sku.product} ${sku.size + 7}${sku.unit}`, knownSku: null, autoSku: null, allowed: ['CONFLICT'] });
  for (const sku of sample(single)) { const other = pick(catalog.filter(s => s.brand === sku.brand && s.key !== sku.key)); add({ kind: 'alias_wrong_gtin', supplier: 'A', alias: sku.key, barcode: other.barcode, brand: sku.brand, name: `${sku.product} ${sku.size}${sku.unit}`, knownSku: null, autoSku: null, allowed: ['CONFLICT'] }); }
  for (const sku of sample(single)) add({ kind: 'bad_checksum', supplier: 'A', barcode: sku.barcode.slice(0, -1) + String((Number(sku.barcode.at(-1)) + 1) % 10), brand: sku.brand, name: `${sku.product} ${sku.size}${sku.unit}`, knownSku: sku.key, autoSku: null, allowed: ['AMBIGUOUS'] });
  for (const sku of sample(single)) add({ kind: 'reused_code_vague', supplier: 'A', alias: sku.key, brand: sku.brand, name: `${arabicBrand(sku)} بتاع الحبوب`, knownSku: null, autoSku: null, allowed: refuse });
  for (const sku of sample(single)) { const other = BRANDS.find(b => b.name !== sku.brand)!; add({ kind: 'alias_other_brand', supplier: 'A', alias: sku.key, brand: other.name, name: `${sku.product} ${sku.size}${sku.unit}`, knownSku: null, autoSku: null, allowed: ['CONFLICT'] }); }

  // Not in the catalog: must not be forced onto the nearest product.
  for (let i = 0; i < perFamily; i++) { const brand = pick(BRANDS); const [english] = pick(NEW_PRODUCTS); add({ kind: 'new_en', supplier: 'A', brand: brand.name, name: `${english} 75ml`, knownSku: null, autoSku: null, allowed: ['NEW'] }); }
  for (let i = 0; i < perFamily; i++) { const brand = pick(BRANDS); const [, arabic] = pick(NEW_PRODUCTS); add({ kind: 'new_ar', supplier: 'A', brand: brand.name, name: `${brand.arabic} ${arabic} ٧٥ مل`, knownSku: null, autoSku: null, allowed: ['NEW'] }); }
  return rows;
}

export interface PolicyRow { kind: string; brand: string; category: string; expected: 'ALLOW' | 'HOLD' | 'SKIP'; brandName?: string }

/** Admission rows, including spellings no reviewer has approved: those must HOLD, and only a suggestion may name a brand. */
export function buildPolicyRows(): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const brand of BRANDS) {
    rows.push({ kind: 'canonical', brand: brand.name, category: 'Cleansers', expected: 'ALLOW', brandName: brand.name });
    rows.push({ kind: 'reviewed_arabic', brand: brand.arabic, category: 'غسول الوجه', expected: 'ALLOW', brandName: brand.name });
    rows.push({ kind: 'reviewed_in_title', brand: `${brand.arabic} غسول ٢٣٦ مل`, category: 'Cleansers', expected: 'ALLOW', brandName: brand.name });
    rows.push({ kind: 'reviewed_with_form_word', brand: `${brand.arabic} تونر للوجه`, category: 'Cleansers', expected: 'ALLOW', brandName: brand.name });
    for (const formatted of brand.formatting ?? []) rows.push({ kind: 'format_equivalent', brand: formatted, category: 'Cleansers', expected: 'ALLOW', brandName: brand.name });
    for (const misspelling of brand.misspellings) rows.push({ kind: 'unreviewed_spelling', brand: misspelling, category: 'Cleansers', expected: 'HOLD', brandName: brand.name });
    rows.push({ kind: 'excluded_category', brand: brand.name, category: 'Perfume', expected: 'SKIP' });
  }
  rows.push({ kind: 'denied_brand', brand: 'Excluded Brand', category: 'Cleansers', expected: 'SKIP' });
  rows.push({ kind: 'unknown_brand', brand: 'Totally Unknown', category: 'Cleansers', expected: 'HOLD' });
  rows.push({ kind: 'alternative_claim', brand: 'بديل سيرافي', category: 'Cleansers', expected: 'HOLD' });
  rows.push({ kind: 'two_brands', brand: 'CeraVe Bioderma', category: 'Cleansers', expected: 'HOLD' });
  return rows;
}
