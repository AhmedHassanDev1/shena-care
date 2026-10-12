import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export default function GlobalLoading() {
  const m = getMessages(getLocale());
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16" role="status" aria-live="polite">
      <p className="text-body text-muted-foreground">{m.loading}</p>
    </div>
  );
}
