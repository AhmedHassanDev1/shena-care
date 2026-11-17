'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { AsyncButton, Button, buttonVariants, type AsyncState } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import { MessageBox } from '@/components/ui/message-box';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { useAuth } from '@/features/auth/AuthContext';
import { signInHref } from '@/features/auth/lib/auth-helpers';
import type { CompatibilityResult } from '@/features/care/api/care-intelligence';
import { RoutineCompatibilityPanel } from '@/features/care/components/RoutineCompatibilityPanel';
import { CART_QUERY_KEY } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import {
  addRoutineToCart, codeOf, createRoutine, deleteRoutine, getRoutine, issuesOf, replaceRoutine, type RoutineIssue,
} from '../api/personal-routines';
import { useRoutinePeriod } from '../hooks/RoutinePeriodProvider';
import { useRoutineCatalog } from '../hooks/useCatalog';
import { useDraftHistory } from '../hooks/useDraftHistory';
import { useToastMessage } from '../hooks/useToastMessage';
import { countByTiming, duplicateOf, emptyDraft, fromRoutine, isSameDraft, problemsOf, stepsOf, TITLE_MAX, toPayload } from '../lib/draft';
import { areaLabel, originLabel, productStateLabel, stepsLabel, timingLabel } from '../lib/labels';
import { DeleteRoutineDialog } from './DeleteRoutineDialog';
import { PeriodSwitch } from './PeriodSwitch';
import { PhoneActionBar } from './PhoneActionBar';
import { RoutineStage } from './RoutineStage';
import { StepList } from './StepList';
import { StepsEditor } from './StepsEditor';

const detailKey = (id: string) => ['my-routines', 'detail', id] as const;

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6 pt-2">
      <Skeleton className="h-10 w-2/3 rounded-pill" />
      <Skeleton className="h-4 w-1/2 rounded-pill" />
      <Skeleton className="h-13 w-full max-w-md rounded-pill" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3.5 border-b border-ink/10 py-4">
          <Skeleton className="size-16 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-1/3 rounded-pill" />
            <Skeleton className="h-4 w-2/3 rounded-pill" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Details({ id }: { id: string }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading, openAuthModal } = useAuth();
  const { period } = useRoutinePeriod();
  const active = period ?? 'AM';
  const catalog = useRoutineCatalog();
  const { toast, show } = useToastMessage();

  const query = useQuery({ queryKey: detailKey(id), queryFn: () => getRoutine(id), enabled: isAuthenticated, staleTime: 15_000, retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1 });
  const server = query.data;
  const baseline = useMemo(() => (server ? fromRoutine(server) : null), [server]);
  const { draft, apply, setTitle, undo, canUndo, reset } = useDraftHistory(emptyDraft());
  const [mode, setMode] = useState<'view' | 'edit'>(search.get('edit') === '1' ? 'edit' : 'view');
  const [saveState, setSaveState] = useState<AsyncState>('idle');
  const [saveError, setSaveError] = useState<{ text: string; stale: boolean } | null>(null);
  const [issues, setIssues] = useState<RoutineIssue[]>([]);
  const [blocking, setBlocking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteState, setDeleteState] = useState<AsyncState>('idle');
  const [busy, setBusy] = useState<'copy' | 'cart' | null>(null);
  const loadedVersion = useRef<number | null>(null);

  // The draft follows the server copy; a refetch never replaces an edit in progress (same version) .
  useEffect(() => {
    if (!baseline || !server) return;
    if (mode === 'edit' && loadedVersion.current === server.version) return;
    loadedVersion.current = server.version;
    reset(baseline.draft);
  }, [baseline, server, mode, reset]);

  // Arrived from the builder right after saving.
  useEffect(() => {
    if (search.get('saved') !== '1') return;
    show(m.rtRoutineSaved);
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = mode === 'edit' && !!baseline && !isSameDraft(draft, baseline.draft);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const onCheck = useCallback((result: CompatibilityResult | null) => setBlocking(!!result?.issues.some((issue) => issue.severity === 'BLOCK')), []);
  const problems = problemsOf(draft);
  const hint =
    problems[0] === 'TITLE' ? m.rtSaveNeedName
    : problems[0] === 'NO_STEPS' ? m.rtSaveNeedSteps
    : problems[0] === 'STEP_TITLE' ? m.rtSaveNeedStepTitle
    : blocking ? m.rtSaveBlocked
    : !dirty ? m.rtNoChanges
    : null;
  const canSave = !hint && saveState !== 'pending';

  const stateOfStep = useMemo(() => new Map((server?.steps ?? []).map((step) => [step.id, step.product?.state ?? 'MISSING'])), [server]);
  const counts = countByTiming(draft.steps);

  const startEdit = () => { setSaveError(null); setIssues([]); setSaveState('idle'); setMode('edit'); };
  const leaveEdit = () => {
    if (baseline) reset(baseline.draft);
    setSaveError(null); setIssues([]); setSaveState('idle'); setConfirmDiscard(false); setMode('view');
  };

  const save = async () => {
    if (!canSave || !server) return;
    setSaveState('pending');
    setSaveError(null);
    setIssues([]);
    try {
      const saved = await replaceRoutine(id, toPayload(draft, server.version));
      queryClient.setQueryData(detailKey(id), saved);
      queryClient.invalidateQueries({ queryKey: ['my-routines', 'list'] });
      loadedVersion.current = null;
      reset(fromRoutine(saved).draft);
      setSaveState('idle');
      setMode('view');
      show(m.rtChangesSaved);
    } catch (error) {
      setSaveState('error');
      const code = codeOf(error);
      const found = issuesOf(error);
      setIssues(found);
      setSaveError({ stale: code === 'STALE_VERSION', text: code === 'STALE_VERSION' ? m.rtStale : found.length ? m.rtSaveInvalid : m.rtSaveFailed });
    }
  };

  const reload = async () => {
    loadedVersion.current = null;
    setSaveError(null);
    setSaveState('idle');
    await query.refetch();
  };

  const duplicate = async () => {
    if (!server || busy) return;
    setBusy('copy');
    try {
      const copy = await createRoutine(toPayload(duplicateOf(server, (title) => fillMessage(m.rtCopyTitle, { title }))));
      queryClient.invalidateQueries({ queryKey: ['my-routines', 'list'] });
      router.push(`${routes.myRoutineDetail(copy.id)}?saved=1`);
    } catch {
      show(m.rtDuplicateFailed);
      setBusy(null);
    }
  };

  const addToCart = async () => {
    if (busy) return;
    setBusy('cart');
    try {
      const result = await addRoutineToCart(id, active);
      queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
      const skipped = result.skipped.length + (result.unavailable?.length ?? 0);
      if (result.added.length) {
        show(skipped ? `${fillMessage(m.rtCartAdded, { n: formatNumber(result.added.length) })}. ${fillMessage(m.rtCartSkipped, { n: formatNumber(skipped) })}` : fillMessage(m.rtCartAdded, { n: formatNumber(result.added.length) }), { label: m.rtViewCart, onClick: () => router.push(routes.cart) });
      } else {
        show(m.rtCartNothing);
      }
    } catch {
      show(m.rtCartFailed);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setDeleteState('pending');
    try {
      await deleteRoutine(id);
      queryClient.removeQueries({ queryKey: detailKey(id) });
      await queryClient.invalidateQueries({ queryKey: ['my-routines', 'list'] });
      router.push(routes.myRoutine);
    } catch {
      setDeleteState('error');
    }
  };

  const back = (
    <Link href={routes.myRoutine} className="inline-flex items-center gap-1.5 self-start font-display text-15 font-semibold text-cobalt no-underline hover:underline">
      <Icon name="chevron-back" size={18} />
      {m.rtBackToMine}
    </Link>
  );

  // ── gates ──
  if (authLoading || (isAuthenticated && query.isPending)) {
    return <PageContainer className="flex flex-col gap-4 pb-32 pt-6 lg:pt-10">{back}<DetailSkeleton /></PageContainer>;
  }
  if (!isAuthenticated) {
    return (
      <PageContainer className="flex max-w-narrow flex-col items-start gap-4 pb-32 pt-6 lg:pt-10">
        {back}
        <h1 className="m-0 font-display text-display-2 font-bold text-ink">{m.rtMineSignInTitle}</h1>
        <p className="m-0 font-display text-body text-stone">{m.rtMineSignInBody}</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="ink" size="m" onClick={() => openAuthModal({ title: m.rtMineSignInTitle, intent: 'my-routines' })}>{m.rtSignIn}</Button>
          <Link href={signInHref(routes.myRoutineDetail(id))} className={buttonVariants({ variant: 'ghost', size: 'm' })}>{m.authTabSignIn}</Link>
        </div>
      </PageContainer>
    );
  }
  if (query.isError || !server || !baseline) {
    const missing = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403);
    return (
      <PageContainer className="flex max-w-narrow flex-col items-start gap-4 pb-32 pt-6 lg:pt-10">
        {back}
        <h1 className="m-0 font-display text-display-2 font-bold text-ink">{missing ? m.rtNotFoundTitle : m.rtDetailErrorTitle}</h1>
        {missing ? <p className="m-0 font-display text-body text-stone">{m.rtNotFoundBody}</p> : <Button variant="ink" size="m" onClick={() => query.refetch()}>{m.tryAgain}</Button>}
      </PageContainer>
    );
  }

  const editing = mode === 'edit';
  const activeSteps = stepsOf(draft, active);
  const asNeeded = stepsOf(draft, 'AS_NEEDED');
  const droppedNote = baseline.dropped.length ? fillMessage(m.rtDropped, { names: baseline.dropped.join('، ') }) : null;
  const list = (steps: typeof activeSteps) => (
    <StepList
      steps={steps}
      mode="view"
      catalog={catalog.bySku}
      warningOf={(step) => productStateLabel(m, stateOfStep.get(step.key) ?? 'AVAILABLE')}
      detailsOf={(step) => {
        const usage = catalog.bySku.get(step.product.skuId)?.usage;
        return (
          <details className="group">
            <summary className="cursor-pointer list-none font-display text-14 font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1.5">
                {m.rtHowToUse}
                <Icon name="chevron-down" size={16} className="transition-transform duration-fast ease-standard group-open:rotate-180" />
              </span>
            </summary>
            <div className="mt-2 flex max-w-narrow flex-col gap-1 font-display text-14 leading-24 text-ink">
              <p className="m-0 whitespace-pre-line">{usage ?? m.rtNoUsage}</p>
              {usage ? <p className="m-0 text-12 text-stone">{m.rtFromProduct}</p> : null}
            </div>
          </details>
        );
      }}
    />
  );

  const saveBar = (size: 'm' | 'l', full?: boolean) => (
    <>
      <AsyncButton variant="cobalt" size={size} state={saveState} pendingLabel={m.rtSaving} retryLabel={m.tryAgain}
        disabled={!canSave && saveState !== 'error'} onClick={save} className={full ? 'w-full' : undefined}>
        {m.rtSaveChanges}
      </AsyncButton>
      <Button variant="ghost" size={size} disabled={saveState === 'pending'} onClick={() => (dirty ? setConfirmDiscard(true) : leaveEdit())} className={full ? 'w-full' : undefined}>
        {m.rtCancel}
      </Button>
    </>
  );

  return (
    <PageContainer className="flex flex-col gap-7 pb-44 pt-5 lg:gap-9 lg:pb-20 lg:pt-8">
      <header className="flex flex-col gap-3">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 max-w-narrow flex-1 flex-col gap-2">
            {editing ? (
              <TextField label={m.rtNameLabel} value={draft.title} maxLength={TITLE_MAX} onChange={(event) => setTitle(event.target.value)} />
            ) : (
              <h1 className="m-0 break-words font-display text-display-1 font-bold text-ink"><bdi>{server.title}</bdi></h1>
            )}
            <p className="m-0 font-display text-14 leading-20 text-stone">
              {[areaLabel(m, server.careArea), originLabel(m, server.origin), fillMessage(m.rtUpdated, { date: formatDate(server.updatedAt, locale) })].join(" · ")}
            </p>
          </div>
          {editing ? (
            <div className="flex flex-wrap items-center gap-2">
              {dirty ? <StatusChip tone="warn">{m.rtUnsaved}</StatusChip> : <StatusChip tone="gray">{m.rtEditing}</StatusChip>}
              <Button variant="ghost" size="xs" disabled={!canUndo} onClick={undo}>
                <Icon name="undo" size={16} />
                {m.rtUndoLast}
              </Button>
            </div>
          ) : (
            <Button variant="ink" size="m" onClick={startEdit}>
              <Icon name="pencil" size={18} />
              {m.rtEdit}
            </Button>
          )}
        </div>
      </header>

      {droppedNote ? <MessageBox tone="warn">{droppedNote}</MessageBox> : null}
      {saveError ? (
        <MessageBox tone="err" title={saveError.text}>
          {saveError.stale ? <Button variant="ghost" size="xs" className="mt-1 self-start" onClick={reload}>{m.rtReload}</Button> : null}
          {issues.length ? (
            <ul className="m-0 list-disc ps-5">
              {issues.map((issue) => <li key={`${issue.path}-${issue.code}`}>{issue.message}</li>)}
            </ul>
          ) : null}
        </MessageBox>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <PeriodSwitch counts={{ AM: counts.AM, PM: counts.PM }} className="max-w-md" />

          {editing ? (
            <StepsEditor draft={draft} apply={apply} undo={undo} />
          ) : (
            <>
              <section aria-labelledby="detail-period" className="flex flex-col gap-1">
                <h2 id="detail-period" className="m-0 font-display text-display-2 font-bold text-ink">{timingLabel(m, active)}</h2>
                <p className="m-0 font-display text-14 text-stone">{stepsLabel(m, activeSteps.length, (n) => formatNumber(n))}</p>
                {activeSteps.length ? (
                  <div className="mt-2 border-t border-ink/10">{list(activeSteps)}</div>
                ) : (
                  <div className="mt-2 flex flex-col items-start gap-3 border-y border-ink/10 py-8">
                    <p className="m-0 font-display text-20 font-bold text-ink">{active === 'PM' ? m.rtEmptyEveningTitle : m.rtEmptyMorningTitle}</p>
                    <Button variant="ghost" size="m" onClick={startEdit}><Icon name="plus" size={18} />{m.rtAddStep}</Button>
                  </div>
                )}
              </section>
              {asNeeded.length ? (
                <section aria-labelledby="detail-asneeded" className="flex flex-col gap-1">
                  <h2 id="detail-asneeded" className="m-0 font-display text-display-3 font-bold text-ink">{m.rtAsNeeded}</h2>
                  <div className="mt-1 border-t border-ink/10">{list(asNeeded)}</div>
                </section>
              ) : null}
            </>
          )}
        </div>

        <aside aria-label={m.rtRoutineContext} className="flex flex-col gap-6 lg:col-span-5 lg:sticky lg:top-28 lg:self-start xl:col-span-4 xl:col-start-9">
          <section aria-labelledby="detail-context" className="flex flex-col gap-2 border-t border-ink/15 pt-5 lg:border-t-0 lg:pt-0">
            <h2 id="detail-context" className="m-0 font-display text-display-3 font-bold text-ink">{m.rtRoutineContext}</h2>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-display text-14 leading-24">
              <dt className="text-stone">{m.rtAreaLabel}</dt><dd className="m-0 text-ink">{areaLabel(m, server.careArea)}</dd>
              <dt className="text-stone">{m.rtMorning}</dt><dd className="m-0 text-ink"><bdi>{formatNumber(counts.AM)}</bdi></dd>
              <dt className="text-stone">{m.rtEvening}</dt><dd className="m-0 text-ink"><bdi>{formatNumber(counts.PM)}</bdi></dd>
              {counts.AS_NEEDED ? (<><dt className="text-stone">{m.rtAsNeeded}</dt><dd className="m-0 text-ink"><bdi>{formatNumber(counts.AS_NEEDED)}</bdi></dd></>) : null}
              <dt className="text-stone">{m.rtVersionLabel}</dt><dd className="m-0 text-ink"><bdi>{formatNumber(server.version)}</bdi></dd>
            </dl>
          </section>

          <RoutineCompatibilityPanel steps={draft.steps.map((step) => ({ skuId: step.product.skuId, timing: step.timing }))} onResult={onCheck} />

          {editing ? (
            <div className="hidden flex-col gap-3 lg:flex">
              {saveBar('l', true)}
              {hint ? <p role="status" className="m-0 font-display text-13 text-stone">{hint}</p> : null}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1">
              <Button variant="cobalt" size="m" loading={busy === 'cart'} pendingLabel={m.rtAddingToCart} disabled={!activeSteps.length || busy !== null} onClick={addToCart}>
                <Icon name="cart" size={18} />
                {fillMessage(m.rtAddToCart, { period: active === 'PM' ? m.rtEveningLong : m.rtMorningLong })}
              </Button>
              <div className="flex flex-wrap items-center">
                <Button variant="text" size="m" className="me-5 min-h-control-m" loading={busy === 'copy'} pendingLabel={m.rtDuplicating} disabled={busy !== null} onClick={duplicate}>
                  <Icon name="copy" size={18} />{m.rtDuplicate}
                </Button>
                <Button variant="text" size="m" className="min-h-control-m text-tomato-ink" onClick={() => { setDeleteState('idle'); setConfirmDelete(true); }}>
                  <Icon name="trash" size={18} />{m.rtDelete}
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {editing ? (
        <PhoneActionBar label={m.rtSaveChanges}>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className={cn('font-display text-13 font-semibold leading-20', dirty ? 'text-ink' : 'text-stone')}>{dirty ? m.rtUnsaved : m.rtNoChanges}</span>
            {hint && dirty ? <span className="truncate font-display text-12 leading-16 text-stone">{hint}</span> : null}
          </div>
          {saveBar('m')}
        </PhoneActionBar>
      ) : null}

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent closeLabel={m.rtClose}>
          <DialogHeader>
            <DialogTitle>{m.rtDiscardTitle}</DialogTitle>
            <DialogDescription>{m.rtDiscardBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="danger" size="m" onClick={leaveEdit}>{m.rtDiscard}</Button>
            <Button variant="ghost" size="m" onClick={() => setConfirmDiscard(false)}>{m.rtKeepEditing}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DeleteRoutineDialog name={confirmDelete ? server.title : null} state={deleteState} error={deleteState === 'error'} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
      {toast}
    </PageContainer>
  );
}

export function RoutineDetailsView({ id }: { id: string }) {
  return (
    <RoutineStage>
      <Details id={id} />
    </RoutineStage>
  );
}
