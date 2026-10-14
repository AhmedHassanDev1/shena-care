import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { ProductDetailView } from '@/features/catalog/components/ProductDetailView';
import { HomeHeader } from '@/features/home/components/HomeHeader';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).pdpMetaTitle };
}

/** No bottom navigation here: on phones the sticky purchase bar takes that place. */
export default function ProductPage({ params }: { params: { slug: string } }) {
  return (
    <>
      <HomeHeader />
      <PageContainer className="pt-4 lg:pt-8">
        <Suspense>
          <ProductDetailView slug={decodeURIComponent(params.slug)} />
        </Suspense>
      </PageContainer>
    </>
  );
}
