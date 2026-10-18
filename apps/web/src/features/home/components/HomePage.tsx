import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { MessageBox } from '@/components/ui/message-box';
import { toCardModel } from '@/features/catalog/lib/card-model';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { loadHomeData, PICKS_COUNT } from '../home-data';
import { BrandShelf } from './BrandShelf';
import { Departments } from './Departments';
import { HomeHero } from './HomeHero';
import { PersonalSlot } from './PersonalSlot';
import { RoutineEntries } from './RoutineEntries';
import { SeasonPicks } from './SeasonPicks';

/**
 * Home (boards Main 1440 and Mobile 390), in the board's order: hero, personal slot, departments, season picks,
 * routine/Shina entries, brands; then the shell's service strip and footer. Real catalog data only.
 */
export async function HomePage() {
  const locale = getLocale();
  const m = getMessages(locale);
  const data = await loadHomeData(locale);
  const picks = data.products.slice(0, PICKS_COUNT).map((p) => toCardModel(p, locale, m.sizeOr));
  const heroBrands = [...new Set(picks.map((p) => p.brandName.toUpperCase()))].slice(0, 6);

  return (
    <StorefrontShell nav="home">
      <PageContainer className="flex flex-col pt-3 lg:pt-6">
        <HomeHero m={m} feature={picks[0] ?? null} second={picks[1] ?? null} brands={heroBrands} />
        <div className="pt-6">
          <PersonalSlot />
        </div>
        <div className="pt-12 lg:pt-20">
          <Departments m={m} departments={data.departments} />
        </div>
        <div className="pt-14 lg:pt-24">
          {data.ok ? (
            <SeasonPicks initial={data.products} />
          ) : (
            <MessageBox tone="err">
              <p className="m-0">{m.picksError}</p>
              <Button asChild variant="light" size="s" className="mt-2 self-start">
                <a href={routes.home}>{m.picksRetry}</a>
              </Button>
            </MessageBox>
          )}
        </div>
        <div className="pt-14 lg:pt-24">
          <RoutineEntries m={m} />
        </div>
        <div className="pb-4 pt-14 lg:pb-16 lg:pt-26">
          <BrandShelf m={m} brands={data.brands} />
        </div>
      </PageContainer>
    </StorefrontShell>
  );
}
