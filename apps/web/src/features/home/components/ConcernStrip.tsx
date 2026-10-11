import Link from 'next/link';
import type { Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { CONCERNS } from '../data/home-content';
import { SectionHeading } from './SectionHeading';

export function ConcernStrip({ m }: { m: Messages }) {
  return (
    <section id="concerns" aria-labelledby="concerns-title" className="scroll-mt-32 pt-12 md:pt-16">
      <SectionHeading id="concerns-title" title={m.concernsTitle} />
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 lg:gap-3">
        {CONCERNS.map(({ id, labelKey, icon: Icon }) => (
          <li key={id}>
            <Link
              href={`${routes.products}?concern=${encodeURIComponent(id)}`}
              className="flex h-full min-h-14 items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-support font-semibold text-foreground transition-colors duration-fast ease-standard hover:border-primary hover:bg-primary-subtle/40"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary-subtle text-primary">
                <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
              </span>
              {m[labelKey]}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
