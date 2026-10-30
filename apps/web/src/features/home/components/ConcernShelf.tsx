'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Section, SectionHeader } from '@/components/layout/section';
import { cardVariants } from '@/components/ui/card-variants';
import { ChipLink } from '@/components/ui/chip-link';
import { Icon } from '@/components/ui/icon';
import { apiClient } from '@/lib/api-client';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { Concern } from '@/features/catalog/api/discovery';
import { CONCERN_CHIPS, concernHref } from '../lib/concern-chips';
import { sectionNumber } from '../lib/section-number';

/**
 * Shop by concern (Stitch section 01): 2x2 Clinically Categorized Solutions grid,
 * followed by customer concern chips, and elevated Shina consultation banner.
 */
export function ConcernShelf() {
  const m = useMessages();
  const locale = useLocale();
  const { data } = useQuery({
    queryKey: ['care', 'concerns', 'public'],
    queryFn: () => apiClient.get<Concern[]>('/care/concerns'),
    staleTime: 5 * 60 * 1000,
  });
  const concerns = data ?? [];

  const solutions = [
    {
      title: m.homeSolutionBarrierTitle,
      subtitle: m.homeSolutionBarrierSubtitle,
      icon: 'shield' as const,
      href: `${routes.products}?q=سيراميد`,
      tint: 'bg-bottle-tint text-bottle',
    },
    {
      title: m.homeSolutionRadianceTitle,
      subtitle: m.homeSolutionRadianceSubtitle,
      icon: 'sparkles' as const,
      href: `${routes.products}?q=فيتامين+سي`,
      tint: 'bg-saffron-tint text-saffron-ink',
    },
    {
      title: m.homeSolutionSunTitle,
      subtitle: m.homeSolutionSunSubtitle,
      icon: 'sun' as const,
      href: `${routes.products}?category=sun-protection`,
      tint: 'bg-sand text-night',
    },
    {
      title: m.homeSolutionHairTitle,
      subtitle: m.homeSolutionHairSubtitle,
      icon: 'science' as const,
      href: `${routes.products}?category=hair-care`,
      tint: 'bg-bone text-night',
    },
  ];

  return (
    <Section labelledBy="home-concern-title" className="gap-5 lg:gap-6">
      <div className="flex flex-col gap-2">
        <span className="w-fit rounded-full bg-bottle-tint px-3 py-1 text-12 font-bold text-bottle">
          {m.homeConcernSolutionsBadge}
        </span>
        <SectionHeader number={sectionNumber(1, locale)} title={m.homeConcernTitle} titleId="home-concern-title" lead={m.homeConcernBody} />
      </div>

      {/* 2x2 Clinically Categorized Solutions Grid from Stitch Screen 1 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4">
        {solutions.map((sol) => (
          <Link
            key={sol.title}
            href={sol.href}
            className={cn(
              cardVariants({ interactive: true }),
              'group flex items-center justify-between gap-3 p-4 transition-all duration-fast'
            )}
          >
            <div className="flex min-w-0 items-center gap-3.5">
              <span className={cn('flex size-11 flex-none items-center justify-center rounded-card', sol.tint)}>
                <Icon name={sol.icon} size={22} />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-15 font-bold leading-22 text-night group-hover:text-bottle transition-colors">
                  {sol.title}
                </span>
                <span className="text-12 leading-18 text-ink-2">
                  {sol.subtitle}
                </span>
              </div>
            </div>
            <span className="flex size-8 flex-none items-center justify-center rounded-full bg-bone text-ink-3 transition-colors duration-fast group-hover:bg-bottle group-hover:text-linen">
              <Icon name="arrow-forward" size={16} />
            </span>
          </Link>
        ))}
      </div>

      {/* Quick Concern Chips */}
      <nav aria-label={m.homeConcernNavLabel}>
        <ul className="scrollbar-none -mx-4 m-0 flex list-none snap-x gap-2.5 overflow-x-auto scroll-px-4 px-4 py-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
          {CONCERN_CHIPS.map((chip) => {
            const label = m[chip.label];
            return (
              <li key={chip.id} className="flex-none snap-start">
                <ChipLink href={concernHref(chip, label, concerns).href} icon={chip.icon}>
                  {label}
                </ChipLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Shina AI Advisor Card from Stitch Screen 1 */}
      <Link
        href={shellRoutes.shina}
        className={cn(
          cardVariants({ interactive: true }),
          'group flex flex-col justify-between gap-3 rounded-card bg-sand/60 p-4 shadow-outline-hairline sm:flex-row sm:items-center lg:p-5'
        )}
      >
        <span className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-11 flex-none items-center justify-center rounded-card bg-saffron-tint text-saffron-ink shadow-elevation-1">
            <Icon name="sparkles" size={22} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-16 font-bold leading-24 text-night group-hover:text-bottle transition-colors">
              {m.homeAdvisorPrompt}
            </span>
            <span className="text-13 leading-20 text-ink-2">{m.homeAdvisorPromptLead}</span>
          </span>
        </span>
        <span className="inline-flex min-h-control-s items-center justify-center gap-2 self-start rounded-full bg-night px-4 py-2 text-13 font-bold text-linen shadow-elevation-1 transition-all duration-fast group-hover:bg-bottle sm:self-center">
          <span>{m.homeAdvisorPromptCta}</span>
          <Icon name="arrow-forward" size={16} />
        </span>
      </Link>
    </Section>
  );
}
