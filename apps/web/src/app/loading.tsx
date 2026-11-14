import { Section } from '@/components/layout/section';
import { Skeleton } from '@/components/ui/skeleton';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export default function GlobalLoading() {
  const m = getMessages(getLocale());

  return (
    <div role="status" aria-live="polite" aria-busy="true" className="min-h-[70vh] bg-chalk">
      <Section labelledBy="page-loading-status">
        <p id="page-loading-status" className="m-0 text-body text-stone">{m.loading}</p>
        <div aria-hidden="true" className="flex flex-col gap-6 lg:gap-10">
          <div className="grid gap-5 lg:grid-cols-2 lg:gap-10">
            <div className="flex flex-col justify-center gap-4">
              <Skeleton className="h-8 w-2/3 max-w-md" />
              <Skeleton className="h-8 w-1/2 max-w-sm" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-full max-w-md" />
                <Skeleton className="h-4 w-3/4 max-w-sm" />
              </div>
            </div>
            <Skeleton className="aspect-[4/3] w-full" />
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="hidden aspect-square w-full lg:block" />
            <Skeleton className="hidden aspect-square w-full lg:block" />
          </div>
        </div>
      </Section>
    </div>
  );
}
