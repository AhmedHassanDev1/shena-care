/**
 * Builds two realistic Arabic supplier price lists (an Egyptian distributor's export: code, Arabic name, public price, discount %, stock) and the oracle that says
 * what each row truly is. Expectations name canonical products by brand + name fragment + size, so the measurement does not depend on generated ids.
 *
 *   node test/fixtures/intake/make-supplier-files.cjs
 *
 * expect: MATCH:<key> (must link to that SKU) | MATCH_OR_CRITICAL:<key> (linking to it or review are both acceptable; anything else is wrong)
 *         | UNMATCHED | SKIPPED | CRITICAL | INVALID
 */
const XLSX = require('xlsx');
const { writeFileSync } = require('fs');
const { join } = require('path');

const K = {
  hydrating: 'CeraVe|Hydrating|236', foaming: 'CeraVe|Foaming|236', cream454: 'CeraVe|Cream|454', sa: 'CeraVe|SA|236',
  niacinamide: 'The Ordinary|Niacinamide|30', hyaluronic: 'The Ordinary|Hyaluronic|30', effaclar: 'La Roche-Posay|Effaclar|200', cicaplast: 'La Roche-Posay|Cicaplast|40',
  cetaphil: 'Cetaphil|Gentle|236', bioderma: 'Bioderma|Sensibio|250', eucerin: 'Eucerin|DermoPurifyer|200', vichy: 'Vichy|Mineral 89|50', garnier: 'Garnier|Micellar|400',
};

// [code, name, publicPrice, discount, stock, expect]
const FILE1 = [
  ['CV101', 'سيرافي غسول مرطب للبشرة العادية الى الجافة 236 مل', '٨٥٠', 20, 14, `MATCH:${K.hydrating}`],
  ['CV102', 'سيرافي غسول رغوي للبشرة العادية الى الدهنية 236 مل', '850', 20, 9, `MATCH:${K.foaming}`],
  ['CV103', 'سيرافي كريم مرطب 454 جم', '1,250', 20, 6, `MATCH:${K.cream454}`],
  ['CV104', 'سيرافي غسول SA مقشر لطيف 236 مل', '920 ج.م', 20, 4, `MATCH_OR_CRITICAL:${K.sa}`],
  ['CV105', 'سيرافي غسول مرطب 473 مل', '1350', 20, 3, 'UNMATCHED'],
  ['CV106', 'سيرافي كريم مرطب 340 جم', '990', 20, 5, 'UNMATCHED'],
  ['CV107', 'سيرافي غسول 236 مل', '850', 20, 2, 'CRITICAL'],
  ['CV108', 'سيرافي لوشن مرطب 236 مل', '780', 20, 7, 'UNMATCHED'],
  ['TO201', 'ذا اورديناري سيروم نياسيناميد 10% + زنك 1% 30 مل', '٦٥٠', 15, 20, `MATCH:${K.niacinamide}`],
  ['TO202', 'ذا اورديناري هيالورونيك اسيد 2% + B5 سيروم 30مل', '690', 15, 11, `MATCH:${K.hyaluronic}`],
  ['TO203', 'ذا اورديناري ريتينول 0.5% في سكوالين 30 مل', '720', 15, 8, 'UNMATCHED'],
  ['TO204', 'ذا اورديناري نياسيناميد 10% 60 مل', '1100', 15, 3, 'UNMATCHED'],
  ['LR301', 'لاروش بوزيه افاكلار جل رغوي منظف 200 مل', '1,150.00', 18, 5, `MATCH:${K.effaclar}`],
  ['LR302', 'لاروش بوزيه سيكابلاست بالم B5 40 مل', '780', 18, 9, `MATCH_OR_CRITICAL:${K.cicaplast}`],
  ['LR303', 'لاروش بوزيه انثيليوس واقي شمس 50 مل', '1450', 18, 4, 'UNMATCHED'],
  ['CT401', 'سيتافيل غسول لطيف للبشرة 236 مل', '520', 20, 30, `MATCH:${K.cetaphil}`],
  ['BD501', 'بيوديرما سنسيبيو ماء ميسيلار 250 مل', '640', 15, 12, `MATCH_OR_CRITICAL:${K.bioderma}`],
  ['EU601', 'يوسيرين ديرموبيوريفاير جل منظف 200 مل', '760', 15, 6, `MATCH:${K.eucerin}`],
  ['VC701', 'فيشي مينيرال 89 سيروم 50 مل', '1,390', 15, 4, `MATCH:${K.vichy}`],
  ['GR801', 'جارنييه ماء ميسيلار 400 مل', '310', 25, 40, `MATCH:${K.garnier}`],
  ['GR802', 'جارنييه صبغة شعر 6.0 اشقر غامق', '160', 25, 40, 'UNMATCHED'],
  ['NV901', 'نيفيا كريم مرطب 200 مل', '210', 20, 50, 'UNMATCHED'],
  ['SV902', 'ستارفيل غسول للبشرة الدهنية 200 مل', '185', 20, 25, 'UNMATCHED'],
  ['SB903', 'سيباميد غسول سائل للوجه 200 مل', '420', 20, 10, 'UNMATCHED'],
  ['AV904', 'Avene Thermal Spring Water 150ml', '480', 15, 8, 'UNMATCHED'],
  ['UR905', 'Uriage Hyseac Cleansing Gel 150ml', '450', 15, 7, 'UNMATCHED'],
  ['DV906', 'دوف شامبو للشعر التالف 400 مل', '140', 20, 60, 'UNMATCHED'],
  ['PN907', 'بانتين بلسم 360 مل', '150', 20, 40, 'UNMATCHED'],
  ['RX001', 'بانادول اكسترا 24 قرص', '75', 10, 200, 'SKIPPED'],
  ['RX002', 'كونجستال 20 قرص', '42', 10, 150, 'SKIPPED'],
  ['RX003', 'اوجمنتين 1 جم 14 قرص', '160', 10, 80, 'SKIPPED'],
  ['RX004', 'توسيفان شراب للكحة 120 مل', '38', 10, 90, 'SKIPPED'],
  ['RX005', 'فيتامين سي 1000 مجم 20 قرص فوار', '95', 10, 70, 'SKIPPED'],
  ['BB001', 'بامبرز حفاضات مقاس 4 عدد 52', '420', 8, 30, 'SKIPPED'],
  ['BB002', 'حليب اطفال بيبيلاك 1 400 جم', '260', 5, 25, 'SKIPPED'],
  ['MK001', 'ميبيلين روج سوبر ستاي', '390', 20, 12, 'SKIPPED'],
  ['MK002', 'لوريال ماسكارا فولوم مليون لاش', '450', 20, 10, 'SKIPPED'],
  ['FR001', 'عطر ايفا للرجال 100 مل', '230', 20, 15, 'SKIPPED'],
  ['OC001', 'سيجنال معجون اسنان 100 مل', '45', 10, 100, 'SKIPPED'],
  ['OC002', 'ليسترين غسول فم 250 مل', '115', 10, 60, 'SKIPPED'],
  ['SH001', 'جيليت شفرات بلو 2 عدد 5', '85', 10, 40, 'SKIPPED'],
  ['DV001', 'ترمومتر ديجيتال', '120', 10, 20, 'SKIPPED'],
  ['CV101', 'سيرافي غسول مرطب للبشرة العادية الى الجافة 236 مل', '٨٥٠', 20, 14, 'SKIPPED'],
  ['XX001', 'كريم تفتيح مجهول 50 مل', '120', 10, 10, 'INVALID'],
  ['XX001', 'كريم تفتيح مجهول 50 مل', '135', 10, 10, 'INVALID'],
  ['XX002', 'غسول بدون سعر 200 مل', 'اتصل', 10, 5, 'INVALID'],
  ['XX003', '', '100', 10, 5, 'INVALID'],
];

// A week later: some prices changed, one product out of stock, rows reordered, two products worded differently.
const FILE2 = [
  ['GR801', 'جارنييه ماء ميسيلار 400 مل', '330', 25, 35, `MATCH:${K.garnier}`],
  ['CV101', 'سيرافي غسول مرطب للبشرة العادية الى الجافة 236 مل', '٨٩٠', 20, 10, `MATCH:${K.hydrating}`],
  ['CV102', 'سيرافي غسول رغوي للبشرة العادية الى الدهنية 236 مل', '850', 20, 9, `MATCH:${K.foaming}`],
  ['CV103', 'سيرافي كريم مرطب 454 جم', '1,250', 20, 0, `MATCH:${K.cream454}`],
  ['TO201', 'ذا اورديناري سيروم نياسيناميد 10% + زنك 1% 30 مل', '٦٥٠', 15, 20, `MATCH:${K.niacinamide}`],
  ['TO202', 'ذا اورديناري هيالورونيك اسيد 2% + B5 سيروم 30مل', '720', 15, 11, `MATCH:${K.hyaluronic}`],
  ['LR301', 'لاروش بوزيه افاكلار جل رغوي منظف 200 مل', '1,150.00', 18, 5, `MATCH:${K.effaclar}`],
  ['CT401', 'سيتافيل غسول لطيف للبشرة 236 مل', '540', 20, 28, `MATCH:${K.cetaphil}`],
  ['EU601', 'يوسيرين ديرموبيوريفاير جل منظف 200 مل', '760', 15, 6, `MATCH:${K.eucerin}`],
  ['VC701', 'فيشي مينيرال 89 سيروم 50 مل', '1,390', 15, 4, `MATCH:${K.vichy}`],
  ['NEW01', 'سيتافيل جنتل سكين كلينزر 236مل', '540', 20, 12, `MATCH_OR_CRITICAL:${K.cetaphil}`],
  ['NEW02', 'CERAVE FOAMING FACIAL CLEANSER 236 ML', '850', 20, 9, `MATCH:${K.foaming}`],
  ['RX001', 'بانادول اكسترا 24 قرص', '80', 10, 200, 'SKIPPED'],
  ['NV901', 'نيفيا كريم مرطب 200 مل', '210', 20, 50, 'UNMATCHED'],
];

const HEADERS = ['كود الصنف', 'اسم الصنف', 'سعر الجمهور', 'خصم %', 'الرصيد'];
function write(rows, file) {
  const sheet = XLSX.utils.aoa_to_sheet([['قائمة أسعار صيدليات النهار للتوزيع - نوفمبر 2026'], [], HEADERS, ...rows.map(row => row.slice(0, 5))]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'الأسعار');
  XLSX.writeFile(book, join(__dirname, file));
}
write(FILE1, 'nahar-price-list-1.xlsx');
write(FILE2, 'nahar-price-list-2.xlsx');
// The data rows sit after a title line, a blank line and the header: sheet line = index + 4.
const oracle = (rows) => rows.map((row, index) => ({ line: index + 4, code: row[0], name: row[1], expect: row[5] }));
writeFileSync(join(__dirname, 'nahar-oracle.json'), JSON.stringify({ 'nahar-price-list-1.xlsx': oracle(FILE1), 'nahar-price-list-2.xlsx': oracle(FILE2) }, null, 2));
console.log('wrote', FILE1.length, '+', FILE2.length, 'rows');
