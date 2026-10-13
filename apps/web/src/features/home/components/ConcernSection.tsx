'use client';

import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConcernGlyph } from '@/components/ui/concern-glyph';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { concernAtmosphere, concernGlyph } from '../lib/concerns';
import type { Concern } from '../lib/concerns';
import { useConcerns } from '../hooks/useConcerns';

/** Pressable → pill. 44px tall (the touch minimum); the glyph sits in its own small disc at the start. */
const chip =
  'inline-flex h-control-m items-center gap-2 rounded-pill border-[1.5px] ps-1.5 pe-4 text-label transition-[border-color,transform] duration-quick ease-out active:scale-[0.97] active:duration-instant';

function ConcernChip({ concern }: { concern: Concern }) {
  const m = useMessages();
  return (
    <Link
      href={routes.productsByConcern(concern.slug)}
      data-atmosphere={concernAtmosphere(concern)}
      aria-label={fillMessage(m.concernCardLabel, { name: concern.name })}
      className={cn(chip, 'border-transparent bg-atm-surface text-foreground hover:border-atm-ink')}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-card text-atm-ink">
        <ConcernGlyph name={concernGlyph(concern)} size={20} />
      </span>
      {concern.name}
    </Link>
  );
}

/**
 * Shop by concern: a compact set of colored chips (label + glyph, so color is never the only cue) that wraps
 * on every width — the whole set stays visible without a hidden scroll, in a fraction of the height cards
 * took.
 *
 * Loading, a failed request and an empty taxonomy are distinct: a failure says so and offers a retry; an empty
 * taxonomy omits the section (preview fixtures fill in only in design preview, labelled).
 * Labels are shopping aids, not diagnoses.
 */
export function ConcernSection() {
  const m = useMessages();
  const state = useConcerns();

  if (state.status === 'ready' && state.concerns.length === 0) return null;

  return (
    <section id="home-concerns-section" aria-labelledby="home-concerns" aria-busy={state.status === 'loading'} className="scroll-mt-24">
      {/* The way out for people whose concern is not listed: the header's "all products" link (as on the product shelf). */}
      <SectionHeader
        id="home-concerns"
        title={m.concernTitle}
        subtitle={m.concernSubtitle}
        href={routes.products}
        linkLabel={m.concernAllProducts}
        className="mb-3 lg:mb-4"
      />

      {state.status === 'loading' ? (
        <div role="status" aria-label={m.concernLoading} className="flex flex-wrap gap-2">
          {['w-28', 'w-24', 'w-32', 'w-44', 'w-36', 'w-32'].map((width, index) => (
            <Skeleton key={index} shape="pill" className={cn('h-control-m', width)} />
          ))}
        </div>
      ) : state.status === 'error' ? (
        <Alert variant="warning" className="items-center">
          <p className="flex-1 text-body-s text-foreground">{m.concernError}</p>
          <Button type="button" size="sm" variant="secondary" loading={state.retrying} onClick={state.retry}>
            {m.tryAgain}
          </Button>
        </Alert>
      ) : (
        <>
          {state.isPreview ? <Badge variant="guide" className="mb-3">{m.previewTag}</Badge> : null}
          <ul className="flex flex-wrap gap-2 lg:gap-3">
            {state.concerns.map((concern) => (
              <li key={concern.id}>
                <ConcernChip concern={concern} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
