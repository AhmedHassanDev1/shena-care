import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConcernView } from '@/features/corner/components/ConcernView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  const m = getMessages(getLocale());
  return { title: m.cornerMetaTitle, description: m.cornerMetaDescription };
}

export default function ConcernPage({ params }: { params: { slug: string } }) {
  // Concern slugs are lowercase words and dashes; anything else is not a concern page.
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(params.slug)) notFound();
  return (
    <StorefrontShell nav="shop">
      {/* Refinements live in the URL; Suspense keeps the shell server-rendered. */}
      <Suspense>
        <ConcernView slug={params.slug} />
      </Suspense>
    </StorefrontShell>
  );
}
