import { BrandLoader } from '@/components/ui/brand-loader';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

/** App-wide route loading: the brand loader, not a page skeleton (pages and lists keep their own skeletons). */
export default function GlobalLoading() {
  const m = getMessages(getLocale());

  return (
    <div className="grid min-h-[70vh] place-items-center bg-chalk px-4">
      <BrandLoader label={m.loading} />
    </div>
  );
}
