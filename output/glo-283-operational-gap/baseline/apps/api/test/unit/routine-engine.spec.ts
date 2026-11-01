import {
  buildProposal, crossRoutineConflicts, EngineBlueprint, EngineCandidate, EngineContext, EngineRule, selectBlueprint, areaSlot,
} from '../../src/modules/care/engine/routine-engine';

const NOW = new Date('2026-10-26T00:00:00Z');
const RECENT = '2026-06-01T00:00:00Z';

const blueprint: EngineBlueprint = {
  id: 'bp-acne', key: 'acne-inflammatory', version: 1, concernSlug: 'acne', careArea: 'skin', kind: 'TREATMENT',
  severityMin: 2, severityMax: 2, titleAr: 'روتين حب الشباب', goalAr: null, timelineAr: null, safetyNotesAr: [],
  roles: [
    { roleKey: 'cleanser', sortOrder: 1, titleAr: 'غسول', isEssential: true, startWeek: 1, requiredActives: [], concentrationRanges: [], usageNoteAr: null },
    { roleKey: 'treatment', sortOrder: 2, titleAr: 'علاج', isEssential: true, startWeek: 2,
      requiredActives: ['retinoids', 'azelaic-acid', 'benzoyl-peroxide'],
      concentrationRanges: [{ subject: 'azelaic-acid', min: 10, max: 20, unit: '%' }], usageNoteAr: null },
    { roleKey: 'moisturizer', sortOrder: 3, titleAr: 'مرطب', isEssential: true, startWeek: 1, requiredActives: [], concentrationRanges: [], usageNoteAr: null },
    { roleKey: 'sunscreen', sortOrder: 4, titleAr: 'واقي شمس', isEssential: true, startWeek: 3, requiredActives: [], concentrationRanges: [], usageNoteAr: null },
    { roleKey: 'spot', sortOrder: 5, titleAr: 'علاج موضعي', isEssential: false, startWeek: 1, requiredActives: [], concentrationRanges: [], usageNoteAr: null },
  ],
};

const rules: EngineRule[] = [
  { key: 'retinoids-pregnancy', kind: 'EXCLUDE_CONDITION', subjectType: 'FAMILY', subject: 'retinoids', otherType: null, other: null, condition: 'PREGNANT', noteAr: null },
  { key: 'max-one-retinoid', kind: 'MAX_ONE_PER_AREA', subjectType: 'FAMILY', subject: 'retinoids', otherType: null, other: null, condition: null, noteAr: null },
  { key: 'bpo-tretinoin', kind: 'SEPARATE_TIMES', subjectType: 'INGREDIENT', subject: 'benzoyl-peroxide', otherType: 'INGREDIENT', other: 'tretinoin', condition: null, noteAr: null },
];

let seq = 0;
function candidate(over: Partial<EngineCandidate> & Pick<EngineCandidate, 'roleKey'>): EngineCandidate {
  seq += 1;
  const id = `p-${String(seq).padStart(3, '0')}`;
  return {
    productId: id, skuId: `${id}-sku`, name: id, brandName: 'Brand', imageUrl: null, tier: 'SMART', concernSlugs: ['acne'],
    suitableSkinTypes: [], price: 100, currency: 'EGP', sellable: true, actives: [], ingredientIds: [], ingredientSlugs: [],
    ingredientFamilies: [], usageRuleCount: 1, factsReviewedAt: [RECENT], ...over,
  };
}

function active(slug: string, family: string | null, value: number | null = null) {
  return { ingredientId: `i-${slug}`, ingredientSlug: slug, familySlug: family, concentrationValue: value,
    concentrationUnit: value === null ? null : '%', concentrationVerified: value !== null, concentrationReviewedAt: value === null ? null : RECENT };
}

function retinoidTreatment(over: Partial<EngineCandidate> = {}) {
  return candidate({ roleKey: 'treatment', name: 'Adapalene gel', actives: [active('adapalene', 'retinoids', 0.1)],
    ingredientSlugs: ['adapalene'], ingredientFamilies: ['retinoids'], price: 150, ...over });
}
function azelaicTreatment(over: Partial<EngineCandidate> = {}) {
  return candidate({ roleKey: 'treatment', name: 'Azelaic 15%', actives: [active('azelaic-acid', 'azelaic-acid', 15)],
    ingredientSlugs: ['azelaic-acid'], ingredientFamilies: ['azelaic-acid'], price: 220, ...over });
}

function baseline(): EngineCandidate[] {
  return [
    candidate({ roleKey: 'cleanser', price: 120 }),
    candidate({ roleKey: 'cleanser', price: 90, concernSlugs: [] }),
    retinoidTreatment(),
    azelaicTreatment(),
    candidate({ roleKey: 'moisturizer', price: 170 }),
    candidate({ roleKey: 'moisturizer', price: 300, tier: 'LUXE' }),
    candidate({ roleKey: 'sunscreen', price: 220 }),
    candidate({ roleKey: 'sunscreen', price: 400, tier: 'COMPLETE' }),
    candidate({ roleKey: 'spot', price: 80, tier: 'COMPLETE' }),
  ];
}

function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return {
    severity: 2, skinType: 'oily', ageBand: 'ADULT', experienceLevel: 'BEGINNER', fragranceFree: null,
    safety: { pregnant: 'NO', breastfeeding: 'NO', prescriptionTopical: 'NO', oralRetinoid: 'NO', fragranceSensitive: 'NO' },
    allergyIngredientIds: [], tier: null, budget: null, ownedRoleKeys: [], overrides: { swaps: {}, removed: [], upgrades: [] },
    activeRoutineProducts: [], now: NOW, ...over,
  };
}

const item = (p: ReturnType<typeof buildProposal>, role: string) => p.items.find(i => i.roleKey === role)!;

describe('routine engine (deterministic, ROUTINE_SYSTEM.md §7–§8)', () => {
  beforeEach(() => { seq = 0; });

  it('gives the same proposal for the same inputs', () => {
    const a = buildProposal(blueprint, baseline(), rules, ctx());
    seq = 0;
    const b = buildProposal(blueprint, baseline(), rules, ctx());
    expect(a).toEqual(b);
  });

  it('builds the smart pick from the essentials, concern match first, then price', () => {
    const p = buildProposal(blueprint, baseline(), rules, ctx());
    expect(p.tier).toBe('SMART');
    expect(p.mode).toBe('STANDARD');
    expect(p.items.map(i => i.roleKey)).toEqual(['cleanser', 'treatment', 'moisturizer', 'sunscreen']);
    expect(item(p, 'cleanser').product?.price).toBe(120); // concern-specific beats the cheaper generic one
    expect(item(p, 'treatment').product?.name).toBe('Adapalene gel');
    expect(p.totals.all).toBe(120 + 150 + 170 + 220);
  });

  it('starts treatment in week 2 for beginners and never defers sunscreen', () => {
    const p = buildProposal(blueprint, baseline(), rules, ctx());
    expect(item(p, 'treatment')).toMatchObject({ startWeek: 2, purchasePhase: 'DEFERRED' });
    expect(item(p, 'sunscreen')).toMatchObject({ startWeek: 1, purchasePhase: 'IMMEDIATE' });
    expect(p.totals.immediate).toBe(120 + 170 + 220);
    expect(item(p, 'treatment').reasonCodes).toContain('GENTLE_START:WEEK_2');
  });

  it('excludes retinoids when pregnant and falls back to an allowed treatment', () => {
    const p = buildProposal(blueprint, baseline(), rules, ctx({ safety: { ...ctx().safety, pregnant: 'YES' } }));
    expect(item(p, 'treatment').product?.name).toBe('Azelaic 15%');
    expect(item(p, 'treatment').reasonCodes).toContain('ACTIVE:azelaic-acid@15%');
    expect(p.warnings).not.toContain('NEEDS_SAFETY_ANSWERS');
  });

  it('treats an unanswered safety question like a yes, and says so', () => {
    const p = buildProposal(blueprint, baseline(), rules, ctx({ safety: { ...ctx().safety, pregnant: 'UNKNOWN' } }));
    expect(item(p, 'treatment').product?.name).toBe('Azelaic 15%');
    expect(p.warnings).toContain('NEEDS_SAFETY_ANSWERS');
  });

  it('refuses treatment products with missing, unverified or out-of-range concentrations, no usage rules, or stale facts', () => {
    const blocked = [
      azelaicTreatment({ actives: [active('azelaic-acid', 'azelaic-acid')] }),          // concentration not stated
      azelaicTreatment({ actives: [active('azelaic-acid', 'azelaic-acid', 25)] }),      // out of range
      azelaicTreatment({ usageRuleCount: 0 }),                                          // no reviewed usage
      azelaicTreatment({ factsReviewedAt: ['2023-01-01T00:00:00Z'] }),                  // stale
    ];
    const pregnant = ctx({ safety: { ...ctx().safety, pregnant: 'YES' } });
    const p = buildProposal(blueprint, [...baseline().filter(c => c.roleKey !== 'treatment'), retinoidTreatment(), ...blocked], rules, pregnant);
    expect(item(p, 'treatment').status).toBe('UNAVAILABLE');
    expect(p.warnings).toContain('ESSENTIAL_UNAVAILABLE');
  });

  it('switches to gentle basics with a doctor recommendation for severe acne', () => {
    const p = buildProposal(blueprint, baseline(), rules, ctx({ severity: 3 }));
    expect(p.mode).toBe('GENTLE_BASICS');
    expect(p.items.map(i => i.roleKey)).toEqual(['cleanser', 'moisturizer', 'sunscreen']);
    expect(p.warnings).toContain('SEVERE_SEE_DOCTOR');
  });

  it.each([
    [{ ageBand: 'UNDER_15' as const }, 'UNDER_15_GENERAL_ONLY'],
    [{ safety: { ...ctx().safety, oralRetinoid: 'YES' as const } }, 'ORAL_RETINOID_SEE_DOCTOR'],
    [{ safety: { ...ctx().safety, prescriptionTopical: 'YES' as const } }, 'PRESCRIPTION_TREATMENT_SEE_DOCTOR'],
  ])('switches to gentle basics for %o', (over, warning) => {
    const p = buildProposal(blueprint, baseline(), rules, ctx(over));
    expect(p.mode).toBe('GENTLE_BASICS');
    expect(p.warnings).toContain(warning);
  });

  it('marks owned roles and keeps them out of the total', () => {
    const p = buildProposal(blueprint, baseline(), rules, ctx({ ownedRoleKeys: ['cleanser'] }));
    expect(item(p, 'cleanser')).toMatchObject({ status: 'OWNED', product: null, reasonCodes: ['ALREADY_OWNED'] });
    expect(p.totals.all).toBe(150 + 170 + 220);
  });

  it('does not offer a tier unless every essential role has an eligible product in it', () => {
    const p = buildProposal(blueprint, baseline(), rules, ctx({ tier: 'LUXE' }));
    expect(p.tiersAvailable).toEqual(['SMART']);
    expect(p.tier).toBe('SMART');
    expect(p.warnings).toContain('TIER_NOT_AVAILABLE:LUXE');
  });

  it('includes optional steps from the complete pick on, and lets the customer remove them', () => {
    const all = [...baseline(), retinoidTreatment({ tier: 'COMPLETE' }), candidate({ roleKey: 'cleanser', tier: 'COMPLETE' }),
      candidate({ roleKey: 'moisturizer', tier: 'COMPLETE' })];
    const complete = buildProposal(blueprint, all, rules, ctx({ tier: 'COMPLETE' }));
    expect(complete.tier).toBe('COMPLETE');
    expect(item(complete, 'spot').status).toBe('SELECTED');
    const removed = buildProposal(blueprint, all, rules, ctx({ tier: 'COMPLETE', overrides: { swaps: {}, removed: ['spot', 'cleanser'], upgrades: [] } }));
    expect(item(removed, 'spot').status).toBe('REMOVED');
    expect(item(removed, 'cleanser').status).toBe('SELECTED'); // essentials cannot be removed
  });

  it('offers a higher-tier replacement for a stock-out only with consent', () => {
    const stock = [...baseline().filter(c => c.roleKey !== 'sunscreen'),
      candidate({ roleKey: 'sunscreen', price: 220, sellable: false }), candidate({ roleKey: 'sunscreen', price: 400, tier: 'COMPLETE' })];
    const offered = buildProposal(blueprint, stock, rules, ctx());
    expect(item(offered, 'sunscreen')).toMatchObject({ status: 'UPGRADE_AVAILABLE', product: null });
    expect(item(offered, 'sunscreen').upgradeOffer?.price).toBe(400);
    expect(offered.totals.all).toBe(120 + 150 + 170);
    expect(offered.warnings).toContain('UPGRADE_NEEDS_CONSENT');

    const accepted = buildProposal(blueprint, stock, rules, ctx({ overrides: { swaps: {}, removed: [], upgrades: ['sunscreen'] } }));
    expect(item(accepted, 'sunscreen')).toMatchObject({ status: 'SELECTED' });
    expect(item(accepted, 'sunscreen').reasonCodes).toContain('UPGRADED_WITH_CONSENT');
  });

  it('recommends the highest tier inside the budget and flags an overrun', () => {
    const p = buildProposal(blueprint, baseline(), rules, ctx({ budget: 500 }));
    expect(p.recommendedTier).toBe('SMART');
    expect(p.overBudget).toBe(true);
    expect(p.warnings).toContain('OVER_BUDGET');
  });

  it('skips a product that would add a second retinoid next to an active routine', () => {
    const p = buildProposal(blueprint, baseline(), rules, ctx({
      activeRoutineProducts: [{ routineId: 'r-1', careArea: 'skin', roleKey: 'treatment', productId: 'x', subjects: ['retinoids', 'retinol'] }],
    }));
    expect(item(p, 'treatment').product?.name).toBe('Azelaic 15%');
  });

  it('warns to separate benzoyl peroxide from tretinoin in another active routine', () => {
    const bpo = candidate({ roleKey: 'treatment', name: 'BPO 2.5%', actives: [active('benzoyl-peroxide', 'benzoyl-peroxide', 2.5)],
      ingredientSlugs: ['benzoyl-peroxide'], ingredientFamilies: ['benzoyl-peroxide'], price: 60 });
    const p = buildProposal(blueprint, [...baseline(), bpo], rules, ctx({
      activeRoutineProducts: [{ routineId: 'r-2', careArea: 'skin', roleKey: 'treatment', productId: 'y', subjects: ['tretinoin'] }],
    }));
    expect(item(p, 'treatment').product?.name).toBe('BPO 2.5%');
    expect(p.warnings).toContain('SEPARATE_TIMES:bpo-tretinoin');
  });

  it('honours a swap to another eligible product and ignores a swap to an ineligible one', () => {
    const all = baseline();
    const azelaic = all.find(c => c.name === 'Azelaic 15%')!;
    const swapped = buildProposal(blueprint, all, rules, ctx({ overrides: { swaps: { treatment: azelaic.productId }, removed: [], upgrades: [] } }));
    expect(item(swapped, 'treatment').product?.productId).toBe(azelaic.productId);
    expect(item(swapped, 'treatment').reasonCodes[0]).toBe('CUSTOMER_CHOICE');

    const pregnant = ctx({ safety: { ...ctx().safety, pregnant: 'YES' } });
    const retinoid = all.find(c => c.name === 'Adapalene gel')!;
    const refused = buildProposal(blueprint, all, rules, { ...pregnant, overrides: { swaps: { treatment: retinoid.productId }, removed: [], upgrades: [] } });
    expect(item(refused, 'treatment').product?.productId).toBe(azelaic.productId);
  });

  it('excludes products with a known allergy ingredient or fragrance when asked', () => {
    const scented = candidate({ roleKey: 'moisturizer', price: 50, ingredientSlugs: ['parfum'], ingredientIds: ['i-parfum'] });
    const all = [...baseline(), scented];
    expect(item(buildProposal(blueprint, all, rules, ctx()), 'moisturizer').product?.price).toBe(50);
    expect(item(buildProposal(blueprint, all, rules, ctx({ fragranceFree: true })), 'moisturizer').product?.price).toBe(170);
    expect(item(buildProposal(blueprint, all, rules, ctx({ allergyIngredientIds: ['i-parfum'] })), 'moisturizer').product?.price).toBe(170);
  });

  it('picks the blueprint for the severity and falls back to the strongest for severe', () => {
    const mild = { ...blueprint, id: 'bp-mild', key: 'acne-mild', severityMin: 1, severityMax: 1 };
    expect(selectBlueprint([blueprint, mild], 'acne', 1)?.key).toBe('acne-mild');
    expect(selectBlueprint([blueprint, mild], 'acne', 3)?.key).toBe('acne-inflammatory');
    expect(selectBlueprint([blueprint], 'hair-loss', 1)).toBeNull();
  });

  it('limits activation per care area and reports cross-routine conflicts', () => {
    expect(areaSlot('skin', 'TREATMENT')).toBe('FACE_TREATMENT');
    expect(areaSlot('skin', 'MAINTENANCE')).toBe('FACE_TREATMENT');
    expect(areaSlot('skin', 'SUPPORT')).toBe('FACE_SUPPORT');
    expect(areaSlot('hair', 'TREATMENT')).toBe('HAIR');
    const conflicts = crossRoutineConflicts('skin', [{ roleKey: 'treatment', subjects: ['retinoids'] }],
      [{ routineId: 'r-1', careArea: 'skin', roleKey: 'treatment', productId: 'x', subjects: ['retinoids'] }], rules);
    expect(conflicts).toEqual([{ rule: 'max-one-retinoid', roleKey: 'treatment', otherRoutineId: 'r-1', otherRoleKey: 'treatment' }]);
  });
});
