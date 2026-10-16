import { Metadata } from 'next';
import { AddressBookView } from '@/features/account/components/AddressBookView';

export const metadata: Metadata = {
  title: 'Saved Addresses | ShinaCare',
  description: 'Manage your delivery addresses and set your default destination on ShinaCare.',
};

export default function AccountAddressesPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <AddressBookView />
    </main>
  );
}
