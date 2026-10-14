import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { ProductListing } from '@/features/catalog/components/ProductListing';
import { HomeHeader } from '@/features/home/components/HomeHeader';
import { MobileBottomNavigation } from '@/features/home/components/MobileBottomNavigation';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  const m = getMessages(getLocale());
  return { title: m.listingMetaTitle, description: m.listingMetaDescription };
}

export default function ProductsPage() {
  return (
    <>
      <HomeHeader />
      <div className="pb-nav-safe">
        <PageContainer className="pt-4 lg:pt-8">
          {/* Search params drive the listing; Suspense keeps the shell server-rendered. */}
          <Suspense>
            <ProductListing />
          </Suspense>
        </PageContainer>
      </div>
      <MobileBottomNavigation />
    </>
  );
}
