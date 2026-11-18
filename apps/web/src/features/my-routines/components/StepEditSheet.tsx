'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TextAreaField, TextField } from '@/components/ui/field';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import type { StepTiming } from '../api/personal-routines';
import { INSTRUCTIONS_MAX, STEP_TITLE_MAX, TIMINGS, type DraftStep } from '../lib/draft';
import { timingLabel } from '../lib/labels';

export interface StepEdits {
  title: string;
  instructions: string;
  isOptional: boolean;
  timing: StepTiming;
}

/** Name, note, optional flag and time of day of one step. Edits are applied together on «تم»; closing the sheet discards them. */
export function StepEditSheet({ step, onClose, onApply, moveBlocked }: {
  step: DraftStep | null;
  onClose: () => void;
  onApply: (key: string, edits: StepEdits) => void;
  moveBlocked: (key: string, to: StepTiming) => boolean;
}) {
  const m = useMessages();
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [isOptional, setIsOptional] = useState(false);
  const [timing, setTiming] = useState<StepTiming>('AM');

  useEffect(() => {
    if (!step) return;
    setTitle(step.title);
    setInstructions(step.instructions);
    setIsOptional(step.isOptional);
    setTiming(step.timing);
  }, [step]);

  const empty = !title.trim();

  return (
    <Sheet open={!!step} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" closeLabel={m.rtClose}>
        <SheetHeader>
          <SheetTitle>{m.rtEditTitle}</SheetTitle>
          {step ? (
            <SheetDescription>
              <bdi>{[step.product.brand, step.product.name].filter(Boolean).join(' · ')}</bdi>
            </SheetDescription>
          ) : null}
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (step && !empty) onApply(step.key, { title, instructions, isOptional, timing });
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
            <TextField
              label={m.rtStepTitleLabel}
              value={title}
              maxLength={STEP_TITLE_MAX}
              placeholder={m.rtStepTitlePlaceholder}
              onChange={(event) => setTitle(event.target.value)}
              error={empty ? m.rtSaveNeedStepTitle : undefined}
            />
            <TextAreaField
              label={m.rtInstructionsLabel}
              value={instructions}
              maxLength={INSTRUCTIONS_MAX}
              rows={3}
              hint={fillMessage(m.rtInstructionsHint, { n: INSTRUCTIONS_MAX })}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 font-display text-15 font-semibold text-ink">{m.rtTimeOfDay}</legend>
              <div className="flex flex-wrap gap-2">
                {TIMINGS.map((value) => {
                  const blocked = !!step && value !== step.timing && moveBlocked(step.key, value);
                  return (
                    <Chip key={value} selected={timing === value} disabled={blocked} className="disabled:opacity-50" onClick={() => setTiming(value)}>
                      {timingLabel(m, value)}
                    </Chip>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex cursor-pointer items-start gap-3 font-display text-15 text-ink">
              <input
                type="checkbox"
                checked={isOptional}
                onChange={(event) => setIsOptional(event.target.checked)}
                className="mt-1 size-5 shrink-0 accent-cobalt"
              />
              <span className="flex flex-col">
                <span className="font-semibold">{m.rtOptionalStepLabel}</span>
                <span className="text-13 leading-20 text-stone">{m.rtOptionalStepHint}</span>
              </span>
            </label>
          </div>
          <SheetFooter>
            <Button type="submit" variant="ink" size="m" className="flex-1" disabled={empty}>
              {m.rtDone}
            </Button>
            <Button type="button" variant="ghost" size="m" onClick={onClose}>
              {m.rtCancel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
