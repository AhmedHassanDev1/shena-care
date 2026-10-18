import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { MyOrdersView } from '@/features/orders/components/MyOrdersView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).myOrdersTitle };
}

/** My orders: floating nav with «حسابي» selected (handoff §Visibility by page). */
export default function MyOrdersPage() {
  return (
    <StorefrontShell nav="account">
      <PageContainer className="pt-4 lg:pt-8">
        <MyOrdersView />
      </PageContainer>
    </StorefrontShell>
  );
}
