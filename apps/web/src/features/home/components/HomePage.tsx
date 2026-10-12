import { Suspense } from 'react';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { loadPublishedRoutines } from '../data/routines';
import { defaultRoutineArtwork, splitRoutines } from '../lib/routines';
import { CategorySection } from './CategorySection';
import { ConcernSection } from './ConcernSection';
import { DesktopFooter } from './DesktopFooter';
import { FeaturedProducts, FeaturedProductsSkeleton } from './FeaturedProducts';
import { FeaturedRoutineHero } from './FeaturedRoutineHero';
import type { HeroSlide } from './FeaturedRoutineHero';
import { HomeHeader } from './HomeHeader';
import { MobileBottomNavigation } from './MobileBottomNavigation';
import { RecommendedRoutines } from './RecommendedRoutines';
import { RoutineDiscoveryCTA } from './RoutineDiscoveryCTA';

/**
 * Home, in the approved order: header + search, featured routines, concerns, products,
 * suggested routines, categories, routine discovery, then footer / bottom navigation.
 */
export async function HomePage() {
  const m = getMessages(getLocale());
  const { hero, recommended } = splitRoutines(await loadPublishedRoutines());

  // Real routines when published; otherwise one honest slide that leads into the catalog.
  const slides: HeroSlide[] =
    hero.length > 0
      ? hero.map((routine) => ({
          id: routine.id,
          badge: m.heroRoutineBadge,
          title: routine.title,
          description: routine.description,
          ctaLabel: m.heroRoutineCta,
          href: routine.href,
          imageSrc: routine.imageSrc ?? defaultRoutineArtwork(routine.careArea),
        }))
      : [
          {
            id: 'catalog',
            badge: null,
            title: m.heroFallbackTitle,
            description: m.heroFallbackDescription,
            ctaLabel: m.heroFallbackCta,
            href: routes.products,
            imageSrc: defaultRoutineArtwork('skin'),
          },
        ];

  return (
    <>
      <HomeHeader />
      {/* Bottom padding keeps the last section clear of the fixed phone navigation. */}
      <div className="pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
        <h1 className="sr-only">{m.homeMetaTitle}</h1>
        <div className="mx-auto max-w-7xl space-y-9 px-4 pt-2 sm:px-6 lg:space-y-14 lg:px-8 lg:pt-6">
          <FeaturedRoutineHero slides={slides} />
          <ConcernSection />
          <Suspense fallback={<FeaturedProductsSkeleton />}>
            <FeaturedProducts />
          </Suspense>
          <RecommendedRoutines routines={recommended} />
          <CategorySection />
          <RoutineDiscoveryCTA />
        </div>
        <DesktopFooter />
      </div>
      <MobileBottomNavigation />
    </>
  );
}
