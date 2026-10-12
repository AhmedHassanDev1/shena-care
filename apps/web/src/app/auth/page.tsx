import { Suspense } from 'react';
import { PhoneLoginForm } from '@/features/auth/components/PhoneLoginForm';

export default function AuthPage() {
  return (
    <Suspense>
      <PhoneLoginForm />
    </Suspense>
  );
}