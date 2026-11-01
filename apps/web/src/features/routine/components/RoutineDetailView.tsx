'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { useCart } from '@/features/cart/hooks/useCart';
import { formatEgp, formatNumber, formatPackSize } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { getCuratedRoutineBySlug, type CuratedRoutineStep } from '../data/curatedRoutines';
import { useRoutineProducts, type RoutineStepProduct } from '../hooks/useRoutineProducts';

type AddState = 'idle' | 'pending' | 'done' | 'error';

/**
 * One routine, step by step. Product names, photos, prices, availability and usage text come from the catalog; the
 * routine file only fixes the order and each step's role. Nothing is added to the cart without the customer pressing
 * a button, and «add all» adds exactly the products the catalog says can be ordered now.
 */
export function RoutineDetailView({ slug }: { slug: string }) {
  const m = useMessages();
  const locale = useLocale();
  const { addItem } = useCart();
  const routine = getCuratedRoutineBySlug(slug);
  const routines = useMemo(() => (routine ? [routine] : []), [routine]);
  const resolved = useRoutineProducts(routines).get(slug);
  const [all, setAll] = useState<AddState>('idle');
  const [one, setOne] = useState<Record<string, AddState>>({});

  if (!routine) {
    return (
      <PageContainer className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="m-0 font-display text-28 font-extrabold text-ink">{m.routineNotFoundTitle}</h1>
        <p className="m-0 max-w-md text-15 text-stone">{m.routineNotFoundBody}</p>
        <Link href={routes.routines} className={buttonVariants({ variant: 'ink', size: 'm' })}>
          {m.homeRoutinesAll}
        </Link>
      </PageContainer>
    );
  }

  const steps = resolved?.steps ?? [];
  const title = locale === 'ar' ? routine.titleAr : routine.titleEn;
  const orderable = steps.filter((s) => s.orderable && s.skuId);
  const total = resolved?.total ?? null;
  const someUnavailable = Boolean(resolved?.settled) && steps.some((s) => s.state === 'ready' && !s.orderable);

  const addOne = async (stepId: string, skuId: string) => {
    setOne((prev) => ({ ...prev, [stepId]: 'pending' }));
    try {
      await addItem({ skuId, quantity: 1 });
      setOne((prev) => ({ ...prev, [stepId]: 'done' }));
    } catch {
      setOne((prev) => ({ ...prev, [stepId]: 'error' }));
    }
  };

  const addAll = async () => {
    if (all === 'pending') return;
    setAll('pending');
    try {
      for (const step of orderable) await addItem({ skuId: step.skuId as string, quantity: 1 });
      setAll('done');
    } catch {
      setAll('error');
    }
  };

  return (
    <PageContainer className="flex flex-col gap-8 pb-16 pt-4 lg:gap-10 lg:pt-8">
      <nav aria-label={m.plpBreadcrumb}>
        <Link href={routes.routines} className="inline-flex min-h-10 items-center gap-1.5 text-14 font-semibold text-stone no-underline hover:text-ink">
          <Icon name="arrow-forward" size={16} className="rotate-180 rtl:rotate-0" />
          {m.homeRoutinesAll}
        </Link>
      </nav>

      <header className="flex flex-col gap-3 lg:max-w-narrow">
        <p className="m-0 text-14 font-semibold text-stone">
          {routine.category === 'skin' ? m.navSkin : m.navHair} · {fillMessage(m.routineStepsCount, { n: formatNumber(routine.steps.length, locale) })}
        </p>
        <h1 className="m-0 text-balance font-display text-34 font-extrabold leading-tight text-ink lg:text-52">{title}</h1>
        {locale === 'ar' ? <p className="m-0 max-w-xl text-16 leading-28 text-stone lg:text-18 lg:leading-32">{routine.taglineAr}</p> : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-12">
        <aside aria-label={m.routineTotalLabel} className="order-first flex flex-col gap-4 rounded-card bg-linen p-5 shadow-outline-hairline lg:sticky lg:top-6 lg:order-last lg:p-6">
          <div className="flex flex-col">
            <span className="text-13 text-stone">{m.routineTotalLabel}</span>
            {total !== null ? (
              <span className="font-display text-34 font-extrabold tabular-nums text-ink">
                <bdi>{formatEgp(total, 'EGP', locale)}</bdi>
              </span>
            ) : resolved?.settled ? (
              <span className="text-20 text-stone">—</span>
            ) : (
              <Skeleton className="mt-1.5 h-9 w-32 rounded-4" />
            )}
          </div>
          {someUnavailable ? <p className="m-0 text-13 leading-20 text-stone">{m.routineUnavailableNote}</p> : null}
          <Button variant="ink" size="l" disabled={orderable.length === 0 || all === 'pending'} onClick={addAll} className="w-full">
            {all === 'pending' ? m.cardAdding : all === 'done' ? m.routineAddedAll : m.routineAddAll}
          </Button>
          {all === 'error' ? (
            <p role="alert" className="m-0 text-13 font-semibold text-tomato-ink">
              {m.routineAddFailed}
            </p>
          ) : null}
          {all === 'done' ? (
            <Link href={routes.cart} className="link-quiet self-start text-14 font-semibold text-ink">
              {m.cartTitle}
            </Link>
          ) : null}
          <Link href={`${routes.routineBuilder}?template=${routine.slug}`} className="link-quiet self-start text-14 font-semibold text-ink">
            {m.homeRoutineCustomize}
          </Link>
        </aside>

        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          {routine.steps.map((step, index) => (
            <StepRow key={step.id} step={step} index={index} entry={steps[index]} state={one[step.id] ?? 'idle'} onAdd={addOne} />
          ))}
        </ol>
      </div>
    </PageContainer>
  );
}

function StepRow({
  step,
  index,
  entry,
  state,
  onAdd,
}: {
  step: CuratedRoutineStep;
  index: number;
  entry: RoutineStepProduct | undefined;
  state: AddState;
  onAdd: (stepId: string, skuId: string) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const product = entry?.product ?? null;
  const variant = product?.selectedVariant ?? null;
  const usage = (variant?.content?.usage ?? product?.usage)?.trim() || null;
  const size = variant ? formatPackSize(variant.size, variant.sizeUnit, locale) : null;
  const role = locale === 'ar' ? step.roleAr : step.roleEn;

  return (
    <li className="flex gap-4 rounded-card bg-linen p-4 shadow-outline-hairline sm:p-5">
      <div className="w-24 flex-none sm:w-32">
        {!entry || entry.state === 'loading' ? (
          <Skeleton className="aspect-square w-full rounded-image" />
        ) : (
          <Link href={routes.product(step.productSlug)} tabIndex={-1} aria-hidden="true" className="block">
            <ProductTile
              src={entry.imageUrl}
              alt={entry.imageAlt}
              name={product?.name ?? step.productName}
              sizes="128px"
              className={cn('aspect-square w-full', !entry.orderable && '[&_img]:opacity-45 [&_img]:grayscale')}
            />
          </Link>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="m-0 flex items-center gap-2 text-13 font-semibold text-stone">
          <span className="flex size-6 flex-none items-center justify-center rounded-full bg-sand font-display text-12 font-bold tabular-nums text-ink">
            {formatNumber(index + 1, locale)}
          </span>
          {role}
        </p>

        {entry?.state === 'error' ? (
          <p role="alert" className="m-0 flex flex-wrap items-center gap-x-3 text-14 text-tomato-ink">
            {m.routineProductError}
            <Button variant="text" size="s" onClick={entry.retry} className="text-14 font-semibold">
              {m.tryAgain}
            </Button>
          </p>
        ) : product ? (
          <>
            <div className="flex flex-col">
              <span className="truncate font-serif text-15 italic leading-20 text-stone">
                <bdi>{product.brand.name}</bdi>
              </span>
              <Link href={routes.product(step.productSlug)} dir="auto" className="text-match-parent font-display text-17 font-bold leading-24 text-ink no-underline hover:text-cobalt">
                {product.name}
              </Link>
              {size ? <span className="text-13 text-stone">{size}</span> : null}
            </div>
            {usage ? (
              <p dir="auto" className="text-match-parent m-0 line-clamp-3 text-14 leading-22 text-stone">
                <span className="font-semibold text-ink">{m.pdpUsage}: </span>
                {usage}
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <span className="font-display text-18 font-extrabold tabular-nums text-ink">
                {entry?.price !== null && entry?.price !== undefined ? <bdi>{formatEgp(entry.price, 'EGP', locale)}</bdi> : null}
              </span>
              <div className="flex items-center gap-2">
                <Link href={routes.product(step.productSlug)} className={cn(buttonVariants({ variant: 'ghost', size: 's' }), 'text-14')}>
                  {m.routineViewProduct}
                </Link>
                {entry?.orderable && entry.skuId ? (
                  <Button
                    variant="ink"
                    size="s"
                    disabled={state === 'pending' || state === 'done'}
                    onClick={() => onAdd(step.id, entry.skuId as string)}
                    className="text-14"
                  >
                    {state === 'pending' ? m.cardAdding : state === 'done' ? m.routineAdded : state === 'error' ? m.cardRetry : m.cardAdd}
                  </Button>
                ) : (
                  <span className="text-14 font-semibold text-stone">{m.cardUnavailable}</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20 rounded-4" />
            <Skeleton className="h-5 w-4/5 rounded-4" />
            <Skeleton className="h-4 w-1/3 rounded-4" />
          </div>
        )}
      </div>
    </li>
  );
}
