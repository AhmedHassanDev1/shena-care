'use client';

import { Button } from '@/components/ui/button';
import { useMessages } from '@/lib/i18n/LocaleProvider';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const m = useMessages();

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6 py-16" role="alert">
      <h2 className="text-display-3 font-display font-bold text-ink">{m.unexpectedError}</h2>
      <p className="mt-3 text-body font-display text-stone">{m.unexpectedErrorDescription}</p>
      {error.digest ? (
        <small className="mt-3 text-13 font-display text-stone">
          {m.errorId}: <bdi dir="ltr">{error.digest}</bdi>
        </small>
      ) : null}
      <Button type="button" onClick={reset} className="mt-6 self-start">
        {m.tryAgain}
      </Button>
    </section>
  );
}
