import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { HomeHeader } from '@/features/home/components/HomeHeader';
import { MobileBottomNavigation } from '@/features/home/components/MobileBottomNavigation';
import { MyOrdersView } from '@/features/orders/components/MyOrdersView';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).myOrdersTitle };
}

export default function MyOrdersPage() {
  return (
    <>
      <HomeHeader />
      <div className="pb-nav-safe">
        <PageContainer className="pt-4 lg:pt-8">
          <MyOrdersView />
        </PageContainer>
      </div>
      <MobileBottomNavigation />
    </>
  );
}
