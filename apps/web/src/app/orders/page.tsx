import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { MyOrdersView } from '@/features/orders/components/MyOrdersView';
import { FocusHeader } from '@/features/shell/FocusHeader';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).myOrdersTitle };
}

/** «طلباتي» (OrdersD, CommerceMobile ٦): floating nav with «حسابي» selected (handoff §Visibility by page). */
export default function MyOrdersPage() {
  const m = getMessages(getLocale());
  return (
    <StorefrontShell nav="account" phoneHeader={<FocusHeader back={{ href: routes.account, label: m.back }} title={m.myOrdersTitle} />}>
      <PageContainer className="pt-4 lg:pt-8 lg:pb-24">
        <MyOrdersView />
      </PageContainer>
    </StorefrontShell>
  );
}
