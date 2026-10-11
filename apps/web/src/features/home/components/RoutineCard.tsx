import Link from 'next/link';
import { ArrowRight, Route } from 'lucide-react';
import { SequenceTrack } from './SequenceTrack';

interface RoutineCardProps {
  title: string;
  askLabel: string;
  questions: string[];
  href: string;
  ctaLabel: string;
  formatIndex: (n: number) => string;
}

/**
 * A routine is a path, not a product: no photo and no price. The card shows the real sequence of builder
 * questions on the guidance track, so it reads differently from product cards at a glance.
 */
export function RoutineCard({ title, askLabel, questions, href, ctaLabel, formatIndex }: RoutineCardProps) {
  return (
    <article className="flex flex-col rounded-md border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4 md:px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground">
          <Route aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
        </span>
        <h3 className="text-h3 font-semibold text-foreground">{title}</h3>
      </div>
      <div className="flex flex-1 flex-col px-5 pb-5 pt-4 md:px-6 md:pb-6">
        <p className="text-caption font-semibold text-muted-foreground">{askLabel}</p>
        <SequenceTrack items={questions} formatIndex={formatIndex} className="mt-4" />
        <Link
          href={href}
          className="mt-6 inline-flex min-h-11 items-center gap-2 self-start rounded-md bg-primary-subtle px-4 text-support font-semibold text-primary transition-colors duration-fast ease-standard hover:bg-primary hover:text-primary-foreground"
        >
          {ctaLabel}
          <ArrowRight aria-hidden="true" className="rtl-mirror size-4" />
        </Link>
      </div>
    </article>
  );
}
