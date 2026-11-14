import {
  EMPTY_CONTEXT, decideEscalation, fallbackQuestion, fallbackUnderstanding, mergeContext, readContext, routineBlockedReason, slotsFor,
} from '../../../src/modules/guidance/consultation/consultation-rules';

const vocabulary = { concerns: new Set(['acne', 'dryness']), productTypes: new Set(['cleanser', 'sunscreen']) };
const concerns = [
  { slug: 'acne', name: 'حب الشباب (الأكني)', careArea: 'skin' as const },
  { slug: 'dandruff', name: 'القشرة', careArea: 'hair' as const },
];

describe('Consultation rules', () => {
  it('reads malformed context as "not known"', () => {
    expect(readContext(null)).toEqual(EMPTY_CONTEXT);
    expect(readContext({ careArea: 'teeth', skinType: 'magic', budgetMax: -3, concerns: 'acne', safety: { pregnant: 'MAYBE' } })).toEqual(EMPTY_CONTEXT);
  });

  it('accumulates context but never lets the model invent vocabulary or erase a safety answer', () => {
    const known = { ...EMPTY_CONTEXT, careArea: 'skin' as const, skinType: 'oily' as const, sensitivities: ['عطر'], safety: { ...EMPTY_CONTEXT.safety, pregnant: 'YES' as const } };
    const merged = mergeContext(known, {
      careArea: null, concerns: ['acne', 'made-up'], productTypes: ['cleanser', 'laser'], skinType: null, sensitivities: ['كحول'],
      safety: { pregnant: 'UNKNOWN', breastfeeding: 'NO', prescriptionTopical: 'UNKNOWN', oralRetinoid: 'UNKNOWN' },
    }, vocabulary);
    expect(merged).toMatchObject({ careArea: 'skin', skinType: 'oily', concerns: ['acne'], productTypes: ['cleanser'], sensitivities: ['عطر', 'كحول'] });
    expect(merged.safety).toMatchObject({ pregnant: 'YES', breastfeeding: 'NO' });
    // a correction the customer makes does go through
    expect(mergeContext(known, { safety: { pregnant: 'NO' } }, vocabulary).safety.pregnant).toBe('NO');
  });

  it('escalates on red flags only, with a reason for each', () => {
    expect(decideEscalation([], 'ar')).toEqual({ required: false, reasons: [] });
    const escalation = decideEscalation([{ code: 'INFECTION_SIGNS' }, { code: 'INFECTION_SIGNS' }, { code: 'NOT_A_CODE' }], 'ar');
    expect(escalation.required).toBe(true);
    expect(escalation.reasons).toHaveLength(1);
    expect(escalation.reasons[0].text).toContain('دكتور');
  });

  it('does not build a personal routine for a pregnant, breastfeeding or oral-retinoid customer', () => {
    expect(routineBlockedReason(EMPTY_CONTEXT, 'ar')).toBeNull();
    expect(routineBlockedReason({ ...EMPTY_CONTEXT, safety: { ...EMPTY_CONTEXT.safety, pregnant: 'YES' } }, 'ar')).toContain('الحمل');
    expect(routineBlockedReason({ ...EMPTY_CONTEXT, safety: { ...EMPTY_CONTEXT.safety, breastfeeding: 'YES' } }, 'en')).toContain('breastfeeding');
    expect(routineBlockedReason({ ...EMPTY_CONTEXT, safety: { ...EMPTY_CONTEXT.safety, oralRetinoid: 'YES' } }, 'en')).toContain('oral retinoid');
  });

  it('places products in the day by the manufacturer first, then by role', () => {
    const base = { role: null, productType: null, careArea: 'skin', statedPeriod: null, periodEligibility: null, families: [] as string[] };
    expect(slotsFor({ ...base, role: 'SUNSCREEN' })).toEqual(['AM']);
    expect(slotsFor({ ...base, role: 'CLEANSER' })).toEqual(['AM', 'PM']);
    expect(slotsFor({ ...base, role: 'SERUM', families: ['retinoids'] })).toEqual(['PM']);
    expect(slotsFor({ ...base, role: 'SERUM', statedPeriod: 'AM', families: ['retinoids'] })).toEqual(['AM']); // the label wins
    expect(slotsFor({ ...base, role: 'MOISTURIZER', periodEligibility: 'PM' })).toEqual(['PM']);
    expect(slotsFor({ ...base, careArea: 'hair', role: 'HAIR_WASH' })).toEqual(['AS_NEEDED']);
  });

  it('keeps working without the AI: a keyword reading of the request', () => {
    const acne = fallbackUnderstanding('بشرتي دهنية وعندي حب الشباب وعايزة غسول', EMPTY_CONTEXT, concerns, ['cleanser', 'shampoo']);
    expect(acne.context).toMatchObject({ careArea: 'skin', concerns: ['acne'], productTypes: ['cleanser'], skinType: 'oily' });
    expect(acne.needsClarification).toBe(false);

    const vague = fallbackUnderstanding('محتاجة مساعدة', EMPTY_CONTEXT, concerns, ['cleanser']);
    expect(vague.needsClarification).toBe(true);
    expect(fallbackQuestion(vague.missing, 'ar').quickReplies).toEqual(['البشرة', 'الشعر']);

    expect(fallbackUnderstanding('عايزة روتين للقشرة', EMPTY_CONTEXT, concerns, ['shampoo'])).toMatchObject({ intent: 'build_routine', context: { careArea: 'hair', concerns: ['dandruff'] } });
  });
});
