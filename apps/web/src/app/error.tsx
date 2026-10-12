'use client';

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
      <h2 className="text-h2 font-semibold text-foreground">{m.unexpectedError}</h2>
      <p className="mt-3 text-body text-muted-foreground">{m.unexpectedErrorDescription}</p>
      {error.digest ? (
        <small className="mt-3 text-caption text-muted-foreground">
          {m.errorId}: <bdi dir="ltr">{error.digest}</bdi>
        </small>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-6 min-h-11 self-start rounded-md bg-primary px-5 py-2 text-support font-semibold text-primary-foreground"
      >
        {m.tryAgain}
      </button>
    </section>
  );
}
