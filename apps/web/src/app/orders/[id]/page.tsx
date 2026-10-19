import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { MyOrdersView } from '@/features/orders/components/MyOrdersView';
import { OrderTrackingView } from '@/features/orders/components/OrderTrackingView';
import { FocusHeader } from '@/features/shell/FocusHeader';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).orderMetaTitle };
}

/**
 * Right after checkout (`?placed=1`): «طلبك اتسجّل» (ConfirmD, CommerceMobile ٥) with the nav back and nothing
 * selected. Otherwise the order detail and tracking (OrdersD, CommerceMobile ٧) with «حسابي» selected.
 */
export default function OrderPage({ params, searchParams }: { params: { id: string }; searchParams: { placed?: string } }) {
  const m = getMessages(getLocale());
  const orderNumber = decodeURIComponent(params.id);
  if (searchParams.placed === '1') {
    return (
      <StorefrontShell nav="none" phoneHeader={<FocusHeader title={m.confirmHeader} />}>
        <PageContainer className="lg:pb-24">
          <OrderTrackingView orderNumber={orderNumber} placed />
        </PageContainer>
      </StorefrontShell>
    );
  }
  return (
    <StorefrontShell
      nav="account"
      phoneHeader={<FocusHeader back={{ href: routes.myOrders, label: m.myOrdersBack }} title={<bdi dir="ltr">{orderNumber}</bdi>} />}
    >
      <PageContainer className="pt-4 lg:pt-8 lg:pb-24">
        <MyOrdersView selected={orderNumber} />
      </PageContainer>
    </StorefrontShell>
  );
}
