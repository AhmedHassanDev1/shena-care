'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TextField } from '@/components/ui/field';
import { MessageBox } from '@/components/ui/message-box';
import { useAuth } from '@/features/auth/AuthContext';
import { RoutineCompatibilityPanel } from '@/features/care/components/RoutineCompatibilityPanel';
import type { CompatibilityResult } from '@/features/care/api/care-intelligence';
import { formatNumber } from '@/lib/i18n/format';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { codeOf, createRoutine, issuesOf, type CareArea, type RoutineIssue } from '../api/personal-routines';
import { useRoutinePeriod } from '../hooks/RoutinePeriodProvider';
import { useRoutineCatalog } from '../hooks/useCatalog';
import { useDraftHistory } from '../hooks/useDraftHistory';
import { defaultStepTitle, startingTiming, toDraftProduct } from '../lib/catalog';
import { addStep, countByTiming, emptyDraft, newStepKey, normalize, problemsOf, toPayload, TITLE_MAX, type Draft } from '../lib/draft';
import { useLocale } from '@/lib/i18n/LocaleProvider';
import { PeriodSwitch } from './PeriodSwitch';
import { PhoneActionBar } from './PhoneActionBar';
import { RoutineOutline } from './RoutineOutline';
import { RoutineStage } from './RoutineStage';
import { StepsEditor } from './StepsEditor';

const DRAFT_KEY = 'shina.routines.draft';

function readDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Draft) : null;
    return parsed && Array.isArray(parsed.steps) && parsed.steps.length ? normalize(parsed) : null;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft | null) {
  try {
    if (draft && draft.steps.length) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage can be blocked; the draft still lives in the page */
  }
}

function Builder() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requested = useSearchParams().get('product');
  const { withAuth } = useAuth();
  const { period } = useRoutinePeriod();
  const catalog = useRoutineCatalog();
  const { draft, apply, setTitle, undo, reset } = useDraftHistory(emptyDraft());
  const [restored, setRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<AsyncState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [issues, setIssues] = useState<RoutineIssue[]>([]);
  const [blocking, setBlocking] = useState(false);
  const preselected = useRef(false);

  // The unsaved routine survives a sign-in round trip and an accidental reload (this browser session only).
  useEffect(() => {
    const stored = readDraft();
    if (stored) {
      reset(stored);
      setRestored(true);
    }
    setHydrated(true);
  }, [reset]);
  useEffect(() => {
    if (hydrated) writeDraft(draft);
  }, [draft, hydrated]);

  // «أضف للروتين» from a product page: /routines/build?product=<slug> starts the routine with that product.
  useEffect(() => {
    if (!hydrated || preselected.current || !requested || !catalog.options.length) return;
    preselected.current = true;
    const option = catalog.options.find((candidate) => candidate.slug === requested);
    if (!option) return;
    apply((d) =>
      addStep(d, {
        key: newStepKey(), title: defaultStepTitle(option, locale), timing: startingTiming(option, period ?? 'AM'),
        instructions: '', isOptional: false, product: toDraftProduct(option), alternatives: [],
      })
    );
  }, [hydrated, requested, catalog.options, apply, locale, period]);

  const onCheck = useCallback((result: CompatibilityResult | null) => setBlocking(!!result?.issues.some((issue) => issue.severity === 'BLOCK')), []);
  const problems = problemsOf(draft);
  const counts = countByTiming(draft.steps);
  const hint =
    problems[0] === 'TITLE' ? m.rtSaveNeedName
    : problems[0] === 'NO_STEPS' ? m.rtSaveNeedSteps
    : problems[0] === 'STEP_TITLE' ? m.rtSaveNeedStepTitle
    : blocking ? m.rtSaveBlocked
    : null;
  const canSave = !hint && saveState !== 'pending';

  const save = async () => {
    if (!canSave) return;
    setSaveState('pending');
    setSaveError(null);
    setIssues([]);
    try {
      const created = await createRoutine(toPayload(draft));
      writeDraft(null);
      queryClient.invalidateQueries({ queryKey: ['my-routines', 'list'] });
      setSaveState('success');
      router.push(`${routes.myRoutineDetail(created.id)}?saved=1`);
    } catch (error) {
      setSaveState('error');
      const code = codeOf(error);
      const found = issuesOf(error);
      setIssues(found);
      setSaveError(code === 'ROUTINE_LIMIT' ? fillMessage(m.rtSaveLimit, { n: 20 }) : found.length ? m.rtSaveInvalid : m.rtSaveFailed);
    }
  };
  const onSave = () => withAuth(save, { title: m.rtSignInTitle, description: m.rtSignInBody, intent: 'save-routine' });

  const saveButton = (size: 'm' | 'l', className?: string) => (
    <AsyncButton
      variant="cobalt"
      size={size}
      state={saveState}
      pendingLabel={m.rtSaving}
      successLabel={m.rtSavedLabel}
      retryLabel={m.tryAgain}
      disabled={!canSave && saveState !== 'error'}
      onClick={onSave}
      className={className}
    >
      {m.rtSave}
    </AsyncButton>
  );

  const area = (value: CareArea) => (
    <Chip key={value} selected={draft.careArea === value} onClick={() => apply((d) => ({ ...d, careArea: value }))}>
      {value === 'skin' ? m.rtAreaSkin : value === 'hair' ? m.rtAreaHair : m.rtAreaBody}
    </Chip>
  );

  return (
    <PageContainer className="flex flex-col gap-8 pb-40 pt-6 lg:gap-10 lg:pb-16 lg:pt-10">
      <header className="flex max-w-narrow flex-col gap-2">
        <h1 className="m-0 font-display text-display-1 font-bold text-ink">{m.rtBuildTitle}</h1>
        <p className="m-0 font-display text-body text-stone">{m.rtBuildLead}</p>
      </header>

      {restored ? (
        <MessageBox tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{m.rtDraftRestored}</span>
            <Button variant="text" size="xs" onClick={() => { reset(emptyDraft()); writeDraft(null); setRestored(false); }}>{m.rtDraftClear}</Button>
          </div>
        </MessageBox>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
        <div className="flex flex-col gap-7 lg:col-span-7">
          <div className="flex flex-col gap-4">
            <TextField
              label={m.rtNameLabel}
              value={draft.title}
              maxLength={TITLE_MAX}
              placeholder={m.rtNamePlaceholder}
              onChange={(event) => setTitle(event.target.value)}
            />
            <div role="group" aria-label={m.rtAreaLabel} className="flex flex-wrap gap-2">
              {(['skin', 'hair'] as const).map(area)}
              {draft.careArea === 'body' ? area('body') : null}
            </div>
          </div>

          <PeriodSwitch counts={{ AM: counts.AM, PM: counts.PM }} className="max-w-md" />
          <StepsEditor draft={draft} apply={apply} undo={undo} />
          <RoutineCompatibilityPanel steps={draft.steps.map((step) => ({ skuId: step.product.skuId, timing: step.timing }))} onResult={onCheck} />
        </div>

        <aside aria-label={m.rtSummaryAria} className="flex flex-col gap-5 lg:col-span-5 lg:sticky lg:top-28 lg:self-start xl:col-span-4 xl:col-start-9">
          <div className="flex flex-col gap-1 border-t border-ink/15 pt-5 lg:border-t-0 lg:pt-0">
            <h2 className="m-0 font-display text-display-3 font-bold text-ink">{m.rtYourRoutine}</h2>
            <p className="m-0 font-display text-13 leading-20 text-stone">{m.rtPreviewHint}</p>
          </div>
          <RoutineOutline draft={draft} />
          <div className="hidden flex-col gap-3 lg:flex">
            {saveButton('l', 'w-full')}
            {hint ? <p className="m-0 font-display text-13 text-stone" role="status">{hint}</p> : null}
          </div>
          {saveError ? (
            <MessageBox tone="err" title={saveError}>
              {issues.length ? (
                <ul className="m-0 list-disc ps-5">
                  {issues.map((issue) => (
                    <li key={`${issue.path}-${issue.code}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : null}
            </MessageBox>
          ) : null}
        </aside>
      </div>

      <PhoneActionBar label={m.rtSave}>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-display text-13 font-semibold leading-20 text-ink">
            {m.rtMorning} <bdi>{formatNumber(counts.AM)}</bdi> · {m.rtEvening} <bdi>{formatNumber(counts.PM)}</bdi>
          </span>
          {hint ? <span className={cn('truncate font-display text-12 leading-16 text-stone')}>{hint}</span> : null}
        </div>
        {saveButton('m')}
      </PhoneActionBar>
    </PageContainer>
  );
}

export function RoutineBuilder() {
  return (
    <RoutineStage>
      <Builder />
    </RoutineStage>
  );
}
