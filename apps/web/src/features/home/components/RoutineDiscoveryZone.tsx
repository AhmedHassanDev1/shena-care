import Image from 'next/image';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import { Icon } from '@/components/ui/icon';
import type { IconName } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';
import { getDiscoveryContent } from '../lib/discovery';
import type { DiscoveryIcon } from '../lib/discovery';

/** Discovery copy keys → the design system's one icon set. */
const ICONS: Record<DiscoveryIcon, IconName> = {
  products: 'box',
  steps: 'routine',
  sparkles: 'star',
  target: 'check-circle',
  checklist: 'check-circle',
  layers: 'compare',
};

/**
 * One coherent discovery zone: the "build your routine" banner with the three-step explanation
 * attached beneath it. The design is always shown; the question cards illustrate the journey and are not
 * real questions (see docs/home-api-integration-gaps.md).
 */
export function RoutineDiscoveryZone() {
  const m = getMessages(getLocale());
  const content = getDiscoveryContent(m);

  return (
    <section aria-labelledby="home-discovery" className="overflow-hidden rounded-md border border-border bg-card">
      {/* Copy first on every screen; on desktop the artwork takes the opposite (left) side. */}
      <div className="grid bg-sand lg:min-h-[20rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col gap-3 p-5 sm:p-8 lg:justify-center lg:gap-4 lg:p-12">
          <h2 id="home-discovery" className="text-display-m text-foreground lg:text-display-l">
            {content.title}
          </h2>
          <p className="max-w-[34rem] text-body text-ink-soft">{content.description}</p>

          <Link href={content.cta.href} className={cn(buttonVariants({ size: 'lg' }), 'order-3 mt-1 w-full sm:w-fit lg:order-4 lg:mt-3')}>
            {content.cta.label}
            <Icon name="arrow-forward" size={20} />
          </Link>

          {/* After the CTA on phones, between copy and CTA on desktop. */}
          <ul className="order-4 mt-2 grid gap-2 sm:grid-cols-3 lg:order-3 lg:mt-1 lg:gap-3">
            {content.benefits.map((benefit) => (
              <li key={benefit.label} className="flex items-center gap-3 text-body-s text-foreground sm:flex-col sm:items-start">
                <span className="grid size-10 shrink-0 place-items-center rounded-pill bg-card text-foreground">
                  <Icon name={ICONS[benefit.icon]} size={20} />
                </span>
                {benefit.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative h-64 lg:h-auto">
          <Image
            src="/assets/home/routine-builder.webp"
            alt=""
            fill
            sizes="(min-width: 1280px) 640px, (min-width: 1024px) 50vw, 100vw"
            // Subject stays on the reading-end side of the frame; mirrored in RTL so it faces the copy.
            className="object-cover object-right rtl:-scale-x-100"
          />
          {content.questions.length > 0 ? (
            // One readable card below xl, the full overlapping stack from xl up.
            <ol aria-hidden="true" className="absolute inset-y-4 start-4 flex items-center xl:inset-y-6 xl:start-6">
              {content.questions.map((question, index) => (
                <li
                  key={question.title}
                  className={cn(
                    'relative flex w-[8.75rem] shrink-0 flex-col gap-2 rounded-sm border border-border bg-card p-3 shadow-float',
                    index === 0 && 'z-30 -rotate-3',
                    index === 1 && 'hidden -ms-2 z-20 mt-6 rotate-1 xl:flex',
                    index === 2 && 'hidden -ms-2 z-10 -rotate-2 xl:flex',
                  )}
                >
                  <span className="grid size-6 place-items-center rounded-pill bg-primary-subtle text-caption text-primary">
                    {index + 1}
                  </span>
                  <span className="text-caption font-semibold text-foreground">{question.title}</span>
                  <span className="flex flex-col gap-1">
                    {question.options.map((option, optionIndex) => (
                      <span
                        key={option}
                        className={cn(
                          'rounded-pill border px-2 py-1 text-caption',
                          optionIndex === 1 ? 'border-primary bg-primary-subtle text-guide' : 'border-input text-ink-soft',
                        )}
                      >
                        {option}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>

      <div className="p-5 sm:px-8 lg:px-12 lg:py-6">
        <h3 className="text-heading text-foreground">{content.stepsTitle}</h3>
        <ol className="mt-3 grid gap-3 lg:grid-cols-3 lg:gap-6">
          {content.steps.map((step, index) => (
            <li key={step.title} className="flex items-center gap-3">
              {/* A numbered bead on the rail: the design system's sequence marker. */}
              <span className="relative grid size-control-m shrink-0 place-items-center rounded-pill bg-sand text-foreground">
                <Icon name={ICONS[step.icon]} size={20} />
                <span className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-pill bg-primary text-caption tabular-nums text-primary-foreground">
                  {index + 1}
                </span>
              </span>
              <div>
                <p className="text-label text-foreground">{step.title}</p>
                <p className="text-body-s text-ink-soft">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
