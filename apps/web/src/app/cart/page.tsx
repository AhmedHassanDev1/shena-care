import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { CartView } from '@/features/cart/components/CartView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).cartMetaTitle };
}

/** Cart: full browsing header on desktop (CartD); phone Focus Mode with no floating nav (CommerceMobile ١). */
export default function CartPage() {
  const m = getMessages(getLocale());
  return (
    <StorefrontShell phoneFocus={{ back: { href: routes.home, label: m.back }, title: m.shellCart }}>
      <PageContainer className="pt-1 lg:pt-8">
        <CartView />
      </PageContainer>
    </StorefrontShell>
  );
}
