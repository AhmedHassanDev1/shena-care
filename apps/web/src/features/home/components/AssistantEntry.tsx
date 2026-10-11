import Link from 'next/link';
import { MessageCircleQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';

/** The assistant is offered last and stated as optional: browsing and buying never depend on it. */
export function AssistantEntry({ m }: { m: Messages }) {
  return (
    <section aria-labelledby="assistant-title" className="py-12 md:py-16">
      <div className="flex flex-col gap-5 rounded-md bg-accent px-5 py-6 md:flex-row md:items-center md:justify-between md:px-8 md:py-7">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-card text-accent-foreground">
            <MessageCircleQuestion aria-hidden="true" className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 id="assistant-title" className="text-h3 font-semibold text-accent-foreground">
              {m.assistantBandTitle}
            </h2>
            <p className="mt-1 max-w-[40rem] text-support text-accent-foreground">{m.assistantBandBody}</p>
          </div>
        </div>
        <Button asChild variant="outline" className="shrink-0 self-start md:self-auto">
          <Link href={routes.routineBuilder}>{m.assistantCta}</Link>
        </Button>
      </div>
    </section>
  );
}
