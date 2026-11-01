// GLO-279 Gate 07 — usage facts come only from the product's own directions; nothing is filled in from the product type.
import { RoutinePlacementService } from '../../src/modules/ingestion/services/routine-placement.service';
import { RinseType, RoutineStepType, RoutineTiming, UsageFrequency } from '../../src/modules/ingestion/contracts/routine-placement.contract';

const placement = new RoutinePlacementService();

describe('GLO-279 Gate 07: no invented usage', () => {
  it('does not invent "twice daily, AM+PM" for a cleanser whose directions state no frequency or time', () => {
    const res = placement.determineRoutinePlacement({
      productName: 'CeraVe Foaming Facial Cleanser', brand: 'CeraVe', category: 'Cleanser',
      usage: ['Wet skin with lukewarm water. Massage cleanser into skin in a gentle, circular motion. Rinse.'],
    });
    expect(res.stepType).toBe(RoutineStepType.CLEANSER);
    expect(res.roleSource).toBe('NAME_AND_CATEGORY_HEURISTIC');
    expect(res.rinseType).toBe(RinseType.RINSE_OFF); // stated
    expect(res.timing).toBe(RoutineTiming.UNKNOWN);
    expect(res.frequency).toBe(UsageFrequency.UNCLEAR_HELD);
    expect(res.frequencyStatus).toBe('HELD_FOR_REVIEW');
  });

  it('keeps everything UNKNOWN when no directions were supplied at all', () => {
    const res = placement.determineRoutinePlacement({ productName: 'Hydrating Cream 50ml', brand: 'CeraVe' });
    expect(res).toMatchObject({ timing: RoutineTiming.UNKNOWN, rinseType: RinseType.UNKNOWN, frequency: UsageFrequency.UNCLEAR_HELD,
      frequencyStatus: 'HELD_FOR_REVIEW', usageRules: [], warnings: [] });
  });

  it('keeps product-specific face, scalp and introductory directions as separate typed rules (The Ordinary Glycolic 7%)', () => {
    const res = placement.determineRoutinePlacement({
      productName: 'Glycolic Acid 7% Exfoliating Toner', brand: 'The Ordinary', category: 'Exfoliant',
      usage: ['Use once daily in the evening. Apply to face and neck. Can also be applied to the scalp three times a week. ' +
        'Beginners may start with 2-3 times a week.'],
    });
    expect(res.usageRules).toEqual([
      expect.objectContaining({ targetArea: 'FACE', routinePeriod: 'PM', frequencyUnit: 'DAY', usesMin: 1, usesMax: 1, condition: null }),
      expect.objectContaining({ targetArea: 'SCALP', frequencyUnit: 'WEEK', usesMin: 3, usesMax: 3, condition: null }),
      expect.objectContaining({ frequencyUnit: 'WEEK', usesMin: 2, usesMax: 3, condition: 'INTRODUCTORY' }),
    ]);
    expect(res).toMatchObject({ frequency: UsageFrequency.DAILY, timing: RoutineTiming.PM_ONLY, frequencyStatus: 'CONFIRMED' });
    for (const rule of res.usageRules) expect(rule.evidenceText.length).toBeGreaterThan(5);
  });

  it('reads Arabic directions with Arabic-Indic digits, hamza and tanween', () => {
    const daily = placement.determineRoutinePlacement({ productName: 'غسول رغوي', brand: 'CeraVe',
      usage: ['يستخدم مرتين يومياً صباحاً ومساءً ثم يشطف بالماء'] });
    expect(daily).toMatchObject({ frequency: UsageFrequency.TWICE_DAILY, timing: RoutineTiming.AM_PM, rinseType: RinseType.RINSE_OFF });
    const weekly = placement.determineRoutinePlacement({ productName: 'مقشر للوجه', brand: 'Bioderma', usage: ['يستخدم ٢-٣ مرات أسبوعياً مساءً'] });
    expect(weekly.usageRules[0]).toMatchObject({ frequencyUnit: 'WEEK', usesMin: 2, usesMax: 3, routinePeriod: 'PM' });
  });

  it('records a stated maximum contact time and turns it into a product warning; does not invent a cadence', () => {
    const res = placement.determineRoutinePlacement({
      productName: 'AHA 30% + BHA 2% Peeling Solution', brand: 'The Ordinary', category: 'Exfoliant',
      usage: ['Apply evenly across clean, dry face. Leave on for no more than 10 minutes. Rinse thoroughly with lukewarm water.'],
    });
    expect(res.usageRules[0]).toMatchObject({ contactMinutes: 10, contactIsMaximum: true, rinseMode: 'RINSE_OFF', frequencyUnit: 'UNKNOWN' });
    expect(res.frequency).toBe(UsageFrequency.UNCLEAR_HELD);
    expect(res.warnings).toContain('Do not leave on for more than 10 minutes (manufacturer directions)');
  });

  it('keeps ingredient-class cautions as generic guidance for review, not as product warnings', () => {
    const res = placement.determineRoutinePlacement({
      productName: 'The Ordinary Retinol 0.5% in Squalane', brand: 'The Ordinary', category: 'Serum',
      ingredients: ['Squalane', 'Retinol'], usage: ['Apply a small amount to the face in the PM.'],
    });
    expect(res).toMatchObject({ timing: RoutineTiming.PM_ONLY, isPhotosensitizing: true, warnings: [] });
    expect(res.genericGuidance).toEqual([expect.objectContaining({ basis: 'INGREDIENT_CLASS', requiresReview: true })]);
  });

  it('keeps sunscreen warnings that the directions actually state', () => {
    const res = placement.determineRoutinePlacement({ productName: 'Glycolic Toner', brand: 'X Lab', category: 'Exfoliant',
      usage: ['Use in the evening. Use a broad-spectrum sunscreen during the day.'] });
    expect(res.warnings).toContain('Use a broad-spectrum sunscreen during the day.');
  });

  it('never converts "as needed" into a fixed cadence, and reads "weekly" as once a week', () => {
    const asNeeded = placement.determineRoutinePlacement({ productName: 'Spot Gel', brand: 'X Lab', usage: ['Apply to blemishes as needed.'] });
    expect(asNeeded.usageRules[0]).toMatchObject({ frequencyUnit: 'AS_NEEDED', usesMin: null, usesMax: null });
    expect(asNeeded.frequency).toBe(UsageFrequency.AS_NEEDED);
    const mask = placement.determineRoutinePlacement({ productName: 'Bond Intense Moisture Mask', brand: 'Olaplex',
      usage: ['Apply to clean, damp hair weekly, leave on for 10 minutes and rinse thoroughly.'] });
    expect(mask.usageRules[0]).toMatchObject({ frequencyUnit: 'WEEK', usesMin: 1, usesMax: 1, contactMinutes: 10, contactIsMaximum: false });
  });

  it('holds directions that defer to a professional or contradict another source', () => {
    const res = placement.determineRoutinePlacement({ productName: 'Resurfacing Peel 35%', brand: 'ClinicalDerm', category: 'Exfoliant',
      usage: ['Use as directed by physician.'], conflictingDistributorUsage: 'Apply daily in the morning' });
    expect(res).toMatchObject({ frequency: UsageFrequency.UNCLEAR_HELD, frequencyStatus: 'HELD_FOR_REVIEW' });
    expect(res.evidenceSummary.contradictionsFound).toBe(true);
  });
});
