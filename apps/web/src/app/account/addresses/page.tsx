import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { AddressBookView } from '@/features/account/components/AddressBookView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';

export const metadata: Metadata = {
  title: 'Saved Addresses | ShinaCare',
  description: 'Manage your delivery addresses and set your default destination on ShinaCare.',
};

export default function AccountAddressesPage() {
  return (
    <StorefrontShell nav="account">
      <PageContainer className="py-8">
        <AddressBookView />
      </PageContainer>
    </StorefrontShell>
  );
}
