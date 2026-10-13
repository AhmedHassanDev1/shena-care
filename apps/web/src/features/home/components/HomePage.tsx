import { Suspense } from 'react';
import { PageContainer } from '@/components/layout/page-container';
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
import { RoutineDiscoveryZone } from './RoutineDiscoveryZone';

/**
 * Home, in the approved order: header + search, featured routines, concerns, products,
 * suggested routines, categories, routine discovery zone (banner + three steps), then footer / bottom navigation.
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
      <div className="pb-nav-safe">
        <h1 className="sr-only">{m.homeMetaTitle}</h1>
        {/* Section rhythm from the layout tokens: space-6 on phones, space-8 on tablet, space-10 from desktop. */}
        <PageContainer className="space-y-6 pt-2 sm:space-y-8 lg:space-y-10 lg:pt-6">
          <FeaturedRoutineHero slides={slides} />
          <ConcernSection />
          <Suspense fallback={<FeaturedProductsSkeleton />}>
            <FeaturedProducts />
          </Suspense>
          <RecommendedRoutines routines={recommended} />
          <CategorySection />
          <RoutineDiscoveryZone />
        </PageContainer>
        <DesktopFooter />
      </div>
      <MobileBottomNavigation />
    </>
  );
}
