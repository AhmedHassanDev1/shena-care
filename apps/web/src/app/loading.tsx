import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export default function GlobalLoading() {
  const m = getMessages(getLocale());
  return (
    <div className="state-panel" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{m.loading}</p>
    </div>
  );
}
