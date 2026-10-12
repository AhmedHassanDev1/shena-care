import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, Layers, ListChecks, PackageCheck, Sparkles, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';
import { getDiscoveryContent } from '../lib/discovery';
import type { DiscoveryIcon } from '../lib/discovery';

const ICONS: Record<DiscoveryIcon, LucideIcon> = {
  products: PackageCheck,
  steps: ListChecks,
  sparkles: Sparkles,
  target: Target,
  checklist: ListChecks,
  layers: Layers,
};

/** Rotating tints keep the three icon tiles distinct without a color per meaning. */
const TINTS = ['bg-primary-subtle text-primary', 'bg-secondary text-secondary-foreground', 'bg-accent text-accent-foreground'];

/**
 * One coherent discovery zone: the "build your routine" banner with the three-step explanation
 * attached beneath it. The design is always shown; the question cards illustrate the journey and are not
 * real questions (see docs/home-api-integration-gaps.md).
 */
export function RoutineDiscoveryZone() {
  const m = getMessages(getLocale());
  const content = getDiscoveryContent(m);

  return (
    <section aria-labelledby="home-discovery" className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Copy first on every screen; on desktop the artwork takes the opposite (left) side. */}
      <div className="grid bg-secondary lg:min-h-[20rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col gap-3 p-5 sm:p-8 lg:justify-center lg:gap-4 lg:p-12">
          <h2 id="home-discovery" className="text-h2 text-foreground lg:text-display">
            {content.title}
          </h2>
          <p className="max-w-[34rem] text-body text-secondary-foreground">{content.description}</p>

          <Link href={content.cta.href} className={cn(buttonVariants({ size: 'lg' }), 'order-3 mt-1 w-full sm:w-fit lg:order-4 lg:mt-3')}>
            {content.cta.label}
            <ArrowLeft aria-hidden="true" className="ltr:rotate-180" />
          </Link>

          {/* After the CTA on phones, between copy and CTA on desktop. */}
          <ul className="order-4 mt-2 grid gap-2 sm:grid-cols-3 lg:order-3 lg:mt-1 lg:gap-3">
            {content.benefits.map((benefit, index) => {
              const Icon = ICONS[benefit.icon];
              return (
                <li key={benefit.label} className="flex items-center gap-2.5 text-support text-foreground sm:flex-col sm:items-start">
                  <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md', TINTS[index % TINTS.length])}>
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  {benefit.label}
                </li>
              );
            })}
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
                    'relative flex w-[8.75rem] shrink-0 flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-overlay',
                    index === 0 && 'z-30 -rotate-3',
                    index === 1 && 'hidden -ms-2 z-20 mt-6 rotate-1 xl:flex',
                    index === 2 && 'hidden -ms-2 z-10 -rotate-2 xl:flex',
                  )}
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary-subtle text-caption font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="text-caption font-semibold text-foreground">{question.title}</span>
                  <span className="flex flex-col gap-1">
                    {question.options.map((option, optionIndex) => (
                      <span
                        key={option}
                        className={cn(
                          'rounded-sm border px-2 py-1 text-caption',
                          optionIndex === 1 ? 'border-primary bg-primary-subtle text-primary' : 'border-border text-muted-foreground',
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
        <h3 className="text-body font-semibold text-foreground">{content.stepsTitle}</h3>
        <ol className="mt-3 grid gap-3 lg:grid-cols-3 lg:gap-6">
          {content.steps.map((step, index) => {
            const Icon = ICONS[step.icon];
            return (
              <li key={step.title} className="flex items-center gap-3">
                <span className={cn('relative flex size-11 shrink-0 items-center justify-center rounded-md', TINTS[index % TINTS.length])}>
                  <Icon aria-hidden="true" className="size-5" />
                  <span className="absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-card text-[0.6875rem] font-semibold text-foreground shadow-raised tabular-nums">
                    {index + 1}
                  </span>
                </span>
                <div>
                  <p className="text-support font-semibold text-foreground">{step.title}</p>
                  <p className="text-caption text-muted-foreground">{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
