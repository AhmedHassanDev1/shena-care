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
    <div className="state-panel" role="alert">
      <h2>{m.unexpectedError}</h2>
      <p>{m.unexpectedErrorDescription}</p>
      {error.digest && <small>{m.errorId}: {error.digest}</small>}
      <button type="button" onClick={reset} className="cta-button">{m.tryAgain}</button>
    </div>
  );
}
