import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { ProductDetailView } from '@/features/catalog/components/ProductDetailView';
import { ProductPhoneHeader } from '@/features/shell/ProductPhoneHeader';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).pdpMetaTitle };
}

export default function ProductPage({ params }: { params: { slug: string } }) {
  return (
    <StorefrontShell nav="shop" navMode="scroll-up" phoneHeader={<ProductPhoneHeader />}>
      <PageContainer className="pt-2 lg:pt-8">
        <Suspense>
          <ProductDetailView slug={decodeURIComponent(params.slug)} />
        </Suspense>
      </PageContainer>
    </StorefrontShell>
  );
}
