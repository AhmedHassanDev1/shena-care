import { PhoneNumberForm } from '@/features/auth/components/PhoneNumberForm';
import { Suspense } from 'react';

export default function AuthPage() {
  return (
    <Suspense>
      <PhoneNumberForm />
    </Suspense>
  );
}
