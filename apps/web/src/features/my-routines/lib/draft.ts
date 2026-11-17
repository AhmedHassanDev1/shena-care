import type { CareArea, RoutinePayload, SavedRoutineView, StepTiming } from '../api/personal-routines';

/**
 * The routine as the customer is editing it. Pure data and pure operations: the builder and the details editor share
 * them, and nothing here knows about React, the network or the clock.
 */

export const TIMINGS: readonly StepTiming[] = ['AM', 'PM', 'AS_NEEDED'];
export const MAX_STEPS = 30;
export const TITLE_MAX = 120;
export const STEP_TITLE_MAX = 80;
export const INSTRUCTIONS_MAX = 400;

export interface DraftProduct {
  skuId: string;
  productId: string;
  name: string;
  brand: string;
  variant: string | null;
  /** Set when the product came from the catalog picker in this session; otherwise the details page looks it up by `productId`. */
  imageUrl?: string | null;
  slug?: string | null;
}

export interface DraftStep {
  /** Stable client key (saved step id, or a generated one for a new step). Never sent to the API. */
  key: string;
  title: string;
  timing: StepTiming;
  instructions: string;
  isOptional: boolean;
  product: DraftProduct;
  /** Alternative SKUs the routine already carries; kept as they are and sent back unchanged. */
  alternatives: string[];
}

export interface Draft {
  title: string;
  careArea: CareArea;
  steps: DraftStep[];
}

export const emptyDraft = (careArea: CareArea = 'skin'): Draft => ({ title: '', careArea, steps: [] });

let counter = 0;
export const newStepKey = () => `new-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Steps grouped in the canonical order: all Morning, then all Evening, then As-needed. Order inside a group is preserved. */
export function normalize(draft: Draft): Draft {
  const steps = TIMINGS.flatMap((timing) => draft.steps.filter((step) => step.timing === timing));
  return { ...draft, steps };
}

export const stepsOf = (draft: Draft, timing: StepTiming): DraftStep[] => draft.steps.filter((step) => step.timing === timing);

/** The same product twice in one time of day is a mistake, not a routine. */
export const hasProductAt = (draft: Draft, timing: StepTiming, skuId: string, exceptKey?: string) =>
  draft.steps.some((step) => step.timing === timing && step.product.skuId === skuId && step.key !== exceptKey);

export function addStep(draft: Draft, step: DraftStep): Draft {
  if (draft.steps.length >= MAX_STEPS || hasProductAt(draft, step.timing, step.product.skuId)) return draft;
  return normalize({ ...draft, steps: [...draft.steps, step] });
}

export function removeStep(draft: Draft, key: string): Draft {
  return { ...draft, steps: draft.steps.filter((step) => step.key !== key) };
}

export function updateStep(draft: Draft, key: string, patch: Partial<Pick<DraftStep, 'title' | 'instructions' | 'isOptional'>>): Draft {
  return { ...draft, steps: draft.steps.map((step) => (step.key === key ? { ...step, ...patch } : step)) };
}

/** Swaps the main product of a step; title, note and time of day stay. Refused when the new product is already used at that time. */
export function replaceProduct(draft: Draft, key: string, product: DraftProduct): Draft {
  const step = draft.steps.find((candidate) => candidate.key === key);
  if (!step || hasProductAt(draft, step.timing, product.skuId, key)) return draft;
  return {
    ...draft,
    steps: draft.steps.map((candidate) =>
      candidate.key === key ? { ...candidate, product, alternatives: candidate.alternatives.filter((sku) => sku !== product.skuId) } : candidate
    ),
  };
}

/** Moves a step to another time of day; it lands at the end of that group. Refused when the product is already used there. */
export function moveToTiming(draft: Draft, key: string, timing: StepTiming): Draft {
  const step = draft.steps.find((candidate) => candidate.key === key);
  if (!step || step.timing === timing || hasProductAt(draft, timing, step.product.skuId, key)) return draft;
  return normalize({ ...draft, steps: [...draft.steps.filter((candidate) => candidate.key !== key), { ...step, timing }] });
}

/** Moves a step one place up (-1) or down (+1) inside its own time of day. */
export function nudge(draft: Draft, key: string, direction: -1 | 1): Draft {
  const step = draft.steps.find((candidate) => candidate.key === key);
  if (!step) return draft;
  const group = stepsOf(draft, step.timing);
  const index = group.findIndex((candidate) => candidate.key === key);
  const target = index + direction;
  if (target < 0 || target >= group.length) return draft;
  const next = [...group];
  [next[index], next[target]] = [next[target], next[index]];
  return reorder(draft, step.timing, next.map((candidate) => candidate.key));
}

/** Applies an explicit order (keys) to one time of day, leaving the other groups as they are. */
export function reorder(draft: Draft, timing: StepTiming, orderedKeys: string[]): Draft {
  const byKey = new Map(draft.steps.map((step) => [step.key, step]));
  const ordered = orderedKeys.map((key) => byKey.get(key)).filter((step): step is DraftStep => !!step && step.timing === timing);
  const missing = stepsOf(draft, timing).filter((step) => !orderedKeys.includes(step.key));
  return normalize({ ...draft, steps: [...draft.steps.filter((step) => step.timing !== timing), ...ordered, ...missing] });
}

/** Whether two drafts would save differently (title, area, and every step's content and order). */
export function isSameDraft(a: Draft, b: Draft): boolean {
  const flat = (draft: Draft) =>
    JSON.stringify([draft.title.trim(), draft.careArea, normalize(draft).steps.map((s) => [s.title.trim(), s.timing, s.instructions.trim(), s.isOptional, s.product.skuId, s.alternatives])]);
  return flat(a) === flat(b);
}

/** Why a draft cannot be saved yet, as message-free codes the UI translates; empty when it can. */
export type DraftProblem = 'TITLE' | 'NO_STEPS' | 'STEP_TITLE';

export function problemsOf(draft: Draft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draft.title.trim()) problems.push('TITLE');
  if (!draft.steps.length) problems.push('NO_STEPS');
  if (draft.steps.some((step) => !step.title.trim())) problems.push('STEP_TITLE');
  return problems;
}

/** The body of POST/PUT /care/personal-routines. The server resolves every SKU again; nothing here is trusted. */
export function toPayload(draft: Draft, expectedVersion?: number): RoutinePayload {
  return {
    title: draft.title.trim(),
    careArea: draft.careArea,
    steps: normalize(draft).steps.map((step) => ({
      title: step.title.trim().slice(0, STEP_TITLE_MAX),
      timing: step.timing,
      ...(step.instructions.trim() ? { instructions: step.instructions.trim().slice(0, INSTRUCTIONS_MAX) } : {}),
      ...(step.isOptional ? { isOptional: true } : {}),
      product: { skuId: step.product.skuId },
      ...(step.alternatives.length ? { alternatives: step.alternatives.map((skuId) => ({ skuId })) } : {}),
    })),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  };
}

const AREAS: readonly CareArea[] = ['skin', 'hair', 'body'];
export const asCareArea = (value: string): CareArea => (AREAS.includes(value as CareArea) ? (value as CareArea) : 'skin');

/**
 * A saved routine as an editable draft. A step whose product is gone from the catalog has no SKU to send back; it is
 * reported in `dropped` (never silently re-added or replaced) so the editor can say so.
 */
export function fromRoutine(routine: SavedRoutineView): { draft: Draft; dropped: string[] } {
  const dropped: string[] = [];
  const steps: DraftStep[] = [];
  for (const step of routine.steps) {
    const product = step.product;
    if (!product?.skuId) {
      dropped.push(step.title);
      continue;
    }
    steps.push({
      key: step.id,
      title: step.title,
      timing: step.timing,
      instructions: step.instructions ?? '',
      isOptional: step.isOptional,
      product: { skuId: product.skuId, productId: product.productId, name: product.productName ?? product.skuCode ?? '', brand: product.brandName ?? '', variant: product.variantName },
      alternatives: step.alternatives.map((alt) => alt.skuId).filter((sku): sku is string => !!sku),
    });
  }
  return { draft: normalize({ title: routine.title, careArea: asCareArea(routine.careArea), steps }), dropped };
}

/** A copy of a saved routine for «duplicate»: same steps, a distinct title, ready for POST. */
export function duplicateOf(routine: SavedRoutineView, copyTitle: (title: string) => string): Draft {
  const { draft } = fromRoutine(routine);
  return { ...draft, title: copyTitle(routine.title).slice(0, TITLE_MAX), steps: draft.steps.map((step) => ({ ...step, key: newStepKey() })) };
}

export function countByTiming(steps: ReadonlyArray<{ timing: StepTiming }>): Record<StepTiming, number> {
  return steps.reduce<Record<StepTiming, number>>((acc, step) => ({ ...acc, [step.timing]: acc[step.timing] + 1 }), { AM: 0, PM: 0, AS_NEEDED: 0 });
}
