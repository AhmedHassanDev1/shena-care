import { Suspense } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { GuideEntry } from '@/components/ui/guide-entry';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { loadPublishedRoutines } from '../data/routines';
import { selectSuggestedRoutines } from '../lib/routines';
import { CategorySection } from './CategorySection';
import { ConcernSection } from './ConcernSection';
import { DesktopFooter } from './DesktopFooter';
import { FeaturedProducts, FeaturedProductsSkeleton } from './FeaturedProducts';
import { HeroCarousel } from './HeroCarousel';
import { HomeHeader } from './HomeHeader';
import { MobileBottomNavigation } from './MobileBottomNavigation';
import { RecommendedRoutines } from './RecommendedRoutines';
import { BuildRoutineBanner } from './BuildRoutineBanner';

/**
 * Home, in the approved order: header + search, featured routines, concerns, products,
 * suggested routines, categories, routine discovery zone (banner + three steps), then footer / bottom navigation.
 */
export async function HomePage({ preview = false }: { preview?: boolean }) {
  const m = getMessages(getLocale());
  const suggested = selectSuggestedRoutines(await loadPublishedRoutines());

  return (
    <>
      <HomeHeader />
      {/* Bottom padding keeps the last section clear of the fixed phone navigation. */}
      <div className="pb-nav-safe">
        <h1 className="sr-only">{m.homeMetaTitle}</h1>
        {/* Section rhythm from the layout tokens: space-6 on phones, space-8 on tablet, space-10 from desktop. */}
        <PageContainer className="space-y-6 pt-2 sm:space-y-8 lg:space-y-10 lg:pt-6">
          <GuideEntry href={routes.routineBuilder} label={m.guideEntryLabel} hint={m.guideEntryHint} />
          <HeroCarousel />
          <ConcernSection />
          <Suspense fallback={<FeaturedProductsSkeleton />}>
            <FeaturedProducts preview={preview} />
          </Suspense>
          <RecommendedRoutines routines={suggested} />
          <CategorySection />
          <BuildRoutineBanner />
        </PageContainer>
        <DesktopFooter />
      </div>
      <MobileBottomNavigation />
    </>
  );
}
