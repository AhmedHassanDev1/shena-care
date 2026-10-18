import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { OrderTrackingView } from '@/features/orders/components/OrderTrackingView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).orderMetaTitle };
}

/** Order detail and tracking: floating nav with «حسابي» selected. */
export default function OrderPage({ params }: { params: { id: string } }) {
  return (
    <StorefrontShell nav="account">
      <PageContainer className="pt-4 lg:pt-8">
        <Suspense>
          <OrderTrackingView orderNumber={decodeURIComponent(params.id)} />
        </Suspense>
      </PageContainer>
    </StorefrontShell>
  );
}
