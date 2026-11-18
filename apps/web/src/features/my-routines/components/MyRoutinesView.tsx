'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { type AsyncState, Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { ProductTile } from '@/components/ui/product-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatusChip } from '@/components/ui/status-chip';
import { useAuth } from '@/features/auth/AuthContext';
import { signInHref } from '@/features/auth/lib/auth-helpers';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { createRoutine, deleteRoutine, getRoutine, listRoutines, type RoutineListItem, type SavedRoutineView } from '../api/personal-routines';
import { useRoutineCatalog } from '../hooks/useCatalog';
import { useRoutinePeriod } from '../hooks/RoutinePeriodProvider';
import { useToastMessage } from '../hooks/useToastMessage';
import { duplicateOf, toPayload } from '../lib/draft';
import { areaLabel, originLabel, stepsLabel, timingSentence } from '../lib/labels';
import { DeleteRoutineDialog } from './DeleteRoutineDialog';
import { PeriodSwitch } from './PeriodSwitch';
import { RoutineStage } from './RoutineStage';

const MAX_ROUTINES = 20;
const LIST_KEY = ['my-routines', 'list'] as const;
const detailKey = (id: string) => ['my-routines', 'detail', id] as const;

function RoutineRowSkeleton() {
  return (
    <div className="flex flex-col gap-3 border-b border-ink/10 py-6">
      <Skeleton className="h-7 w-2/5 rounded-pill" />
      <Skeleton className="h-4 w-3/5 rounded-pill" />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="size-12 rounded-pill" />
        ))}
      </div>
    </div>
  );
}

function RoutineRow({ item, detail, detailPending, busy, copying, onDuplicate, onDelete }: {
  item: RoutineListItem;
  detail: SavedRoutineView | undefined;
  detailPending: boolean;
  busy: boolean;
  /** This row is being copied right now. */
  copying: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const { period } = useRoutinePeriod();
  const catalog = useRoutineCatalog();
  const active = period ?? 'AM';
  const here = detail?.steps.filter((step) => step.timing === active) ?? [];
  const am = detail?.steps.filter((step) => step.timing === 'AM').length ?? 0;
  const pm = detail?.steps.filter((step) => step.timing === 'PM').length ?? 0;
  const unavailable = detail?.steps.filter((step) => step.product?.state !== 'AVAILABLE').length ?? 0;
  const title = <bdi>{item.title}</bdi>;

  return (
    <li className="relative border-b border-ink/10 py-5 last:border-b-0 lg:py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="m-0 font-display text-display-3 font-bold text-ink">
            <Link
              href={routes.myRoutineDetail(item.id)}
              aria-label={fillMessage(m.rtCardOpen, { name: item.title })}
              className="text-ink no-underline after:absolute after:inset-0 after:content-[''] hover:text-cobalt"
            >
              {title}
            </Link>
          </h2>
          <p className="m-0 font-display text-14 leading-20 text-stone">
            {[areaLabel(m, item.careArea), originLabel(m, item.origin), stepsLabel(m, item.steps, (n) => formatNumber(n)), fillMessage(m.rtUpdated, { date: formatDate(item.updatedAt, locale) })].join(" · ")}
          </p>
        </div>
        <div className="relative z-1 flex shrink-0 items-center">
          <Link
            href={`${routes.myRoutineDetail(item.id)}?edit=1`}
            aria-label={`${m.rtEdit}: ${item.title}`}
            title={m.rtEdit}
            className="inline-flex size-control-m items-center justify-center rounded-pill text-ink transition-colors duration-fast ease-standard hover:bg-sand/70"
          >
            <Icon name="pencil" size={20} />
          </Link>
          <button
            type="button"
            disabled={busy || !detail}
            aria-label={`${m.rtDuplicate}: ${item.title}`}
            title={copying ? m.rtDuplicating : m.rtDuplicate}
            aria-busy={copying || undefined}
            onClick={onDuplicate}
            className="inline-flex size-control-m items-center justify-center rounded-pill text-ink transition-colors duration-fast ease-standard hover:bg-sand/70 disabled:cursor-not-allowed disabled:text-stone/60"
          >
            {copying ? <Spinner size="s" className="text-current" /> : <Icon name="copy" size={20} />}
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label={`${m.rtDelete}: ${item.title}`}
            title={m.rtDelete}
            onClick={onDelete}
            className="inline-flex size-control-m items-center justify-center rounded-pill text-tomato-ink transition-colors duration-fast ease-standard hover:bg-conflict disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name="trash" size={20} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {detailPending ? (
          <Skeleton className="h-12 w-48 rounded-pill" />
        ) : here.length ? (
          <>
            <ul aria-label={timingSentence(m, active)} className="m-0 flex list-none items-center p-0 ps-3">
              {here.slice(0, 4).map((step) => (
                <li key={step.id} className="-ms-3">
                  <ProductTile
                    src={(step.product?.skuId && catalog.bySku.get(step.product.skuId)?.imageUrl) || null}
                    alt=""
                    name={step.product?.productName ?? step.title}
                    size="thumb"
                    className="size-12 rounded-full bg-linen shadow-outline-hairline ring-2 ring-chalk"
                  />
                </li>
              ))}
            </ul>
            <p className="m-0 min-w-0 flex-1 font-display text-15 leading-24 text-ink">
              <bdi>{here.slice(0, 3).map((step) => step.title).join(' · ')}</bdi>
              {here.length > 3 ? <span className="whitespace-nowrap text-stone"> · <bdi>{fillMessage(m.rtMoreSteps, { n: formatNumber(here.length - 3) })}</bdi></span> : null}
            </p>
          </>
        ) : detail ? (
          <p className="m-0 font-display text-15 text-stone">{fillMessage(m.rtNothingInPeriod, { period: timingSentence(m, active) })}</p>
        ) : null}
      </div>

      {detail ? (
        <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-13 text-stone">
          <span>{m.rtMorning} <bdi>{formatNumber(am)}</bdi></span>
          <span>{m.rtEvening} <bdi>{formatNumber(pm)}</bdi></span>
          {unavailable ? <StatusChip tone="warn">{fillMessage(m.rtUnavailableCount, { n: formatNumber(unavailable) })}</StatusChip> : null}
        </p>
      ) : null}
    </li>
  );
}

function Mine() {
  const m = useMessages();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading, openAuthModal } = useAuth();
  const { toast, show } = useToastMessage();
  const [pendingDelete, setPendingDelete] = useState<RoutineListItem | null>(null);
  const [deleteState, setDeleteState] = useState<AsyncState>('idle');
  const [deleteError, setDeleteError] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const list = useQuery({ queryKey: LIST_KEY, queryFn: listRoutines, enabled: isAuthenticated, staleTime: 15_000 });
  const details = useQueries({
    queries: (list.data ?? []).map((item) => ({ queryKey: detailKey(item.id), queryFn: () => getRoutine(item.id), staleTime: 30_000 })),
  });
  const detailById = new Map((list.data ?? []).map((item, index) => [item.id, details[index]]));

  const duplicate = async (item: RoutineListItem) => {
    const source = detailById.get(item.id)?.data;
    if (!source || duplicating) return;
    setDuplicating(item.id);
    try {
      const copy = await createRoutine(toPayload(duplicateOf(source, (title) => fillMessage(m.rtCopyTitle, { title }))));
      await queryClient.invalidateQueries({ queryKey: LIST_KEY });
      show(m.rtDuplicated, { label: m.rtOpen, onClick: () => router.push(routes.myRoutineDetail(copy.id)) });
    } catch {
      show(m.rtDuplicateFailed);
    } finally {
      setDuplicating(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteState('pending');
    setDeleteError(false);
    try {
      await deleteRoutine(pendingDelete.id);
      queryClient.removeQueries({ queryKey: detailKey(pendingDelete.id) });
      await queryClient.invalidateQueries({ queryKey: LIST_KEY });
      setPendingDelete(null);
      setDeleteState('idle');
      show(m.rtDeleted);
    } catch {
      setDeleteState('error');
      setDeleteError(true);
    }
  };

  const total = list.data?.length ?? 0;

  return (
    <PageContainer className="flex flex-col gap-7 pb-32 pt-6 lg:gap-9 lg:pb-20 lg:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex max-w-narrow flex-col gap-2">
          <h1 className="m-0 font-display text-display-1 font-bold text-ink">{m.rtMineTitle}</h1>
          <p className="m-0 font-display text-body text-stone">{m.rtMineLead}</p>
        </div>
        <Link href={routes.routineBuilder} className={cn(buttonVariants({ variant: 'cobalt', size: 'm' }))}>
          <Icon name="plus" size={18} />
          {m.rtNewRoutine}
        </Link>
      </header>

      {authLoading ? (
        <div aria-busy="true"><RoutineRowSkeleton /><RoutineRowSkeleton /></div>
      ) : !isAuthenticated ? (
        <section aria-labelledby="mine-signin" className="flex max-w-narrow flex-col items-start gap-4 border-y border-ink/10 py-10">
          <h2 id="mine-signin" className="m-0 font-display text-display-2 font-bold text-ink">{m.rtMineSignInTitle}</h2>
          <p className="m-0 font-display text-body text-stone">{m.rtMineSignInBody}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="ink" size="m" onClick={() => openAuthModal({ title: m.rtMineSignInTitle, intent: 'my-routines' })}>{m.rtSignIn}</Button>
            <Link href={signInHref(routes.myRoutine)} className={buttonVariants({ variant: 'ghost', size: 'm' })}>{m.authTabSignIn}</Link>
          </div>
        </section>
      ) : (
        <>
          <PeriodSwitch className="max-w-md" />

          {list.isPending ? (
            <div aria-busy="true"><RoutineRowSkeleton /><RoutineRowSkeleton /><RoutineRowSkeleton /></div>
          ) : list.isError ? (
            <MessageBox tone="err" title={m.rtMineErrorTitle}>
              <Button variant="ghost" size="xs" className="mt-1 self-start" onClick={() => list.refetch()}>{m.tryAgain}</Button>
            </MessageBox>
          ) : total === 0 ? (
            <section aria-labelledby="mine-empty" className="flex max-w-narrow flex-col items-start gap-4 border-y border-ink/10 py-10">
              <h2 id="mine-empty" className="m-0 font-display text-display-2 font-bold text-ink">{m.rtMineEmptyTitle}</h2>
              <p className="m-0 font-display text-body text-stone">{m.rtMineEmptyBody}</p>
              <div className="flex flex-wrap gap-3">
                <Link href={routes.routineBuilder} className={buttonVariants({ variant: 'cobalt', size: 'm' })}>
                  <Icon name="plus" size={18} />
                  {m.rtNewRoutine}
                </Link>
                <Link href={routes.routines} className={buttonVariants({ variant: 'ghost', size: 'm' })}>{m.rtReadyRoutines}</Link>
              </div>
            </section>
          ) : (
            <section aria-label={m.rtRoutinesList} className="flex flex-col">
              <ul className="m-0 list-none border-t border-ink/10 p-0">
                {list.data!.map((item) => {
                  const query = detailById.get(item.id);
                  return (
                    <RoutineRow
                      key={item.id}
                      item={item}
                      detail={query?.data}
                      detailPending={!!query?.isPending}
                      busy={duplicating !== null}
                      copying={duplicating === item.id}
                      onDuplicate={() => duplicate(item)}
                      onDelete={() => { setDeleteError(false); setDeleteState('idle'); setPendingDelete(item); }}
                    />
                  );
                })}
              </ul>
              <p className="m-0 mt-4 font-display text-13 text-stone">
                {fillMessage(m.rtCountLimit, { count: formatNumber(total), max: formatNumber(MAX_ROUTINES) })}
              </p>
            </section>
          )}
        </>
      )}

      <DeleteRoutineDialog
        name={pendingDelete?.title ?? null}
        state={deleteState}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
      {toast}
    </PageContainer>
  );
}

export function MyRoutinesView() {
  return (
    <RoutineStage>
      <Mine />
    </RoutineStage>
  );
}
