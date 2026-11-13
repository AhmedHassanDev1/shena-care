import { EXAMPLE_ROUTINE_DOCUMENT, fingerprintOf, parseRoutineDocument } from '../../src/modules/care/services/routine-import';
import { cleanNote, findUnsupportedClaim } from '../../src/modules/care/services/routine-claims';

const clone = () => JSON.parse(JSON.stringify(EXAMPLE_ROUTINE_DOCUMENT)) as { steps: Array<{ title: string }>; description: string } & Record<string, unknown>;

describe('routine import parser (shinacare.routine/v1)', () => {
  it('accepts the documented example', () => {
    const { parsed, issues } = parseRoutineDocument(clone());
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(parsed?.steps.map(s => s.timing)).toEqual(['AM', 'AM', 'PM']);
    expect(parsed?.steps[0].alternatives).toHaveLength(1);
  });

  it('gives the same fingerprint regardless of key order, spacing or title form', () => {
    const one = parseRoutineDocument(clone()).parsed!;
    const reordered = clone();
    const rebuilt = { steps: reordered.steps, careArea: reordered.careArea, schema: reordered.schema, concern: reordered.concern, references: reordered.references, description: ` ${reordered.description} `, title: reordered.title };
    const two = parseRoutineDocument(rebuilt).parsed!;
    expect(fingerprintOf(two)).toBe(fingerprintOf(one));
    const changed = clone(); changed.steps[0].title = 'غسول آخر';
    expect(fingerprintOf(parseRoutineDocument(changed).parsed!)).not.toBe(fingerprintOf(one));
  });

  it.each([
    ['not an object', [], 'WRONG_TYPE'],
    ['unsupported version', { ...clone(), schema: 'x' }, 'UNSUPPORTED_VERSION'],
    ['unsupported timing', { ...clone(), steps: [{ timing: 'BOTH', title: 'x', product: { sku: 'A' } }] }, 'UNSUPPORTED_TIMING'],
    ['two identifiers', { ...clone(), steps: [{ timing: 'AM', title: 'x', product: { sku: 'A', barcode: '1' } }] }, 'PRODUCT_REFERENCE'],
    ['unknown field', { ...clone(), extra: 1 }, 'UNKNOWN_FIELD'],
    ['html in text', { ...clone(), description: '<b>x</b>' }, 'MARKUP_NOT_ALLOWED'],
    ['non-http reference', { ...clone(), references: [{ title: 'x', url: 'file:///etc/passwd' }] }, 'INVALID_URL'],
    ['too many alternatives', { ...clone(), steps: [{ timing: 'AM', title: 'x', product: { sku: 'A' }, alternatives: Array.from({ length: 6 }, () => ({ sku: 'B' })) }] }, 'TOO_MANY'],
  ])('rejects %s', (_name, document, code) => {
    const { parsed, issues } = parseRoutineDocument(document);
    expect(parsed).toBeNull();
    expect(issues.map(i => i.code)).toContain(code);
  });
});

describe('routine text guard', () => {
  it('flags cure / prevention / guarantee promises in English and Arabic', () => {
    for (const text of ['This cures acne', 'guaranteed results', 'treats eczema', 'يعالج الحبوب', 'مضمون النتيجة', 'آمن للحامل']) expect(findUnsupportedClaim(text)).not.toBeNull();
    for (const text of ['A gentle cleanser for oily skin', 'غسول لطيف للبشرة الدهنية', null, undefined]) expect(findUnsupportedClaim(text)).toBeNull();
  });
  it('cleans notes to plain bounded text', () => {
    expect(cleanNote('<b>hi</b>\u0000 there   x', 8)).toBe('hi there');
    expect(cleanNote('   ', 10)).toBeNull();
  });
});
