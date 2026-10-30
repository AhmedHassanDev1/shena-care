import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { BrandMarquee } from './BrandMarquee';
import { ConcernShelf } from './ConcernShelf';
import { HomeHero } from './HomeHero';
import { RoutineSection } from './RoutineSection';
import { ShinaStudio } from './ShinaStudio';
import { SpotlightProducts } from './SpotlightProducts';
import { TrustBadges } from './TrustBadges';

/**
 * Homepage, in the approved Stitch order: hero banner, shop by concern (+ Shina bar), the brand marquee, routines,
 * selected products, the custom routine studio, trust badges; the shell adds the header, the phone dock and the footer. Data sections
 * read the live catalog; photography comes from public/images/home (see the image manifest).
 */
export function HomePage() {
  return (
    <StorefrontShell nav="home" dock="home" footerServices={false}>
      <HomeHero />
      <ConcernShelf />
      <BrandMarquee />
      <RoutineSection />
      <SpotlightProducts />
      <ShinaStudio />
      <TrustBadges />
    </StorefrontShell>
  );
}
