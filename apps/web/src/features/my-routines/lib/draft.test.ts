import type { SavedRoutineView } from '../api/personal-routines';
import {
  addStep, countByTiming, duplicateOf, emptyDraft, fromRoutine, hasProductAt, isSameDraft, moveToTiming, nudge, problemsOf, removeStep,
  reorder, replaceProduct, stepsOf, toPayload, updateStep, type Draft, type DraftProduct, type DraftStep,
} from './draft';

const product = (n: number): DraftProduct => ({ skuId: `sku-${n}`, productId: `prod-${n}`, name: `Product ${n}`, brand: 'Brand', variant: null });
const step = (n: number, timing: DraftStep['timing'] = 'AM'): DraftStep => ({
  key: `k${n}`, title: `Step ${n}`, timing, instructions: '', isOptional: false, product: product(n), alternatives: [],
});
const draftOf = (...steps: DraftStep[]): Draft => ({ title: 'Mine', careArea: 'skin', steps });
const keys = (draft: Draft, timing: DraftStep['timing']) => stepsOf(draft, timing).map((s) => s.key);

describe('draft operations', () => {
  it('adds steps grouped Morning, Evening, As-needed', () => {
    let draft = emptyDraft();
    draft = addStep(draft, step(1, 'PM'));
    draft = addStep(draft, step(2, 'AM'));
    draft = addStep(draft, step(3, 'AS_NEEDED'));
    expect(draft.steps.map((s) => s.key)).toEqual(['k2', 'k1', 'k3']);
  });

  it('refuses the same product twice at the same time of day, but allows it at another', () => {
    const draft = addStep(emptyDraft(), step(1, 'AM'));
    expect(hasProductAt(draft, 'AM', 'sku-1')).toBe(true);
    expect(addStep(draft, { ...step(1, 'AM'), key: 'dup' }).steps).toHaveLength(1);
    expect(addStep(draft, { ...step(1, 'PM'), key: 'pm' }).steps).toHaveLength(2);
  });

  it('removes a step and edits its text', () => {
    const draft = draftOf(step(1), step(2));
    expect(removeStep(draft, 'k1').steps.map((s) => s.key)).toEqual(['k2']);
    expect(updateStep(draft, 'k2', { title: 'Cleanse', instructions: 'Massage', isOptional: true }).steps[1]).toMatchObject({ title: 'Cleanse', instructions: 'Massage', isOptional: true });
  });

  it('nudges a step inside its own time of day only', () => {
    const draft = draftOf(step(1), step(2), step(3, 'PM'));
    expect(keys(nudge(draft, 'k2', -1), 'AM')).toEqual(['k2', 'k1']);
    expect(keys(nudge(draft, 'k1', -1), 'AM')).toEqual(['k1', 'k2']);
    expect(keys(nudge(draft, 'k2', 1), 'AM')).toEqual(['k1', 'k2']);
    expect(keys(nudge(draft, 'k3', -1), 'PM')).toEqual(['k3']);
  });

  it('applies an explicit drag order to one group and keeps the others', () => {
    const draft = draftOf(step(1), step(2), step(3), step(4, 'PM'));
    const next = reorder(draft, 'AM', ['k3', 'k1', 'k2']);
    expect(keys(next, 'AM')).toEqual(['k3', 'k1', 'k2']);
    expect(keys(next, 'PM')).toEqual(['k4']);
  });

  it('moves a step between Morning and Evening to the end of the target group', () => {
    const draft = draftOf(step(1), step(2), step(3, 'PM'));
    const next = moveToTiming(draft, 'k1', 'PM');
    expect(keys(next, 'AM')).toEqual(['k2']);
    expect(keys(next, 'PM')).toEqual(['k3', 'k1']);
  });

  it('does not move a step onto the same product already used at the target time', () => {
    const draft = draftOf(step(1, 'AM'), { ...step(1, 'PM'), key: 'pm1' });
    expect(moveToTiming(draft, 'k1', 'PM')).toBe(draft);
  });

  it('replaces the product but keeps title, note and time of day', () => {
    const draft = draftOf({ ...step(1), instructions: 'Gentle', alternatives: ['sku-9'] });
    const next = replaceProduct(draft, 'k1', product(9));
    expect(next.steps[0]).toMatchObject({ title: 'Step 1', instructions: 'Gentle', timing: 'AM', alternatives: [] });
    expect(next.steps[0].product.skuId).toBe('sku-9');
    expect(replaceProduct(draftOf(step(1), step(2)), 'k1', product(2)).steps[0].product.skuId).toBe('sku-1');
  });
});

describe('draft validation and payload', () => {
  it('names what blocks saving', () => {
    expect(problemsOf(emptyDraft())).toEqual(['TITLE', 'NO_STEPS']);
    expect(problemsOf({ ...draftOf({ ...step(1), title: ' ' }), title: 'Ok' })).toEqual(['STEP_TITLE']);
    expect(problemsOf(draftOf(step(1)))).toEqual([]);
  });

  it('builds the API body from SKUs only, in canonical order, with the expected version', () => {
    const body = toPayload(draftOf({ ...step(2, 'PM'), alternatives: ['sku-8'], instructions: ' rinse ', isOptional: true }, step(1)), 4);
    expect(body).toEqual({
      title: 'Mine', careArea: 'skin', expectedVersion: 4,
      steps: [
        { title: 'Step 1', timing: 'AM', product: { skuId: 'sku-1' } },
        { title: 'Step 2', timing: 'PM', instructions: 'rinse', isOptional: true, product: { skuId: 'sku-2' }, alternatives: [{ skuId: 'sku-8' }] },
      ],
    });
  });

  it('detects real changes only', () => {
    const a = draftOf(step(1), step(2));
    expect(isSameDraft(a, { ...a, title: ' Mine ' })).toBe(true);
    expect(isSameDraft(a, nudge(a, 'k2', -1))).toBe(false);
    expect(isSameDraft(a, removeStep(a, 'k1'))).toBe(false);
  });
});

describe('saved routine <-> draft', () => {
  const saved = (): SavedRoutineView => ({
    id: 'r1', title: 'Daily', careArea: 'skin', origin: 'USER', version: 3, status: 'DRAFT', sourceRoutineId: null, createdAt: '', updatedAt: '',
    steps: [
      { id: 's1', order: 0, timing: 'AM', title: 'Cleanse', instructions: null, reason: null, isOptional: false,
        product: { skuId: 'sku-1', productId: 'prod-1', state: 'AVAILABLE', productName: 'Gel', brandName: 'Brand', skuCode: 'C1', variantName: '200 ml', size: 200, sizeUnit: 'ml', price: null },
        alternatives: [{ skuId: 'sku-5', productId: 'prod-5', state: 'AVAILABLE', productName: 'Alt', brandName: 'B', skuCode: 'C5', variantName: null, size: null, sizeUnit: null, price: null }] },
      { id: 's2', order: 1, timing: 'PM', title: 'Gone', instructions: 'x', reason: null, isOptional: false, product: null, alternatives: [] },
    ],
  });

  it('keeps alternatives and reports a step whose product is gone instead of dropping it silently', () => {
    const { draft, dropped } = fromRoutine(saved());
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0]).toMatchObject({ key: 's1', title: 'Cleanse', alternatives: ['sku-5'], product: { skuId: 'sku-1', name: 'Gel', variant: '200 ml' } });
    expect(dropped).toEqual(['Gone']);
  });

  it('duplicates with new keys and the caller\'s copy title', () => {
    const copy = duplicateOf(saved(), (title) => `${title} (copy)`);
    expect(copy.title).toBe('Daily (copy)');
    expect(copy.steps[0].key).not.toBe('s1');
    expect(copy.steps[0].product.skuId).toBe('sku-1');
  });

  it('counts steps per time of day', () => {
    expect(countByTiming([{ timing: 'AM' }, { timing: 'AM' }, { timing: 'PM' }])).toEqual({ AM: 2, PM: 1, AS_NEEDED: 0 });
  });
});
