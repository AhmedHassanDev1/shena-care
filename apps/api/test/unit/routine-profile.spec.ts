import { buildRoutineProfile, orderRoutine, RoutineProfileInput } from '../../src/modules/ingestion/services/routine-profile';
import { RoutinePlacementService } from '../../src/modules/ingestion/services/routine-placement.service';
import { readProductType } from '../../src/modules/ingestion/services/product-type';
import { isInstructionLine } from '../../src/modules/ingestion/services/product-fact-extractor';

const placement = new RoutinePlacementService();
const URL = 'https://brand.example/product';

/** A SKU as the pipeline sees it after verification: only what a source stated is filled in. */
function sku(name: string, opts: Omit<Partial<RoutineProfileInput>, 'instructions'> & { instructions?: string[] } = {}): RoutineProfileInput {
  const type = readProductType(name).types[0];
  const lines = opts.instructions ?? [];
  return {
    productName: name, productType: type?.key ?? null, productSubtype: type?.subtype ?? null,
    instructions: lines.length ? { lines, sourceUrl: URL, sourceTier: 'OFFICIAL_MANUFACTURER' } : null,
    instructionsConflict: false, reviewedUsageRules: [],
    parsedUsageRules: lines.length ? placement.determineRoutinePlacement({ productName: name, brand: 'Brand', usage: lines }).usageRules : [],
    inci: [], inciConflict: false, verifiedTargetArea: null, verifiedSpf: null, warnings: [], skinTypes: { values: [], verified: false }, hairTypes: { values: [], verified: false },
    claims: [], conflictFields: [],
    ...{ ...opts, instructions: undefined }, instructions: lines.length ? { lines, sourceUrl: URL, sourceTier: 'OFFICIAL_MANUFACTURER' } : null,
  } as RoutineProfileInput;
}
const inci = (...names: string[]) => names.map(name => ({ inci: name, function: null, family: null, concentration: null, concentrationStatus: 'UNKNOWN' }));

describe('routine profile: deterministic role, verified usage, unknown by default', () => {
  it('cleanser: CLEANSER, rinse-off verified from the instructions, frequency stays UNKNOWN when not stated', () => {
    const p = buildRoutineProfile(sku('CeraVe Foaming Cleanser', { instructions: ['Wet skin with lukewarm water. Massage cleanser into skin in a gentle, circular motion. Rinse.'] }));
    expect(p.primaryRole).toMatchObject({ value: 'CLEANSER', status: 'RULE_DERIVED' });
    expect(p.rinseMode).toMatchObject({ value: 'RINSE_OFF', status: 'VERIFIED', source: URL });
    expect(p.cadence).toMatchObject({ status: 'UNKNOWN', value: { unit: 'UNKNOWN' } });
    expect(p.routinePeriod).toMatchObject({ value: 'UNKNOWN', status: 'UNKNOWN' });
    expect(p.conflicts).toEqual([]);
  });

  it('serum: featured active with a stated strength is a TREATMENT secondary role; a trace active is not', () => {
    const featured = buildRoutineProfile(sku('Retinol Serum', { inci: [{ inci: 'Retinol', function: 'Cell-communicating', family: 'Retinoids', concentration: { value: 0.3, unit: '%' }, concentrationStatus: 'STATED' }] }));
    expect(featured.primaryRole.value).toBe('SERUM');
    expect(featured.secondaryRoles).toEqual([{ role: 'TREATMENT', status: 'RULE_DERIVED', basis: 'FEATURED_ACTIVE:RETINOID' }]);
    expect(featured.activeIngredients[0]).toMatchObject({ family: 'RETINOID', concentrationStatus: 'VERIFIED', concentration: { value: 0.3, unit: '%' } });
    expect(featured.periodEligibility).toMatchObject({ value: 'PM', status: 'RULE_DERIVED' });
    expect(featured.cautions.find(c => c.kind === 'SUN_SENSITIVITY_GUIDANCE')).toMatchObject({ status: 'RULE_DERIVED', source: null });
    const trace = buildRoutineProfile(sku('Hydrating Serum', { inci: inci('Aqua', 'Glycerin', 'Sodium Hyaluronate', 'Salicylic Acid') }));
    expect(trace.secondaryRoles).toEqual([]);
    expect(trace.activeIngredients[0]).toMatchObject({ family: 'BHA', featured: false, concentrationStatus: 'UNKNOWN', concentration: null });
  });

  it('moisturizer: MOISTURIZER; a verified SPF adds SUNSCREEN as a secondary role, never as the primary', () => {
    const p = buildRoutineProfile(sku('CeraVe AM Facial Moisturising Lotion', { verifiedSpf: 30 }));
    expect(p.primaryRole.value).toBe('MOISTURIZER');
    expect(p.secondaryRoles).toContainEqual({ role: 'SUNSCREEN', status: 'RULE_DERIVED', basis: 'VERIFIED_SPF:30' });
  });

  it('sunscreen: last morning step by rule; the manufacturer period stands separately', () => {
    const p = buildRoutineProfile(sku('Ultra Light Sunscreen SPF50', { instructions: ['Apply generously every morning, 15 minutes before sun exposure. Reapply every 2 hours.'] }));
    expect(p.primaryRole.value).toBe('SUNSCREEN');
    expect(p.periodEligibility).toMatchObject({ value: 'AM', status: 'RULE_DERIVED' });
    expect(p.routinePeriod).toMatchObject({ value: 'AM', status: 'VERIFIED' });
    expect(p.sequencingRules.map(r => r.rule)).toContain('LAST_MORNING_STEP');
  });

  it('exfoliant: weekly cadence only when the manufacturer states it', () => {
    const stated = buildRoutineProfile(sku('Gentle Face Scrub', { instructions: ['Use 2-3 times a week on damp skin, then rinse off.'] }));
    expect(stated.primaryRole.value).toBe('EXFOLIANT');
    expect(stated.cadence).toMatchObject({ status: 'VERIFIED', value: { unit: 'WEEK', min: 2, max: 3 } });
    const unstated = buildRoutineProfile(sku('Gentle Face Scrub'));
    expect(unstated.cadence.status).toBe('UNKNOWN');
  });

  it('shampoo, conditioner and hair mask: hair roles, rinse-off verified, contact time only when stated', () => {
    const shampoo = buildRoutineProfile(sku('Clary Hair Shampoo', { instructions: ['Apply to wet hair, massage into a lather and rinse thoroughly.'] }));
    const conditioner = buildRoutineProfile(sku('Clary Hair Conditioner', { instructions: ['After shampooing, apply to lengths and ends. Leave on for 2-3 minutes, then rinse thoroughly.'] }));
    const mask = buildRoutineProfile(sku('Clary Hair Mask', { instructions: ['Apply to clean, damp hair. Leave on for 3-5 minutes. Rinse thoroughly.'] }));
    expect([shampoo.primaryRole.value, conditioner.primaryRole.value, mask.primaryRole.value]).toEqual(['HAIR_WASH', 'CONDITIONER', 'HAIR_MASK']);
    for (const p of [shampoo, conditioner, mask]) expect(p.rinseMode).toMatchObject({ value: 'RINSE_OFF', status: 'VERIFIED' });
    // "After shampooing" is the manufacturer's own placement: VERIFIED, not a rule.
    expect(conditioner.prerequisites).toEqual([expect.objectContaining({ relation: 'AFTER', role: 'HAIR_WASH', status: 'VERIFIED', basis: 'MANUFACTURER_INSTRUCTIONS' })]);
    expect(conditioner.conflicts).toEqual([]);
    expect(shampoo.contactMinutes.status).toBe('UNKNOWN');
  });

  it('conflicting use: a rinse-off type whose instructions say leave it in is a CRITICAL conflict, not a silent role', () => {
    const p = buildRoutineProfile(sku('Repair Hair Mask', { instructions: ['Apply to towel-dried hair. Do not rinse.'] }));
    expect(p.rinseMode).toMatchObject({ value: 'LEAVE_ON', status: 'VERIFIED' });
    expect(p.primaryRole.status).toBe('CONFLICT');
    expect(p.conflicts).toContainEqual(expect.objectContaining({ field: 'routine.role', severity: 'CRITICAL' }));
  });

  it('conflicting use: sources that disagree on instructions leave period, cadence and rinse mode in CONFLICT', () => {
    const p = buildRoutineProfile(sku('CeraVe Hydrating Cleanser', { instructions: ['Rinse.'], instructionsConflict: true, conflictFields: ['usage.instructions'] }));
    expect([p.rinseMode.status, p.routinePeriod.status, p.cadence.status]).toEqual(['CONFLICT', 'CONFLICT', 'CONFLICT']);
    expect(p.conflicts.filter(c => c.severity === 'CRITICAL').length).toBeGreaterThan(0);
  });

  it('a named ingredient missing from the verified INCI is flagged, never assumed present', () => {
    const p = buildRoutineProfile(sku('Hyaluronic Acid Moisturising Cream', { inci: inci('Aqua', 'Glycerin', 'Cetearyl Alcohol') }));
    expect(p.featuredIngredients).toEqual([expect.objectContaining({ concept: 'hyaluronic', status: 'CONFLICT', basis: 'NAMED_BUT_ABSENT_FROM_VERIFIED_INCI' })]);
    const ok = buildRoutineProfile(sku('Hyaluronic Acid Moisturising Cream', { inci: inci('Aqua', 'Sodium Hyaluronate', 'Ceramide NP') }));
    expect(ok.featuredIngredients[0]).toMatchObject({ status: 'VERIFIED', inci: 'Sodium Hyaluronate' });
  });

  it('manufacturer warnings are VERIFIED cautions; no contraindication is invented without one', () => {
    const p = buildRoutineProfile(sku('Retinol Serum', { warnings: [{ text: 'Avoid contact with eyes. Do a patch test before first use.', sourceUrl: URL, sourceType: 'OFFICIAL_MANUFACTURER' }] }));
    expect(p.cautions[0]).toMatchObject({ kind: 'PATCH_TEST', status: 'VERIFIED', source: URL });
    expect(p.cautions.some(c => c.kind === 'CONTRAINDICATION')).toBe(false);
  });

  it('marketing copy stored as usage never yields a rinse mode, period or frequency (real CeraVe pages)', () => {
    const marketing = ['CeraVe SA Smoothing Cleanser for the face and body. Developed with dermatologists, this daily foaming cleanser helps protect the natural skin barrier.',
      'A hydrating and soothing facial cleansing lotion for normal to dry skin on the face and body.', 'Recommended use in conjunction with CeraVe Moisturizing Cream'];
    for (const line of marketing) expect(isInstructionLine(line)).toBe(false);
    for (const line of ['Use 1–2 times per week for optimal results.', 'Apply a generous amount to wet hair.', 'Leave on for 10–15 minutes to allow deep absorption.', 'ضعي كمية مناسبة على الشعر المبلل ثم اشطفيه جيداً']) expect(isInstructionLine(line)).toBe(true);
    const p = buildRoutineProfile(sku('CeraVe SA Smoothing Cleanser', { instructions: marketing }));
    expect([p.cadence.status, p.rinseMode.status, p.routinePeriod.status, p.fieldStatus.instructions]).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  });

  it('an unknown product type has no role and nothing rule-derived about usage', () => {
    const p = buildRoutineProfile(sku('CeraVe 236ml'));
    expect(p.primaryRole).toMatchObject({ value: null, status: 'UNKNOWN' });
    expect(p.stepOrder.status).toBe('UNKNOWN');
  });

  const step = (name: string, opts: Parameters<typeof sku>[1] = {}, id = name) => {
    const p = buildRoutineProfile(sku(name, opts));
    return { id, role: p.primaryRole.value, domain: p.routineDomain, rank: p.stepOrder.value, constraints: p.prerequisites, routinePeriod: p.routinePeriod, periodEligibility: p.periodEligibility.value };
  };
  const roles = (r: ReturnType<typeof orderRoutine>) => r.steps.map(s => s.role);

  it('orders a skin routine by placement constraints: cleanser, toner, serum, moisturiser, sunscreen last in the morning', () => {
    const am = orderRoutine(['Daily Sunscreen SPF50', 'Moisturising Cream', 'Vitamin C Serum', 'Hydrating Toner', 'Foaming Cleanser'].map(name => step(name)), 'AM');
    expect(roles(am)).toEqual(['CLEANSER', 'TONER', 'SERUM', 'MOISTURIZER', 'SUNSCREEN']);
    // Sunscreen is a morning step by rule: left out of an evening routine, with the reason.
    const pm = orderRoutine(['Daily Sunscreen SPF50', 'Moisturising Cream', 'Foaming Cleanser'].map(name => step(name)), 'PM');
    expect(roles(pm)).toEqual(['CLEANSER', 'MOISTURIZER']);
    expect(pm.excluded.map(e => e.reason)).toEqual(['RULE_AM_ONLY']);
  });

  it('a hair mask with no instruction about conditioner keeps that order UNDETERMINED (not a universal sequence)', () => {
    const p = buildRoutineProfile(sku('Repair Hair Mask', { instructions: ['Apply to washed, damp hair. Leave on for 5 minutes, then rinse.'] }));
    expect(p.prerequisites).toEqual(expect.arrayContaining([expect.objectContaining({ relation: 'UNDETERMINED', role: 'CONDITIONER', status: 'UNKNOWN' })]));
    const r = orderRoutine([step('Repair Hair Mask'), step('Clary Hair Conditioner'), step('Clary Hair Shampoo')]);
    expect(roles(r)[0]).toBe('HAIR_WASH');
    expect(r.notes).toEqual([expect.objectContaining({ kind: 'UNDETERMINED', roles: ['HAIR_MASK', 'CONDITIONER'] })]);
  });

  it('a mask the manufacturer says to use before conditioner goes before it; one used after conditioner goes after it', () => {
    const before = orderRoutine([step('Clary Hair Conditioner'), step('Pre Hair Mask', { instructions: ['After shampooing, apply to wet hair, leave for 3 minutes, then follow with conditioner.'] }), step('Clary Hair Shampoo')]);
    expect(roles(before)).toEqual(['HAIR_WASH', 'HAIR_MASK', 'CONDITIONER']);
    const after = orderRoutine([step('Clary Hair Shampoo'), step('Finish Hair Mask', { instructions: ['Apply after conditioner on towel-dried hair, leave 5 minutes and rinse well.'] }), step('Clary Hair Conditioner')]);
    expect(roles(after)).toEqual(['HAIR_WASH', 'CONDITIONER', 'HAIR_MASK']);
  });

  it('a mask used instead of conditioner is an alternative, reported to the builder', () => {
    const text = ['Use instead of conditioner once a week: apply to washed hair, leave 10 minutes, rinse.'];
    const mask = buildRoutineProfile(sku('Intense Hair Mask', { instructions: text }));
    expect(mask.prerequisites[0]).toMatchObject({ relation: 'REPLACES', role: 'CONDITIONER', status: 'VERIFIED' });
    expect(mask.cadence).toMatchObject({ status: 'VERIFIED', value: { unit: 'WEEK' } });
    const r = orderRoutine([step('Clary Hair Shampoo'), step('Intense Hair Mask', { instructions: text }), step('Clary Hair Conditioner')]);
    expect(r.notes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ALTERNATIVES', roles: ['HAIR_MASK', 'CONDITIONER'] })]));
  });

  it('rinse mode changes where an exfoliant goes: a rinse-off scrub is in the cleansing phase, a leave-on acid follows the toner', () => {
    const scrub = step('Gentle Face Scrub', { instructions: ['Massage onto damp skin, then rinse off.'] });
    const acid = step('Exfoliating Peeling Solution', { instructions: ['Apply to clean skin with a cotton pad in the evening. Do not rinse.'] }, 'acid');
    expect(roles(orderRoutine([step('Hydrating Toner'), scrub, step('Foaming Cleanser')]))).toEqual(['CLEANSER', 'EXFOLIANT', 'TONER']);
    expect(roles(orderRoutine([acid, step('Hydrating Toner'), step('Vitamin C Serum'), step('Foaming Cleanser')]))).toEqual(['CLEANSER', 'TONER', 'EXFOLIANT', 'SERUM']);
  });

  it('leave-in goes after the rinse-off steps; a hair oil with no stated use stays undetermined against washing', () => {
    expect(roles(orderRoutine([step('Leave In Cream'), step('Clary Hair Conditioner'), step('Clary Hair Shampoo')]))).toEqual(['HAIR_WASH', 'CONDITIONER', 'LEAVE_IN']);
    expect(buildRoutineProfile(sku('Argan Hair Oil')).prerequisites).toEqual([expect.objectContaining({ relation: 'UNDETERMINED', role: 'HAIR_WASH' })]);
  });

  it('a featured retinoid is an evening step by rule; a manufacturer "morning" statement excludes a step from an evening routine', () => {
    const retinol = step('Retinol Serum', { inci: [{ inci: 'Retinol', function: null, family: null, concentration: { value: 0.3, unit: '%' }, concentrationStatus: 'STATED' }] });
    const am = orderRoutine([retinol, step('Foaming Cleanser')], 'AM');
    expect(am.excluded).toEqual([expect.objectContaining({ reason: 'RULE_PM_ONLY' })]);
    const dayCream = step('Day Cream', { instructions: ['Apply every morning to clean skin.'] });
    expect(orderRoutine([dayCream], 'PM').excluded).toEqual([expect.objectContaining({ reason: 'MANUFACTURER_SAYS_AM' })]);
  });

  it('concerns and benefits come from manufacturer claims, labelled as claims; treatment wording is flagged', () => {
    const p = buildRoutineProfile(sku('Clary Hair Shampoo', { claims: ['Reduces Hair Loss', 'Fortifies hair follicles to improve resilience and reduce breakage.', 'Suitable for Sensitive skin'] }));
    expect(p.suitability.concerns.map(c => c.concern).sort()).toEqual(['breakage_strength', 'hair_loss_thinning', 'sensitivity']);
    expect(p.suitability.concerns.every(c => c.status === 'MANUFACTURER_CLAIM')).toBe(true);
  });

  it('manufacturer key ingredients are kept as stated, separate from the INCI; a list without its water base is marked possibly partial', () => {
    const p = buildRoutineProfile(sku('CeraVe Hydrating Cleanser', { inci: inci('Capixyl', 'Dextran', 'Biotin'),
      keyIngredients: { items: [{ name: 'Ceramides', function: 'To help protect the natural skin barrier' }], sourceUrl: URL } }));
    expect(p.featuredIngredients).toEqual(expect.arrayContaining([expect.objectContaining({ concept: 'Ceramides', kind: 'MANUFACTURER_KEY_INGREDIENT', function: 'To help protect the natural skin barrier' })]));
    expect(p.inciCompleteness).toBe('AS_STATED_POSSIBLY_PARTIAL');
    expect(buildRoutineProfile(sku('X Cleanser', { inci: inci('Aqua', 'Glycerin') })).inciCompleteness).toBe('FULL_FORMULA');
  });
});
