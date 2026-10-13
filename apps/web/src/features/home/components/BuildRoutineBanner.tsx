import Image from 'next/image';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import { Icon } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { getDiscoveryContent } from '../lib/discovery';

/**
 * "Build your routine": the platform's differentiator, given its own composition — a three-step journey on a
 * bead rail (numbered beads joined by a line, the design system's routine signature), one strong primary action,
 * and a photograph in an arch. Copy and destination come from getDiscoveryContent (route /routine/builder).
 */
export function BuildRoutineBanner() {
  const m = getMessages(getLocale());
  const content = getDiscoveryContent(m);

  return (
    <section
      aria-labelledby="home-discovery"
      data-atmosphere="malachite"
      className="relative isolate overflow-hidden rounded-lg bg-gradient-to-br from-atm-wash to-atm-surface"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -start-16 -top-16 -z-10 size-72 rounded-pill bg-lilac/25 blur-3xl" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 end-1/4 -z-10 size-64 rounded-pill bg-peach/30 blur-3xl" />

      <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-12 lg:p-12">
        <div className="grid gap-5">
          <div className="grid gap-2">
            <h2 id="home-discovery" className="text-display-m text-foreground lg:text-display-l">
              {content.title}
            </h2>
            <p className="max-w-[34rem] text-body text-ink-soft lg:text-body-l">{content.description}</p>
          </div>

          <ol aria-label={content.stepsTitle} className="grid">
            {content.steps.map((step, index) => (
              <li key={step.title} className="relative flex gap-4 pb-5 last:pb-0">
                {index < content.steps.length - 1 ? (
                  <span aria-hidden="true" className="absolute bottom-0 start-[13px] top-bead w-0.5 bg-atm-accent/40" />
                ) : null}
                <span
                  aria-hidden="true"
                  className="relative grid size-bead shrink-0 place-items-center rounded-pill bg-primary text-caption tabular-nums text-primary-foreground"
                >
                  {index + 1}
                </span>
                <div className="grid gap-0.5 pt-0.5">
                  <p className="text-label text-foreground">
                    <span className="sr-only">{index + 1}. </span>
                    {step.title}
                  </p>
                  <p className="text-body-s text-ink-soft">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>

          <Link href={content.cta.href} className={buttonVariants({ size: 'lg' }) + ' w-full sm:w-fit'}>
            {content.cta.label}
            <Icon name="arrow-forward" size={20} />
          </Link>
        </div>

        <div className="relative aspect-[16/10] overflow-hidden shape-arch bg-atm-surface lg:aspect-[4/4.2] lg:shape-arch-l">
          <Image
            src="/assets/home/routine-builder.webp"
            alt=""
            fill
            sizes="(min-width: 1280px) 520px, (min-width: 1024px) 40vw, 100vw"
            // Subject on the end side, mirrored in RTL so she faces the copy.
            className="object-cover object-[78%_30%] rtl:-scale-x-100"
          />
        </div>
      </div>
    </section>
  );
}
