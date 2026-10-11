import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { HomeHeader } from './HomeHeader';
import { HomeHero } from './HomeHero';
import { ConcernStrip } from './ConcernStrip';
import { RecommendedRoutines } from './RecommendedRoutines';
import { PopularSolutions } from './PopularSolutions';
import { CategoryPromo } from './CategoryPromo';
import { RoutineGuidance } from './RoutineGuidance';
import { AssistantEntry } from './AssistantEntry';
import { MobileBottomNav } from './MobileBottomNav';

export function HomePage() {
  const locale = getLocale();
  const m = getMessages(locale);

  return (
    <div className="home-page min-h-screen bg-background pb-24 md:pb-0">
      <HomeHeader />
      <div className="mx-auto w-full max-w-[75rem] px-4 md:px-8">
        <HomeHero m={m} />
        <ConcernStrip m={m} />
        <RecommendedRoutines m={m} locale={locale} />
        <PopularSolutions />
        <CategoryPromo m={m} />
        <RoutineGuidance m={m} locale={locale} />
        <AssistantEntry m={m} />
      </div>
      <MobileBottomNav />
    </div>
  );
}
