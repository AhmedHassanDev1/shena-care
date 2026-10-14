import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { WordmarkLink } from '@/components/navigation/wordmark-link';
import { CheckoutView } from '@/features/checkout/components/CheckoutView';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).checkoutMetaTitle };
}

/** Focus mode: wordmark only, no search, navigation or merchandising while the order is being placed. */
export default function CheckoutPage() {
  const m = getMessages(getLocale());
  return (
    <>
      <header className="border-b border-border bg-card">
        <PageContainer className="flex h-16 items-center">
          <WordmarkLink label={m.authHome} />
        </PageContainer>
      </header>
      <PageContainer className="py-6 lg:py-10">
        <CheckoutView />
      </PageContainer>
    </>
  );
}
