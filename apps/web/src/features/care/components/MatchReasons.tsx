'use client';

import { useMessages } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';
import type { Basis, RecommendedItem } from '../api/care-intelligence';
import { leadReasons } from '../lib/recommendation-card';

const BASIS_DOT: Record<Basis, string> = { VERIFIED: 'bg-ok', EVIDENCE: 'bg-cobalt', RULE: 'bg-stone' };

/**
 * «Why it fits», shared by the Corner and the consultation: the strongest reasons a product was recommended, each
 * marked with what it rests on (manufacturer fact, published guidance, store rule), then what is not verified.
 * Text comes from the recommendation engine verbatim; nothing is reworded here.
 */
export function MatchReasons({ item, max = 2, why, className }: { item: RecommendedItem; max?: number; why?: string; className?: string }) {
  const m = useMessages();
  const basisLabel: Record<Basis, string> = { VERIFIED: m.concernBasisVerified, EVIDENCE: m.concernBasisEvidence, RULE: m.concernBasisRule };
  const reasons = leadReasons(item, max);
  const caution = item.cautions[0];
  const unknown = item.unknowns[0];
  if (!why && !reasons.length && !caution && !unknown) return null;

  return (
    <div className={cn('flex flex-col gap-1.5 text-12.5 leading-relaxed text-stone', className)}>
      <span className="font-display text-12 font-semibold text-ink">{m.shinaWhyFits}</span>
      {why ? <p className="m-0 text-ink">{why}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {reasons.map((reason) => (
          <li key={`${reason.code}-${reason.text.slice(0, 24)}`} className="flex items-start gap-2">
            <span aria-hidden="true" className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', BASIS_DOT[reason.basis])} />
            <span>
              <span className="sr-only">{basisLabel[reason.basis]}: </span>
              {reason.text}
              {reason.source ? (
                <span className="text-stone">
                  {' '}
                  ({reason.source.url ? (
                    <a href={reason.source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:text-cobalt">
                      <bdi>{reason.source.title}</bdi>
                    </a>
                  ) : (
                    <bdi>{reason.source.title}</bdi>
                  )})
                </span>
              ) : null}
            </span>
          </li>
        ))}
        {caution ? (
          <li className="flex items-start gap-2 text-ink">
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
            <span>{caution.text}</span>
          </li>
        ) : null}
        {unknown ? (
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line" />
            <span>
              <span className="font-semibold">{m.concernUnknown}: </span>
              {unknown.text}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** Legend for the dots, shown once above a list of recommendations. */
export function BasisLegend({ className }: { className?: string }) {
  const m = useMessages();
  const entries: Array<[Basis, string]> = [['VERIFIED', m.concernBasisVerified], ['EVIDENCE', m.concernBasisEvidence], ['RULE', m.concernBasisRule]];
  return (
    <ul className={cn('m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-12 text-stone', className)}>
      {entries.map(([basis, label]) => (
        <li key={basis} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-1.5 rounded-full', BASIS_DOT[basis])} />
          {label}
        </li>
      ))}
    </ul>
  );
}
