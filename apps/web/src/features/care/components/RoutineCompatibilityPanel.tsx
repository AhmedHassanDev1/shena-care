'use client';

import { useEffect, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { MessageBox } from '@/components/ui/message-box';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { checkRoutine, type CompatibilityIssue, type CompatibilityResult, type Slot } from '../api/care-intelligence';

const TONE: Record<CompatibilityIssue['severity'], 'err' | 'warn' | 'info'> = { BLOCK: 'err', WARN: 'warn', INFO: 'info' };

/**
 * The shared compatibility check (POST /care/routines/check) for any routine a customer assembles: the same ingredient
 * rules the AI proposals and saved routines use. Re-runs whenever the steps change. Read-only: it reports, it never
 * removes or swaps a product.
 */
export function RoutineCompatibilityPanel({ steps, onResult }: {
  steps: Array<{ skuId: string; timing: Slot }>;
  /** Receives each check result (null while checking or on error), e.g. to hold a save while something blocks. */
  onResult?: (result: CompatibilityResult | null) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const titleId = useId();
  const key = steps.map((step) => `${step.skuId}:${step.timing}`).sort().join(',');
  const check = useQuery({
    queryKey: ['care', 'routine-check', key],
    queryFn: ({ signal }) => checkRoutine(steps, undefined, signal),
    enabled: steps.length > 0,
    staleTime: 60 * 1000,
  });
  useEffect(() => {
    onResult?.(check.data && !check.isFetching ? check.data : null);
  }, [check.data, check.isFetching, onResult]);
  if (!steps.length) return null;

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="m-0 font-display text-16 font-bold text-ink">{m.routineCheckTitle}</h3>
      {check.isPending ? (
        <p role="status" className="m-0 text-13 text-stone">{m.routineCheckPending}</p>
      ) : check.isError ? (
        <MessageBox tone="err" title={m.routineCheckError}>
          <Button variant="ghost" size="s" onClick={() => check.refetch()}>{m.tryAgain}</Button>
        </MessageBox>
      ) : check.data.issues.length === 0 ? (
        <MessageBox tone="ok">{m.routineCheckOk}</MessageBox>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {[...check.data.issues]
            .sort((a, b) => ['BLOCK', 'WARN', 'INFO'].indexOf(a.severity) - ['BLOCK', 'WARN', 'INFO'].indexOf(b.severity))
            .map((issue) => (
              <li key={`${issue.code}-${issue.skuIds.join('-')}`}>
                <MessageBox tone={TONE[issue.severity]}>
                  <p className="m-0">{locale === 'ar' ? issue.textAr : issue.textEn}</p>
                  {issue.source ? (
                    <p className="m-0 mt-1 text-12 text-stone">
                      {issue.source.url ? (
                        <a href={issue.source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2"><bdi>{issue.source.title}</bdi></a>
                      ) : <bdi>{issue.source.title}</bdi>}
                    </p>
                  ) : null}
                </MessageBox>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
