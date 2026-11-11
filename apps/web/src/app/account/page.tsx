import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { CustomerProfileView, ProfileSkeleton } from '@/features/account/components/CustomerProfileView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: getMessages(getLocale()).profileMetaTitle };
}

/** Customer Profile & Account Hub (/account), integrated directly inside the browsing shell. */
export default function AccountPage() {
  return (
    <StorefrontShell nav="account">
      <PageContainer className="pt-4 lg:pt-8 lg:pb-24">
        <Suspense fallback={<ProfileSkeleton />}>
          <CustomerProfileView />
        </Suspense>
      </PageContainer>
    </StorefrontShell>
  );
}
