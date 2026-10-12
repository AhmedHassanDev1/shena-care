import { Suspense } from 'react';
import { OtpVerificationForm } from '@/features/auth/components/OtpVerificationForm';

export default function VerifyPage() {
  return (
    <Suspense>
      <OtpVerificationForm />
    </Suspense>
  );
}