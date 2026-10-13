import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';
import { getDiscoveryContent } from '../lib/discovery';

/** Desktop artwork: an arch window with a rising disc, and the routine's bead rail running out of it. */
function KohlArch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden="true" className={cn('rtl:-scale-x-100', className)}>
      <path d="M60 240V120a60 60 0 0 1 120 0v120" fill="none" strokeWidth="1.5" className="stroke-malachite-on-kohl/40" />
      <path d="M86 240V128a34 34 0 0 1 68 0v112z" className="fill-kohl-raised" />
      <circle cx="120" cy="150" r="20" className="fill-saffron/80" />
      <path d="M0 214h240" strokeWidth="1.5" className="stroke-on-kohl-soft/25" />
      <circle cx="34" cy="214" r="6" className="fill-malachite-on-kohl" />
      <circle cx="206" cy="214" r="5" strokeWidth="2" className="fill-kohl stroke-malachite-on-kohl" />
    </svg>
  );
}

/**
 * "Build your routine": the platform's differentiator and Home's one evening (kohl) surface — a deliberate
 * change of rhythm after the light, photographic sections. The imagery is the brand's own: an arch window with
 * the routine's bead rail running out of it. Then a short promise, three numbered steps on a bead rail, and one
 * action in malachite-on-kohl (the action color for dark grounds). Copy and destination come from
 * getDiscoveryContent (route /routine/builder).
 */
export function BuildRoutineBanner() {
  const m = getMessages(getLocale());
  const content = getDiscoveryContent(m);

  return (
    <section aria-labelledby="home-discovery" className="on-kohl relative isolate overflow-hidden rounded-lg bg-kohl">
      {/* Phones and tablets: only a faint arch outline in the corner, clear of the copy. */}
      <svg viewBox="0 0 160 160" aria-hidden="true" className="pointer-events-none absolute -end-12 -top-12 -z-10 size-44 rtl:-scale-x-100 lg:hidden">
        <path d="M30 160V80a50 50 0 0 1 100 0v80" fill="none" strokeWidth="1.5" className="stroke-malachite-on-kohl/30" />
      </svg>

      <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_14rem] lg:items-center lg:gap-10 lg:p-12">
        <div className="grid gap-3 lg:gap-4">
          <p className="text-label text-malachite-on-kohl">{content.stepsTitle}</p>
          <h2 id="home-discovery" className="text-display-m text-on-kohl lg:text-display-l">
            {content.title}
          </h2>
          <p className="max-w-[30rem] text-body text-on-kohl-soft">{content.description}</p>
          <Link
            href={content.cta.href}
            className="mt-2 inline-flex h-control-l w-fit items-center gap-2 rounded-pill bg-malachite-on-kohl px-6 text-label text-kohl transition-[background-color,transform] duration-quick ease-out hover:bg-on-kohl active:scale-[0.98]"
          >
            {content.cta.label}
            <Icon name="arrow-forward" size={20} />
          </Link>
        </div>

        <ol aria-label={content.stepsTitle} className="grid">
          {content.steps.map((step, index) => (
            <li key={step.title} className="relative flex gap-3 pb-4 last:pb-0">
              {index < content.steps.length - 1 ? (
                <span aria-hidden="true" className="absolute bottom-0 start-[13px] top-bead w-0.5 bg-malachite-on-kohl/35" />
              ) : null}
              <span
                aria-hidden="true"
                className="relative grid size-bead shrink-0 place-items-center rounded-pill border-2 border-malachite-on-kohl text-caption tabular-nums text-on-kohl"
              >
                {index + 1}
              </span>
              <div className="grid gap-0.5 pt-0.5">
                <p className="text-label text-on-kohl">
                  <span className="sr-only">{index + 1}. </span>
                  {step.title}
                </p>
                <p className="text-body-s text-on-kohl-soft">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>

        <KohlArch className="hidden w-full self-end lg:block" />
      </div>
    </section>
  );
}
