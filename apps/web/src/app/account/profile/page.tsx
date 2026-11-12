import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { CustomerProfileView, ProfileSkeleton } from '@/features/account/components/CustomerProfileView';
import { FocusHeader } from '@/features/shell/FocusHeader';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

export function generateMetadata(): Metadata {
  const m = getMessages(getLocale());
  return { title: `${m.profilePersonalTitle} | ${m.profileMetaTitle}` };
}

/** Personal Profile route (/account/profile): focuses Personal Information within the unified Customer Profile. */
export default function ProfilePage() {
  const m = getMessages(getLocale());
  return (
    <StorefrontShell
      nav="account"
      phoneHeader={<FocusHeader back={{ href: routes.account, label: m.back }} title={m.profilePersonalTitle} />}
    >
      <PageContainer className="pt-4 lg:pt-8 lg:pb-24">
        <Suspense fallback={<ProfileSkeleton />}>
          <CustomerProfileView focusSection="personal" />
        </Suspense>
      </PageContainer>
    </StorefrontShell>
  );
}
