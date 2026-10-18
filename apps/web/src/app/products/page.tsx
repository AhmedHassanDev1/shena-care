import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { ProductListing } from '@/features/catalog/components/ProductListing';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  const m = getMessages(getLocale());
  return { title: m.listingMetaTitle, description: m.listingMetaDescription };
}

export default function ProductsPage({ searchParams }: { searchParams: { q?: string | string[] } }) {
  const q = typeof searchParams.q === 'string' ? searchParams.q : undefined;
  return (
    <StorefrontShell nav="shop" searchDefault={q}>
      <PageContainer className="pt-4 lg:pt-8">
        {/* Search params drive the listing; Suspense keeps the shell server-rendered. */}
        <Suspense>
          <ProductListing />
        </Suspense>
      </PageContainer>
    </StorefrontShell>
  );
}
