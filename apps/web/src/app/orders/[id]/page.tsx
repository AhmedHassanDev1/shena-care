import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { HomeHeader } from '@/features/home/components/HomeHeader';
import { MobileBottomNavigation } from '@/features/home/components/MobileBottomNavigation';
import { OrderTrackingView } from '@/features/orders/components/OrderTrackingView';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).orderMetaTitle };
}

export default function OrderPage({ params }: { params: { id: string } }) {
  return (
    <>
      <HomeHeader />
      <div className="pb-nav-safe">
        <PageContainer className="pt-4 lg:pt-8">
          <Suspense>
            <OrderTrackingView orderNumber={decodeURIComponent(params.id)} />
          </Suspense>
        </PageContainer>
      </div>
      <MobileBottomNavigation />
    </>
  );
}
