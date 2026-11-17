'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { sequenceRoutine } from '@/features/routine/lib/catalog-routine';
import type { StepTiming } from '../api/personal-routines';
import { useRoutinePeriod } from '../hooks/RoutinePeriodProvider';
import type { RoutinePeriod } from '../lib/period';
import { useRoutineCatalog } from '../hooks/useCatalog';
import { useToastMessage } from '../hooks/useToastMessage';
import { defaultStepTitle, startingTiming, toDraftProduct, type PickOption } from '../lib/catalog';
import {
  addStep, hasProductAt, MAX_STEPS, moveToTiming, newStepKey, nudge, removeStep, reorder, replaceProduct, stepsOf, updateStep, type Draft,
} from '../lib/draft';
import { stepsLabel, timingLabel, timingSentence } from '../lib/labels';
import { ProductPickerSheet, type PickerTarget } from './ProductPickerSheet';
import { StepEditSheet, type StepEdits } from './StepEditSheet';
import { StepList } from './StepList';

interface Props {
  draft: Draft;
  apply: (operation: (draft: Draft) => Draft) => void;
  undo: () => void;
}

/**
 * The editable part shared by «اعمل روتينك» and the details page in edit mode: the list of the chosen time of day, adding,
 * replacing, moving, reordering and editing steps. It only ever changes the draft it is given; saving is the page's job.
 */
export function StepsEditor({ draft, apply, undo }: Props) {
  const m = useMessages();
  const locale = useLocale();
  const { period } = useRoutinePeriod();
  const active: RoutinePeriod = period ?? 'AM';
  const catalog = useRoutineCatalog();
  const { toast, show } = useToastMessage();
  const [picker, setPicker] = useState<(PickerTarget & { stepKey?: string }) | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);

  const steps = stepsOf(draft, active);
  const asNeeded = stepsOf(draft, 'AS_NEEDED');
  const full = draft.steps.length >= MAX_STEPS;
  const fmt = (n: number) => formatNumber(n);
  const editing = draft.steps.find((step) => step.key === editKey) ?? null;

  const takenSkus = useMemo(() => {
    const timing = picker?.timing;
    return new Set(draft.steps.filter((step) => step.timing === timing && step.key !== picker?.stepKey).map((step) => step.product.skuId));
  }, [draft.steps, picker]);

  const moveBlocked = (key: string, to: StepTiming) => {
    const step = draft.steps.find((candidate) => candidate.key === key);
    return !!step && hasProductAt(draft, to, step.product.skuId, key);
  };

  const pick = (option: PickOption) => {
    if (!picker) return;
    if (picker.mode === 'replace' && picker.stepKey) {
      apply((d) => replaceProduct(d, picker.stepKey!, toDraftProduct(option)));
      show(m.rtPickReplaced, { label: m.rtUndo, onClick: undo });
      setPicker(null);
      return;
    }
    const timing = startingTiming(option, picker.timing);
    apply((d) =>
      addStep(d, {
        key: newStepKey(),
        title: defaultStepTitle(option, locale),
        timing,
        instructions: '',
        isOptional: false,
        product: toDraftProduct(option),
        alternatives: [],
      })
    );
    show(fillMessage(m.rtPickAdded, { name: option.name, period: timingSentence(m, timing) }), { label: m.rtUndo, onClick: undo });
  };

  const remove = (key: string) => {
    apply((d) => removeStep(d, key));
    show(m.rtStepRemoved, { label: m.rtUndo, onClick: undo });
  };

  const move = (key: string, to: StepTiming) => {
    apply((d) => moveToTiming(d, key, to));
    show(fillMessage(m.rtStepMoved, { period: timingSentence(m, to) }), { label: m.rtUndo, onClick: undo });
  };

  const applyEdits = (key: string, edits: StepEdits) => {
    apply((d) => {
      const step = d.steps.find((candidate) => candidate.key === key);
      const edited = updateStep(d, key, { title: edits.title.trim(), instructions: edits.instructions.trim(), isOptional: edits.isOptional });
      return step && edits.timing !== step.timing ? moveToTiming(edited, key, edits.timing) : edited;
    });
    setEditKey(null);
  };

  const arrange = async () => {
    if (arranging || steps.length < 2) return;
    setArranging(true);
    try {
      const sequence = await sequenceRoutine(steps.map((step) => step.product.skuId), active);
      const keyBySku = new Map(steps.map((step) => [step.product.skuId, step.key]));
      const ordered = sequence.steps.map((step) => keyBySku.get(step.skuId)).filter((key): key is string => !!key);
      if (ordered.length) apply((d) => reorder(d, active, ordered));
      show(m.rtAutoArrangeDone, { label: m.rtUndo, onClick: undo });
    } catch {
      show(m.rtAutoArrangeFailed);
    } finally {
      setArranging(false);
    }
  };

  const heading = active === 'PM' ? m.rtEvening : m.rtMorning;
  const emptyTitle = active === 'PM' ? m.rtEmptyEveningTitle : m.rtEmptyMorningTitle;
  const list = (items: typeof steps) => (
    <StepList
      steps={items}
      mode="edit"
      catalog={catalog.bySku}
      onReorder={(keys) => apply((d) => reorder(d, items[0].timing, keys))}
      onNudge={(key, direction) => apply((d) => nudge(d, key, direction))}
      onMove={move}
      onEdit={setEditKey}
      onReplace={(key) => setPicker({ mode: 'replace', stepKey: key, timing: draft.steps.find((step) => step.key === key)?.timing ?? active })}
      onRemove={remove}
      moveBlocked={moveBlocked}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="routine-period-heading" className="flex flex-col gap-1">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="flex flex-col">
            <h2 id="routine-period-heading" className="m-0 font-display text-display-2 font-bold text-ink">{heading}</h2>
            <p aria-live="polite" className="m-0 font-display text-14 text-stone">{stepsLabel(m, steps.length, fmt)}</p>
          </div>
          {steps.length >= 2 ? (
            <Button variant="ghost" size="xs" loading={arranging} pendingLabel={m.rtAutoArranging} onClick={arrange}>
              {m.rtAutoArrange}
            </Button>
          ) : null}
        </div>

        {steps.length === 0 ? (
          <div className="flex flex-col items-start gap-3 border-y border-ink/10 py-8">
            <p className="m-0 font-display text-20 font-bold text-ink">{emptyTitle}</p>
            <p className="m-0 max-w-narrow font-display text-15 leading-24 text-stone">{m.rtEmptyBody}</p>
          </div>
        ) : (
          <>
            <p className="m-0 font-display text-13 leading-20 text-stone">{m.rtOrderHint}</p>
            <div className="border-t border-ink/10">{list(steps)}</div>
          </>
        )}

        <Button variant={steps.length === 0 ? 'cobalt' : 'ghost'} size="m" disabled={full} className="mt-3 self-start" onClick={() => setPicker({ mode: 'add', timing: active })}>
          <Icon name="plus" size={18} />
          {steps.length === 0 ? m.rtAddFirst : m.rtAddStep}
        </Button>
      </section>

      {asNeeded.length ? (
        <section aria-labelledby="routine-asneeded-heading" className="flex flex-col gap-1">
          <h2 id="routine-asneeded-heading" className="m-0 font-display text-display-3 font-bold text-ink">{timingLabel(m, 'AS_NEEDED')}</h2>
          <p className="m-0 font-display text-14 text-stone">{stepsLabel(m, asNeeded.length, fmt)}</p>
          <div className="border-t border-ink/10">{list(asNeeded)}</div>
        </section>
      ) : null}

      <ProductPickerSheet
        open={!!picker}
        onOpenChange={(open) => !open && setPicker(null)}
        target={picker ?? { mode: 'add', timing: active }}
        careArea={draft.careArea}
        takenSkus={takenSkus}
        full={full}
        onPick={pick}
      />
      <StepEditSheet step={editing} onClose={() => setEditKey(null)} onApply={applyEdits} moveBlocked={moveBlocked} />
      {toast}
    </div>
  );
}
