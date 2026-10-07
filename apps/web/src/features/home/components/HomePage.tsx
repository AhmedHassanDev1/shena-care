import { HomeHeader } from './HomeHeader';
import { HomeSearch } from './HomeSearch';
import { HeroCarousel } from './HeroCarousel';
import { ConcernStrip } from './ConcernStrip';
import { RoutineBuilderBanner } from './RoutineBuilderBanner';
import { RecommendedRoutines } from './RecommendedRoutines';
import { PopularSolutions } from './PopularSolutions';
import { CategoryPromo } from './CategoryPromo';
import { RoutineMadeSimple } from './RoutineMadeSimple';
import { AskAssistantButton } from './AskAssistantButton';
import { MobileBottomNav } from './MobileBottomNav';

export function HomePage() {
  return (
    <div className="home-page min-h-screen bg-background pb-24 lg:pb-8">
      <style>{`
        .site-footer { display: none !important; }
      `}</style>
      <HomeHeader />
      <div className="sticky top-0 z-40 bg-background/95 pb-1 backdrop-blur md:hidden">
        <HomeSearch />
      </div>
      <main className="home-shell">
        <div className="home-hero-layout">
          <HeroCarousel />
          <div className="hidden md:block">
            <RoutineBuilderBanner compact />
          </div>
        </div>
        <ConcernStrip />
        <div className="md:hidden">
          <RoutineBuilderBanner />
        </div>
        <RecommendedRoutines />
        <PopularSolutions />
        <CategoryPromo />
        <RoutineMadeSimple />
      </main>
      <AskAssistantButton />
      <MobileBottomNav />
    </div>
  );
}
