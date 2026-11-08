import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProductDetailView } from '@/features/catalog/components/ProductDetailView';
import { ProductPhoneHeader } from '@/features/shell/ProductPhoneHeader';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).pdpMetaTitle };
}

/** Product page: every block is a Sahel `Section` (own container and rhythm), so the route adds no container of its own. */
export default function ProductPage({ params }: { params: { slug: string } }) {
  return (
    <StorefrontShell nav="shop" navMode="scroll-up" phoneHeader={<ProductPhoneHeader />}>
      <Suspense>
        <ProductDetailView slug={decodeURIComponent(params.slug)} />
      </Suspense>
    </StorefrontShell>
  );
}
