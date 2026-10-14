import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { CartView } from '@/features/cart/components/CartView';
import { HomeHeader } from '@/features/home/components/HomeHeader';
import { MobileBottomNavigation } from '@/features/home/components/MobileBottomNavigation';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).cartMetaTitle };
}

export default function CartPage() {
  return (
    <>
      <HomeHeader />
      <div className="pb-nav-safe">
        <PageContainer className="pt-4 lg:pt-8">
          <CartView />
        </PageContainer>
      </div>
      <MobileBottomNavigation />
    </>
  );
}
