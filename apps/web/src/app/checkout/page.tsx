import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { CheckoutView } from '@/features/checkout/components/CheckoutView';
import { FocusHeader, SecureBadge } from '@/features/shell/FocusHeader';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).checkoutMetaTitle };
}

/** Focus Mode (CheckoutD, CommerceMobile ٣): wordmark, «دفع آمن» and «ارجع للسلة» — no search, nav or merchandising. */
export default function CheckoutPage() {
  const m = getMessages(getLocale());
  return (
    <div className="min-h-dvh">
      <FocusHeader
        back={{ href: routes.cart, label: m.backToCart }}
        title={m.checkoutTitle}
        action={<SecureBadge label={m.focusSecure} />}
        desktopBack={{ href: routes.cart, label: m.backToCart }}
        secure
      />
      <PageContainer className="py-6 lg:py-8">
        <CheckoutView />
      </PageContainer>
    </div>
  );
}
