import type { Metadata } from 'next';
import { CornerIndexView } from '@/features/corner/components/CornerIndexView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  const m = getMessages(getLocale());
  return { title: m.cornerMetaTitle, description: m.cornerMetaDescription };
}

export default function CornerPage() {
  return (
    <StorefrontShell nav="shop">
      <CornerIndexView />
    </StorefrontShell>
  );
}
